import test from 'node:test'
import assert from 'node:assert/strict'

import { compileCsl, clearCslCache } from '../src/csl/compiler.js'
import { generateKernelSource } from '../src/csl/codegen.js'
import { parseCsl } from '../src/csl/parser.js'
import { checkCsl } from '../src/csl/types.js'

function context(overrides = {}) {
  return {
    uv: new Float32Array([0.25, 0.75]),
    fragCoord: new Float32Array([0.5, 0.5]),
    resolution: new Float32Array([1, 1]),
    time: 0,
    seed: 1,
    uniforms: {},
    textures: {},
    ...overrides,
  }
}

function run(source, overrides = {}, options = {}) {
  const compiled = compileCsl(source, options)
  const out = new Float32Array(4)
  compiled.runPixel(context(overrides), out)
  return [...out]
}

test('CSL compiler broadcasts vector arithmetic and constructs the entry color', () => {
  const output = run(`
    uniform vec3 color = vec3(0.8, 0.4, 0.2);
    uniform float alpha = 0.5;
    vec4 main() { return vec4(color * alpha, alpha); }
  `)

  assert.deepEqual(output, [Math.fround(0.4), Math.fround(0.2), Math.fround(0.1), 0.5])
})

test('CSL compiler handles functions, loops, branches, ternaries, and swizzle assignment', () => {
  const output = run(`
    float accumulate(float value) {
      for (int i = 0; i < 3; i++) { value += 0.2; }
      return value;
    }
    vec4 main() {
      vec4 color = vec4(0.1, 0.2, 0.3, 1.0);
      color.rgb = color.bgr;
      float value = accumulate(color.r);
      if (value > 0.8) { color.g *= 2.0; }
      color.b = value > 0.5 ? value : 0.0;
      return color;
    }
  `)

  assert.ok(Math.abs(output[0] - 0.3) < 1e-6)
  assert.ok(Math.abs(output[1] - 0.4) < 1e-6)
  assert.ok(Math.abs(output[2] - 0.9) < 1e-6)
  assert.equal(output[3], 1)
})

test('CSL compiler supports GLSL scalar and vector built-ins', () => {
  const output = run(`
    vec4 main() {
      vec3 a = mix(vec3(0.0), vec3(1.0, 0.5, 0.25), 0.5);
      float d = dot(a, vec3(1.0));
      return vec4(clamp(a, 0.0, 1.0), smoothstep(0.0, 2.0, d));
    }
  `)

  assert.deepEqual(output.slice(0, 3), [0.5, 0.25, 0.125])
  assert.ok(Math.abs(output[3] - 0.40673828125) < 1e-7)
})

test('CSL compiler applies uniform overrides and caches compiled source', () => {
  clearCslCache()
  const source = 'uniform float amount = 0.25; vec4 main() { return vec4(amount); }'
  const first = compileCsl(source)
  const second = compileCsl(source)
  const out = new Float32Array(4)
  first.runPixel(context({ uniforms: { amount: 0.75 } }), out)

  assert.equal(first, second)
  assert.deepEqual([...out], [0.75, 0.75, 0.75, 0.75])
  assert.match(first.generatedSource, /function runPixel/)
})

test('CSL compiler rejects unknown names and invalid return types before code generation', () => {
  assert.throws(() => compileCsl('vec4 main() { return globalThis; }', { sourceName: 'escape.csl' }), /escape\.csl:1:22: Unknown identifier "globalThis"/)
  assert.throws(() => compileCsl('float main() { return 1.0; }'), /main must return vec4/)
})

test('CSL compiler rejects writes through immutable l-values', () => {
  assert.throws(
    () => compileCsl('uniform vec3 color; vec4 main() { color.r = 0.0; return vec4(color, 1.0); }'),
    /Cannot assign to constant "color"/,
  )
  assert.throws(
    () => compileCsl('const vec3 color = vec3(1.0); vec4 main() { color[0] = 0.0; return vec4(color, 1.0); }'),
    /Cannot assign to constant "color"/,
  )
  assert.throws(
    () => compileCsl('vec4 main() { uv.x = 0.0; return vec4(uv, 0.0, 1.0); }'),
    /Cannot assign to constant "uv"/,
  )
  assert.throws(
    () => compileCsl('uniform float amount; vec4 main() { amount++; return vec4(amount); }'),
    /Cannot assign to constant "amount"/,
  )
  assert.throws(
    () => compileCsl('vec4 main() { vec2 value = vec2(0.0); value.xx = vec2(1.0); return vec4(value, 0.0, 1.0); }'),
    /Cannot assign to swizzle with repeated components "xx"/,
  )
})

test('CSL compiler requires every non-void function path to return a value', () => {
  assert.throws(
    () => compileCsl('float helper(bool enabled) { if (enabled) return 1.0; } vec4 main() { return vec4(helper(false)); }'),
    /Function "helper" must return float on every path/,
  )
  assert.throws(
    () => compileCsl('vec4 main() { if (uv.x > 0.5) return vec4(1.0); }'),
    /Function "main" must return vec4 on every path/,
  )
})

test('CSL generated loops stop at the configured safety limit', () => {
  const compiled = compileCsl('vec4 main() { for (int i = 0; i < 100; i++) { } return vec4(1.0); }', { maxLoopIterations: 8 })
  assert.throws(() => compiled.runPixel(context(), new Float32Array(4)), /CSL loop iteration limit exceeded/)
})

test('CSL compiler validates loop limits before emitting JavaScript', () => {
  delete globalThis.__cslOptionInjection
  const injection = '0) { globalThis.__cslOptionInjection = 123 } if (false'
  assert.throws(
    () => compileCsl('vec4 main() { for (int i = 0; i < 1; i++) { } return vec4(1.0); }', { maxLoopIterations: injection }),
    /maxLoopIterations must be a positive safe integer no greater than/,
  )
  assert.equal(globalThis.__cslOptionInjection, undefined)
  assert.throws(() => compileCsl('vec4 main() { return vec4(1.0); }', { maxLoopIterations: 0 }), /positive safe integer/)
  assert.throws(() => compileCsl('vec4 main() { return vec4(1.0); }', { maxLoopIterations: 1.5 }), /positive safe integer/)
  const ast = checkCsl(parseCsl('vec4 main() { for (int i = 0; i < 1; i++) { } return vec4(1.0); }'))
  assert.throws(() => generateKernelSource(ast, { maxLoopIterations: injection }), /positive safe integer/)
})

test('CSL integer division truncates toward zero', () => {
  assert.deepEqual(run('vec4 main() { int positive = 5 / 2; int negative = -5 / 2; positive /= 2; return vec4(float(positive), float(negative), 0.0, 1.0); }'), [1, -2, 0, 1])
})
