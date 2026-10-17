import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { CpuRenderer, createDefaultRegistry, kernelFactories } from '../src/index.js'
import { findComponentWrites, stageVectorComponentWrites } from '../scripts/upstream/vector-writes.js'

const kernelsSource = () => readFile(new URL('../src/effects/generated/canonical-kernels.js', import.meta.url), 'utf8')

// Evaluate a transpiled body that defines `run`, with Float32Array vectors and a
// float32 dot like the canonical runtime.
function evaluate(body, ...args) {
  const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0)
  return new Function('dot', `${body}\nreturn run;`)(dot)(...args)
}

test('a whole-vector read after a component write is staged', () => {
  // GLSL: p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  const source = 'function run (p) {\n\t(p[0] = dot(p, new Float32Array([127.1, 311.7])), p[1] = dot(p, new Float32Array([269.5, 183.3])), p);\n\treturn p;\n}'
  const staged = stageVectorComponentWrites(source)
  assert.notEqual(staged, source)
  const input = () => new Float32Array([1, 14.7])
  const [x, y] = input()
  const a = new Float32Array([127.1, 311.7])
  const b = new Float32Array([269.5, 183.3])
  const expected = new Float32Array([x * a[0] + y * a[1], x * b[0] + y * b[1]])
  assert.deepEqual(evaluate(staged, input()), expected)
  // The unstaged form reads the rewritten p[0] in the second dot product.
  assert.notDeepEqual(evaluate(source, input()), expected)
  assert.deepEqual(findComponentWrites(staged).filter((write) => write.hazard), [])
})

test('a read of an earlier written component is staged', () => {
  // GLSL: p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  const source = 'function run (p, k) {\n\t(p[0] = (p[0] - k * p[1]) / 2, p[1] = (-k * p[0] - p[1]) / 2, p);\n\treturn p;\n}'
  const staged = stageVectorComponentWrites(source)
  const result = evaluate(staged, new Float32Array([3, 5]), 2)
  assert.deepEqual(result, new Float32Array([(3 - 2 * 5) / 2, (-2 * 3 - 5) / 2]))
})

test('component-wise writes that read only their own component stay unchanged', () => {
  for (const source of [
    '(color[0] = color[0] * lev, color[1] = color[1] * lev, color[2] = color[2] * lev, color);',
    '(st[0] = st[0] * 2 - fullResolution[0] / fullResolution[1], st[1] = st[1] * 2 - 1, st);',
    '(q[0] = (q[0] ^ (q[0] >>> 16)) >>> 0, q[1] = (q[1] ^ (q[1] >>> 16)) >>> 0, q);',
    '(n[0] = -n[0], n[1] = -n[1], n[2] = -n[2], n);',
    '(a[0] = b[1], a[1] = b[0], a);',
  ]) assert.equal(stageVectorComponentWrites(source), source)
})

test('staging declares one temporary per staged component and keeps the expression value', () => {
  const staged = stageVectorComponentWrites('var x = (v[0] = v[1], v[1] = v[0], v);')
  assert.match(staged, /^var cpu_vector_write_0_0, cpu_vector_write_0_1;\n/)
  const v = new Float32Array([1, 2])
  const x = new Function('v', `${staged}\nreturn x;`)(v)
  assert.equal(x, v)
  assert.deepEqual(v, new Float32Array([2, 1]))
})

test('a reserved temporary prefix in the input is refused', () => {
  assert.throws(() => stageVectorComponentWrites('var cpu_vector_write_0_0 = 1;'), /reserved/)
})

// glsl-transpiler lowered five canonical whole-vector assignments to in-place
// writes that read the target after writing it (filter/edge, filter/scatter,
// mixer/shapeMask, synth/mandelbrot and synth/navierStokes). No committed kernel
// may keep one.
test('no compiled kernel reads a vector after an in-place component write', async () => {
  const source = await kernelsSource()
  const writes = findComponentWrites(source)
  assert.ok(writes.length > 900, `expected the corpus of in-place writes, found ${writes.length}`)
  assert.deepEqual(writes.filter((write) => write.hazard).map((write) => source.slice(write.index, write.end)), [])
  assert.equal((source.match(/cpu_vector_write_\d+_0 = /g) ?? []).length, 5)
})

// Non-default programs captured from the Apple M4/Metal WebGL2 authority. Each
// one reaches a staged write that the default fixtures never reach: edge's
// luminance center sample, shapeMask's triangle fold, and mandelbrot's distance
// derivative. Before staging they differed by up to 255 at the same capture.
test('staged vector-write paths match the M4 authority', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/authority/vector-writes-m4.json', import.meta.url), 'utf8'))
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernelFactories })
  assert.deepEqual(Object.keys(fixture.cases), ['edge-channel-luminance', 'shapeMask-triangle', 'mandelbrot-outputMode-distance'])
  for (const [name, { program, rgba8, rgba8Sha256 }] of Object.entries(fixture.cases)) {
    assert.equal(createHash('sha256').update(Uint8Array.from(rgba8)).digest('hex'), rgba8Sha256, name)
    const actual = renderer.render(program, { width: 8, height: 8, time: 0.25, seed: 1 }).toRgba8()
    let maxError = 0
    for (let index = 0; index < rgba8.length; index += 1) maxError = Math.max(maxError, Math.abs(actual[index] - rgba8[index]))
    assert.ok(maxError <= 2, `${name}: max error ${maxError} exceeds the ±2 contract`)
  }
})
