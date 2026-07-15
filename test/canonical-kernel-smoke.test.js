import assert from 'node:assert/strict'
import test from 'node:test'

import { createDefaultRegistry, kernelFactories, kernels } from '../src/effects/catalog.js'
import { CpuRenderer } from '../src/runtime/renderer.js'
import { bindCanonicalKernel } from '../src/csl/glsl-kernel.js'
import { Surface } from '../src/runtime/surface.js'

test('classic palette parameters expand to canonical shader uniforms', () => {
  const registry = createDefaultRegistry()
  const renderer = new CpuRenderer({ registry, kernels, kernelFactories })
  const definition = registry.resolve('noise', ['classicNoisedeck'])
  const params = definition.normalizeArguments([])
  const { uniforms } = renderer.buildBindings(
    definition,
    params,
    [],
    null,
    new Map(),
    { width: 1, height: 1, time: 0, seed: 1, externalTextures: {} },
  )

  assert.deepEqual(uniforms.paletteAmp, [0.56851584, 0.7740668, 0.23485267])
  assert.deepEqual(uniforms.paletteFreq, [1, 1, 1])
  assert.deepEqual(uniforms.paletteOffset, [0.5, 0.5, 0.5])
  assert.deepEqual(uniforms.palettePhase, [0.727029, 0.08039695, 0.10427457])
  assert.equal(uniforms.paletteMode, 3)
})

test('generated canonical noise kernel executes with pooled vector type operations', () => {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
  const result = renderer.render('search synth\nnoise().write(o0)\nrender(o0)', { width: 2, height: 2, seed: 3, time: 0.25 })
  assert.ok(result.surface.data.every(Number.isFinite))
})

test('classic simplex ternary assigns both lattice branches', () => {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
  const result = renderer.render(
    'search classicNoisedeck\nnoise(type: simplex, xScale: 8, yScale: 8, seed: 3, octaves: 1, speed: 0, refractAmt: 0, kaleido: 1, colorMode: mono).write(o0)\nrender(o0)',
    { width: 16, height: 16, time: 0.25, seed: 1 },
  )
  const bytes = result.toRgba8()
  assert.deepEqual([...bytes.slice(0, 8)], [105, 105, 105, 255, 138, 138, 138, 255])
  assert.deepEqual([...bytes.slice((8 * 16 + 8) * 4, (8 * 16 + 8) * 4 + 4)], [207, 207, 207, 255])
  assert.deepEqual([...bytes.slice((5 * 16 + 15) * 4, (5 * 16 + 15) * 4 + 4)], [236, 236, 236, 255])
})

test('polygon vector rotation preserves simultaneous GLSL assignment semantics', () => {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
  const result = renderer.render('search synth\npolygon().write(o0)\nrender(o0)', { width: 8, height: 8, time: 0.25 })
  const bytes = result.toRgba8()
  assert.deepEqual([...bytes.slice((3 * 8 + 2) * 4, (3 * 8 + 6) * 4)], [
    0, 0, 0, 255,
    255, 255, 255, 255,
    255, 255, 255, 255,
    0, 0, 0, 255,
  ])
})

test('zero-smoothing polygon preserves the reference hard-edge alpha mask', () => {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
  const result = renderer.render(
    'search synth\npolygon(smooth: 0, bgAlpha: 0).write(o0)\nrender(o0)',
    { width: 8, height: 8, time: 0.25 },
  )
  const bytes = result.toRgba8()
  assert.deepEqual([...bytes.slice(0, 4)], [0, 0, 0, 0])
  assert.deepEqual([...bytes.slice((3 * 8 + 3) * 4, (3 * 8 + 3) * 4 + 4)], [255, 255, 255, 255])
})

test('cell split compares vector cell IDs component-by-component', () => {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
  const result = renderer.render(
    'search synth, mixer\nnoise().cellSplit(invert: sourceB).write(o0)\nrender(o0)',
    { width: 8, height: 8, time: 0.25 },
  )
  const bytes = result.toRgba8()
  assert.deepEqual([...bytes.slice(0, 8)], [103, 162, 41, 255, 0, 0, 0, 255])
})

test('integer casts retain GLSL precedence inside normal-map coordinates', () => {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
  const result = renderer.render(
    'search synth, filter\nnoise(seed: 1, ridges: true).normalMap().write(o0)\nrender(o0)',
    { width: 8, height: 8, time: 0.25 },
  )
  assert.deepEqual([...result.toRgba8().slice(0, 4)], [108, 122, 230, 255])
})

test('Newton POI low-coordinate swizzle preserves all four center components', () => {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
  const result = renderer.render('search synth\nnewton().write(o0)\nrender(o0)', { width: 8, height: 8, time: 0.25 })
  assert.deepEqual([...result.toRgba8().slice(0, 8)], [87, 87, 87, 255, 86, 86, 86, 255])
})

test('scalar swizzles on texture calls retain their selected component', () => {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
  const result = renderer.render(
    'search synth, filter\nnoise(seed: 1, ridges: true).pixelSort().write(o0)\nrender(o0)',
    { width: 8, height: 8, time: 0.25 },
  )
  assert.deepEqual([...result.toRgba8().slice(0, 8)], [206, 186, 81, 255, 234, 137, 161, 255])
})

test('dynamic Bayer matrix indexing preserves the canonical dither threshold', () => {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
  const result = renderer.render(
    'search synth, filter\nnoise(seed: 1, ridges: true).dither().write(o0)\nrender(o0)',
    { width: 8, height: 8, time: 0.25 },
  )
  assert.deepEqual([...result.toRgba8().slice(0, 8)], [255, 255, 85, 255, 255, 170, 170, 255])
})

test('generated canonical median kernel binds scalar conversion callbacks', () => {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
  const result = renderer.render('search synth, filter\nsolid(color: #369).median().write(o0)\nrender(o0)', { width: 2, height: 2 })
  assert.ok(result.surface.data.every(Number.isFinite))
})

for (const [name, source, options] of [
  ['degauss', 'search synth, filter\nsolid(color: #369).degauss().write(o0)\nrender(o0)', {}],
  ['lens warp', 'search synth, filter\nsolid(color: #369).lensWarp().write(o0)\nrender(o0)', {}],
  ['outline', 'search synth, filter\nsolid(color: #369).outline().write(o0)\nrender(o0)', {}],
  ['curl', 'search synth\ncurl().write(o0)\nrender(o0)', {}],
  ['remap', 'search synth\nremap(bgColor: #369, bgAlpha: 0.75).write(o0)\nrender(o0)', {}],
]) {
  test(`generated canonical ${name} kernel emits finite default pixels`, () => {
    const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
    const result = renderer.render(source, { width: 2, height: 2, seed: 3, time: 0.25, ...options })
    assert.ok(result.surface.data.every(Number.isFinite))
  })
}

test('smooth blur preserves finite vector-weighted texel accumulation', () => {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
  const result = renderer.render(
    'search synth, filter\nmodPattern().smooth(type: blur, radius: 4).write(o0)\nrender(o0)',
    { width: 4, height: 4, time: 0.25 },
  )
  assert.ok(result.surface.data.every(Number.isFinite))
})

for (const [name, source] of [
  ['classic fractal', 'search classicNoisedeck\nfractal().write(o0)\nrender(o0)'],
  ['historic palette', 'search synth, filter\nsolid(color: #369).historicPalette().write(o0)\nrender(o0)'],
  ['cosine palette', 'search synth, filter\nsolid(color: #369).palette().write(o0)\nrender(o0)'],
  ['Julia', 'search synth\njulia(iterations: 50).write(o0)\nrender(o0)'],
]) {
  test(`canonical ${name} compatibility adapter emits finite pixels`, () => {
    const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
    const result = renderer.render(source, { width: 2, height: 2, seed: 3, time: 0.25 })
    assert.ok(result.surface.data.every(Number.isFinite))
  })
}

test('canonical remap routes odd and even packed polygon vertices', () => {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
  const result = renderer.render(`search synth
solid(color: #f00).write(o0)
remap(zoneCount: 1, bgColor: #00f, zone0_tex: o0, zone0_count: 3,
  zone0_v0: [0, 0, 1, 0], zone0_v1: [0, 1, 0, 0]).write(o1)
render(o1)`, { width: 4, height: 4 })
  const red = []
  const blue = []
  for (let index = 0; index < result.surface.data.length; index += 4) {
    red.push(result.surface.data[index])
    blue.push(result.surface.data[index + 2])
  }
  assert.ok(red.some((value) => value > 0.5))
  assert.ok(blue.some((value) => value > 0.5))
})

test('median compatibility kernel preserves unsigned packed whole-color ordering', () => {
  const data = new Float32Array(3 * 3 * 4)
  for (let index = 0; index < data.length; index += 4) data.set([1, 0, 0, 1], index)
  data.set([0, 0, 1, 0.25], (1 * 3 + 1) * 4)
  const input = new Surface(3, 3, data)
  const kernel = bindCanonicalKernel(kernelFactories.get('filter/median:median'), {
    width: 3,
    height: 3,
    uniforms: { RADIUS: 1, threshold: 0 },
    textures: { inputTex: input },
  })
  const out = new Float32Array(4)
  kernel({ fragCoord: new Float32Array([1.5, 1.5]), uv: new Float32Array([0.5, 0.5]), resolution: new Float32Array([3, 3]) }, out)
  assert.deepEqual([...out], [1, 0, 0, 0.25])
})
