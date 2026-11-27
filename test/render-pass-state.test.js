import assert from 'node:assert/strict'
import test from 'node:test'

import { CpuRenderer, EffectDefinition, EffectRegistry, createDefaultRegistry, kernelFactories } from '../src/index.js'
import { packMeshDataForTextures } from '../src/runtime/external-input.js'

const backdrop = [0.25, 0.5, 1, 0.75]
const source = [0.5, 0.25, 0.75, 0.5]
const output = { fragColor: 'outputTex' }
const blendProgram = 'search synth\nblendProbe().write(o0)\nrender(o0)'
const frame = { width: 1, height: 1, scheduler: async () => {} }

function colorPass(color, blend, outputs = output) {
  return { name: 'color', program: 'color', uniforms: { color }, outputs, blend }
}

function blendRenderer(passes, iterated = false, factories = {}) {
  const definition = new EffectDefinition({
    namespace: 'synth', func: 'blendProbe', kind: 'generator', iterated,
    params: { iterationCount: { type: 'int', default: 1 } }, passes,
  })
  return new CpuRenderer({
    registry: new EffectRegistry([definition]),
    kernelFactories: {
      'synth/blendProbe:color': ({ color }) => (context, out) => out.set(color),
      ...factories,
    },
  })
}

for (const method of ['render', 'renderAsync']) {
  test(`${method} preserves source and destination blend factors in canonical passes`, async () => {
    const cases = [
      [['ONE', 'ZERO'], source],
      [[0, 1], backdrop],
      [['zero', 'one'], backdrop],
      [['SRC_COLOR', 'ZERO'], [0.25, 0.0625, 0.5625, 0.25]],
      [['DST_COLOR', 'ZERO'], [0.125, 0.125, 0.75, 0.375]],
      [['ONE_MINUS_SRC_COLOR', 'ZERO'], [0.25, 0.1875, 0.1875, 0.25]],
      [['ONE_MINUS_DST_COLOR', 'ZERO'], [0.375, 0.125, 0, 0.125]],
      [['zero', 'src'], [0.125, 0.125, 0.75, 0.375]],
      [['zero', 'one-minus-dst'], [0.1875, 0.25, 0, 0.1875]],
      [['zero', 'ONE_MINUS_SRC_COLOR'], [0.125, 0.375, 0.25, 0.375]],
      [['SRC_ALPHA', 'ONE_MINUS_SRC_ALPHA'], [0.375, 0.375, 0.875, 0.625]],
      [true, [0.75, 0.75, 1.75, 1.25]],
    ]
    for (const [blend, expected] of cases) {
      const renderer = blendRenderer([colorPass(backdrop), colorPass(source, blend)])
      const result = await renderer[method](blendProgram, frame)
      assert.deepEqual([...result.surface.data], expected, String(blend))
    }
    const firstWrite = blendRenderer([colorPass(source, ['DST_COLOR', 'ONE'])])
    assert.deepEqual([...(await firstWrite[method](blendProgram, frame)).surface.data], [0, 0, 0, 0])
  })

  for (const iterated of [false, true]) {
    test(`${method} blends each MRT attachment against its own prior output (iterated=${iterated})`, async () => {
      const split = () => (context, out) => out.set([...source, ...source])
      split.outputNames = ['a', 'b']
      const combine = ({ left, right }) => (context, out) => out.set([left.data[0], left.data[1], right.data[2], right.data[3]])
      const renderer = blendRenderer([
        colorPass(backdrop, undefined, { fragColor: '_left' }),
        colorPass([0, 1, 0.25, 0.5], undefined, { fragColor: '_right' }),
        { name: 'split', program: 'split', drawBuffers: 2, blend: ['DST_COLOR', 'ZERO'], outputs: { a: '_left', b: '_right' } },
        { name: 'combine', program: 'combine', inputs: { left: '_left', right: '_right' }, outputs: output },
        colorPass(source, ['ZERO', 'ONE']),
      ], iterated, { 'synth/blendProbe:split': split, 'synth/blendProbe:combine': combine })
      const result = await renderer[method](blendProgram, frame)
      assert.deepEqual([...result.surface.data], [0.125, 0.125, 0.1875, 0.25])
    })
  }
}

test('mesh triangle screen counts use the mesh extent unless a positive count uniform overrides it', () => {
  // One triangle on each half of an 8x8 output, packed into a 3x2 mesh texture.
  const positions = [-1, -1, 0, 0, -1, 0, -1, 1, 0, 0, -1, 0, 1, -1, 0, 0, 1, 0]
  const normals = Array(6).fill([0, 0, 1]).flat()
  const uvs = Array(12).fill(0)
  const packed = packMeshDataForTextures(positions, normals, uvs, 3, 2)
  const meshData = { ...packed, texWidth: 3, texHeight: 2 }
  const catalog = createDefaultRegistry()
  const mesh = catalog.get('render', 'meshRender')
  const loader = catalog.get('render', 'meshLoader')
  const dsl = 'search render\nmeshLoader().meshRender(bgAlpha: 0).write(o0)\nrender(o0)'
  for (const [count, vertices, rightAlpha, meshInput = meshData] of [
    ['screen', 3, 0], [3, undefined, 0], [undefined, undefined, 0], [3, 6, 1],
    ['screen', 0, 1], ['screen', -1, 1], ['screen', 'invalid', 1], ['screen', undefined, 1],
    ['auto', 0, 1], ['input', 0, 1],
    // External mesh textures default to 256x256 when the caller supplies only the packed arrays.
    ['screen', 3, 0, packMeshDataForTextures(positions, normals, uvs, 256, 256)],
  ]) {
    const passes = mesh.passes.map(pass => pass.drawMode === 'triangles'
      ? { ...pass, count, countUniform: 'vertices', uniforms: { ...pass.uniforms, vertices } }
      : pass)
    const registry = new EffectRegistry([loader, new EffectDefinition({
      namespace: mesh.namespace, func: mesh.func, kind: mesh.kind, params: mesh.params, passes,
    })])
    const renderer = new CpuRenderer({ registry, kernelFactories })
    const result = renderer.render(dsl, { width: 8, height: 8, externalInputs: { meshData: meshInput } })
    const alpha = x => result.surface.data[(5 * result.width + x) * 4 + 3]
    assert.equal(alpha(1), 1, 'left triangle')
    assert.equal(alpha(5), rightAlpha, `right triangle for count=${count}, vertices=${vertices}`)
  }
})
