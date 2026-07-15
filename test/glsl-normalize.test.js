import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeCanonicalGlsl } from '../src/csl/glsl-normalize.js'

test('canonical GLSL normalization preserves ES3 outputs, varyings, and tagged uint constructors', () => {
  const normalized = normalizeCanonicalGlsl(`#version 300 es
precision highp float;
layout(location = 0) out vec4 fragColor;
flat in vec2 vUv;
uniform uint seed;
uvec3 hash(uvec3 value) { return value * 1664525u + 0x9E3779B9u; }
void main() { fragColor = vec4(vUv, float(hash(uvec3(seed)).x), 1.0); }
`)

  assert.deepEqual(normalized.outputs, ['fragColor'])
  assert.deepEqual(normalized.varyings, [{ name: 'vUv', type: 'vec2' }])
  assert.doesNotMatch(normalized.source, /#version|layout\s*\(|\buint\b|\buvec3\b|\d+u\b/)
  assert.match(normalized.source, /vec4 fragColor;/)
  assert.match(normalized.source, /vec2 vUv;/)
  assert.match(normalized.source, /vec3 hash\(vec3 value\)/)
  assert.match(normalized.source, /cpu_uvec3\(seed\)/)
  assert.match(normalized.source, /1664525 \+ 0x9E3779B9/)
})

test('canonical GLSL normalization lowers define-controlled function branches to runtime dispatch', () => {
  const normalized = normalizeCanonicalGlsl(`#ifdef GL_ES
precision highp float;
#endif
#ifndef MODE
#define MODE 0
#endif
#define TAU 6.28318530718
out vec4 fragColor;

#if MODE == 1
float enabledValue() { return TAU; }
#endif

void main() {
#if MODE == 1
  fragColor = vec4(enabledValue());
#elif MODE == 2
  fragColor = vec4(0.5);
#else
  fragColor = vec4(0.0);
#endif
}
`, { runtimeDefines: { MODE: 'int' } })

  assert.match(normalized.source, /uniform int MODE;/)
  assert.match(normalized.source, /float enabledValue\(\)/)
  assert.match(normalized.source, /if \(MODE == 1\) \{/)
  assert.match(normalized.source, /\} else if \(MODE == 2\) \{/)
  assert.match(normalized.source, /\} else \{/)
  assert.doesNotMatch(normalized.source, /#(?:if|elif|else|endif|define)/)
  assert.doesNotMatch(normalized.source, /\bTAU\b/)
  assert.match(normalized.source, /return 6\.28318530718;/)
})

test('canonical GLSL normalization reports unterminated preprocessor branches with source names', () => {
  assert.throws(
    () => normalizeCanonicalGlsl('#if MODE == 1\nvoid main() {}', { sourceName: 'broken.glsl', runtimeDefines: { MODE: 'int' } }),
    /broken\.glsl: unterminated #if for runtime define MODE/,
  )
})

test('object macros exclude trailing comments before expansion', () => {
  const normalized = normalizeCanonicalGlsl('#define PAIRS 32 // slots per zone\nint n = PAIRS + 1;\n')
  assert.match(normalized.source, /int n = 32 \+ 1;/)
  assert.doesNotMatch(normalized.source, /slots per zone \+ 1/)
})

test('ES3 inferred array constructors and std140 blocks lower to parser-compatible declarations', () => {
  const normalized = normalizeCanonicalGlsl(`
const ivec2 OFFSETS[2] = ivec2[](ivec2(-1), ivec2(1));
layout(std140) uniform RemapUniforms {
  vec4 data[267];
};
`)
  assert.match(normalized.source, /ivec2 OFFSETS\[2\] = ivec2\[2\]\(/)
  assert.match(normalized.source, /uniform vec4 data\[267\];/)
  assert.doesNotMatch(normalized.source, /std140|RemapUniforms/)
})

test('valid GLSL identifiers that collide with the JS transpiler grammar are made safe', () => {
  const normalized = normalizeCanonicalGlsl('vec4 packed = vec4(1.0);\nreturn packed.xy;\n')
  assert.match(normalized.source, /vec4 _packed = vec4/)
  assert.match(normalized.source, /return _packed\.xy/)
})

test('locals named like GLSL builtins do not shadow generated helper calls', () => {
  const normalized = normalizeCanonicalGlsl('float max = max(1.0, 2.0);\nfloat min = min(max, 3.0);\n')
  assert.match(normalized.source, /float _max = max\(1\.0, 2\.0\)/)
  assert.match(normalized.source, /float _min = min\(_max, 3\.0\)/)
})

test('locals that shadow uniforms retain GLSL declaration-point scope', () => {
  const normalized = normalizeCanonicalGlsl(`
uniform float alpha;
void main() {
  float before = alpha;
  float alpha = 0.5;
  float after = alpha;
}
`)
  assert.match(normalized.source, /float before = alpha;/)
  assert.match(normalized.source, /float _local_alpha_1 = 0\.5;/)
  assert.match(normalized.source, /float after = _local_alpha_1;/)
})

test('scalar float casts lower without producing transpiler NaN literals', () => {
  const normalized = normalizeCanonicalGlsl(`
int x0 = 3;
uint channel = 7u;
float fx = float(x0);
float offset = float(channel) * 2.0;
`)
  assert.match(normalized.source, /float fx = \(x0\);/)
  assert.match(normalized.source, /float offset = \(channel\) \* 2\.0;/)
})

test('unsigned scalar products lower to exact uint32 multiplication helpers', () => {
  const normalized = normalizeCanonicalGlsl('uint bits = floatBitsToUint(1.0);\nuint mixed = bits * 374761393u;\n')
  assert.match(normalized.source, /cpu_umul\(bits, 374761393\)/)
})
