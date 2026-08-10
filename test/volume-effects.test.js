import assert from 'node:assert/strict'
import test from 'node:test'

import { EffectDefinition } from '../src/effects/definition.js'
import { EffectRegistry } from '../src/effects/registry.js'
import { createDefaultRegistry, kernelFactories } from '../src/effects/catalog.js'
import { CpuRenderer } from '../src/runtime/renderer.js'

function volumeSeedFactory($bindings, runtime) {
  return function volumeSeedKernel(context, out) {
    runtime.beginPixel(context)
    out[0] = $bindings.resolution[0] / 100
    out[1] = $bindings.resolution[1] / 100
    out[2] = 0
    out[3] = 1
    out[4] = 0
    out[5] = 0.75
    out[6] = 0
    out[7] = 1
  }
}
volumeSeedFactory.outputNames = ['color', 'geoOut']

function volumeFilterFactory($bindings, runtime) {
  return function volumeFilterKernel(context, out) {
    runtime.beginPixel(context)
    const color = runtime.stdlib.texture($bindings.inputTex3d, context.uv)
    out[0] = $bindings.resolution[0] / 100
    out[1] = $bindings.resolution[1] / 100
    out[2] = color[0]
    out[3] = 1
  }
}

function volumeRenderFactory($bindings, runtime) {
  return function volumeRenderKernel(context, out) {
    runtime.beginPixel(context)
    const volume = runtime.stdlib.texture($bindings.volumeCache, [0.5, 0.5])
    const geometry = runtime.stdlib.texture($bindings.analyticalGeo, [0.5, 0.5])
    out[0] = volume[0]
    out[1] = volume[1]
    out[2] = geometry[1]
    out[3] = 1
    out[4] = $bindings.resolution[0] / 10
    out[5] = $bindings.resolution[1] / 10
    out[6] = 0
    out[7] = 1
  }
}
volumeRenderFactory.outputNames = ['color', 'geoOut']

function volumeStateFactory($bindings, runtime) {
  return function volumeStateKernel(context, out) {
    runtime.beginPixel(context)
    const previous = runtime.stdlib.texture($bindings.stateTex, context.uv)
    const seed = runtime.stdlib.texture($bindings.seedTex, context.uv)
    out[0] = previous[0] + seed[0] + 0.1
    out[1] = 0
    out[2] = 0
    out[3] = 1
  }
}

function volumeSizeFilterFactory($bindings, runtime) {
  return function volumeSizeFilterKernel(context, out) {
    runtime.beginPixel(context)
    out[0] = $bindings.volumeSize / 10
    out[1] = 0
    out[2] = 0
    out[3] = 1
  }
}

function volumeSizeRenderFactory($bindings, runtime) {
  return function volumeSizeRenderKernel(context, out) {
    runtime.beginPixel(context)
    out[0] = $bindings.volumeSize / 10
    out[1] = 0
    out[2] = 0
    out[3] = 1
  }
}

function volumeSizeStateFactory($bindings, runtime) {
  return function volumeSizeStateKernel(context, out) {
    runtime.beginPixel(context)
    out[0] = $bindings.volumeSize / 10
    out[1] = 0
    out[2] = 0
    out[3] = 1
  }
}

function volumeFixture() {
  const registry = new EffectRegistry()
  const volumeSizeParam = { type: 'int', default: 4, uniform: 'volumeSize' }
  const atlas = {
    width: { param: 'volumeSize', default: 4 },
    height: { param: 'volumeSize', power: 2, default: 16 },
    format: 'rgba16f',
  }
  registry.register(new EffectDefinition({
    namespace: 'synth3d', func: 'volumeSeed', kind: 'generator', domain: 'volume-generator',
    params: { volumeSize: volumeSizeParam },
    textures: { volumeCache: atlas, geoBuffer: atlas },
    passes: [{
      name: 'seed', program: 'seed', drawBuffers: 2,
      viewport: { width: atlas.width, height: atlas.height },
      inputs: {}, outputs: { color: 'volumeCache', geoOut: 'geoBuffer' },
    }],
    outputTex3d: 'volumeCache', outputGeo: 'geoBuffer',
  }))
  registry.register(new EffectDefinition({
    namespace: 'synth3d', func: 'volumeState', kind: 'generator', domain: 'volume-generator', iterated: true,
    params: {
      volumeSize: volumeSizeParam,
      source: { type: 'volume', default: 'vol0' },
      iterationCount: { type: 'int', default: 60, min: 0, max: 10000 },
    },
    textures: { global_volume_state: atlas, geoBuffer: atlas },
    passes: [{
      name: 'advance', program: 'state',
      viewport: { width: atlas.width, height: atlas.height },
      inputs: { stateTex: 'global_volume_state', seedTex: 'source' }, outputs: { fragColor: 'global_volume_state' },
    }],
    outputTex3d: 'global_volume_state', outputGeo: 'geoBuffer',
  }))
  registry.register(new EffectDefinition({
    namespace: 'synth3d', func: 'volumeSizeState', kind: 'generator', domain: 'volume-generator', iterated: true,
    params: {
      volumeSize: { type: 'int', default: 8, uniform: 'volumeSize' },
      source: { type: 'volume', default: 'vol0' },
      iterationCount: { type: 'int', default: 60, min: 0, max: 10000 },
    },
    textures: {
      global_size_state: {
        width: { param: 'volumeSize', default: 8 },
        height: { param: 'volumeSize', power: 2, default: 64 },
        format: 'rgba16f',
      },
    },
    passes: [{
      name: 'advance', program: 'sizeState',
      inputs: { seedTex: 'source' }, outputs: { fragColor: 'global_size_state' },
    }],
    outputTex3d: 'global_size_state', outputGeo: 'inputGeo',
  }))
  registry.register(new EffectDefinition({
    namespace: 'filter3d', func: 'volumeFilter', kind: 'filter', domain: 'volume-filter',
    params: { volumeSize: { type: 'int', default: 8, uniform: 'volumeSize' } },
    textures: { volumeCache: atlas },
    passes: [{
      name: 'filter', program: 'filter',
      viewport: {
        width: { param: 'volumeSize', default: 8, inputOverride: 'inputTex3d' },
        height: { param: 'volumeSize', power: 2, default: 64, inputOverride: 'inputTex3d' },
      },
      inputs: { inputTex3d: 'inputTex3d' }, outputs: { fragColor: 'volumeCache' },
    }],
    outputTex3d: 'volumeCache', outputGeo: 'inputGeo',
  }))
  registry.register(new EffectDefinition({
    namespace: 'filter3d', func: 'volumeSizeFilter', kind: 'filter', domain: 'volume-filter',
    params: { volumeSize: { type: 'int', default: 8, uniform: 'volumeSize' } },
    textures: {
      volumeCache: {
        width: { param: 'volumeSize', default: 8 },
        height: { param: 'volumeSize', power: 2, default: 64 },
        format: 'rgba16f',
      },
    },
    passes: [{
      name: 'filter', program: 'sizeFilter',
      viewport: {
        width: { param: 'volumeSize', default: 8, inputOverride: 'inputTex3d' },
        height: { param: 'volumeSize', power: 2, default: 64, inputOverride: 'inputTex3d' },
      },
      inputs: { inputTex3d: 'inputTex3d' }, outputs: { fragColor: 'volumeCache' },
    }],
    outputTex3d: 'volumeCache', outputGeo: 'inputGeo',
  }))
  registry.register(new EffectDefinition({
    namespace: 'render', func: 'volumeRender', kind: 'filter', domain: 'volume-renderer',
    params: { volumeSize: volumeSizeParam },
    textures: { screenGeoBuffer: { width: 'resolution', height: 'resolution', format: 'rgba16f' } },
    passes: [{
      name: 'render', program: 'render', drawBuffers: 2,
      inputs: { volumeCache: 'inputTex3d', analyticalGeo: 'inputGeo' },
      outputs: { color: 'outputTex', geoOut: 'screenGeoBuffer' },
    }],
    outputTex3d: 'inputTex3d', outputGeo: 'screenGeoBuffer',
  }))
  registry.register(new EffectDefinition({
    namespace: 'render', func: 'volumeSizeRender', kind: 'filter', domain: 'volume-renderer',
    params: { volumeSize: { type: 'int', default: 8, uniform: 'volumeSize' } },
    textures: {},
    passes: [{
      name: 'render', program: 'sizeRender',
      inputs: { volumeCache: 'inputTex3d' }, outputs: { fragColor: 'outputTex' },
    }],
    outputTex3d: 'inputTex3d', outputGeo: 'inputGeo',
  }))
  registry.register(new EffectDefinition({
    namespace: 'synth3d', func: 'badVolume', kind: 'generator', domain: 'volume-generator',
    params: { volumeSize: volumeSizeParam },
    textures: {
      volumeCache: { width: 4, height: 8, format: 'rgba16f' },
      geoBuffer: { width: 4, height: 8, format: 'rgba16f' },
    },
    passes: [{
      name: 'seed', program: 'seed', drawBuffers: 2,
      inputs: {}, outputs: { color: 'volumeCache', geoOut: 'geoBuffer' },
    }],
    outputTex3d: 'volumeCache', outputGeo: 'geoBuffer',
  }))

  const kernelFactories = new Map([
    ['synth3d/volumeSeed:seed', volumeSeedFactory],
    ['synth3d/volumeState:state', volumeStateFactory],
    ['synth3d/volumeSizeState:sizeState', volumeSizeStateFactory],
    ['filter3d/volumeFilter:filter', volumeFilterFactory],
    ['filter3d/volumeSizeFilter:sizeFilter', volumeSizeFilterFactory],
    ['render/volumeRender:render', volumeRenderFactory],
    ['render/volumeSizeRender:sizeRender', volumeSizeRenderFactory],
    ['synth3d/badVolume:seed', volumeSeedFactory],
  ])
  return new CpuRenderer({ registry, kernelFactories, tileRows: 2 })
}

test('volume and geometry atlases flow through generator, filter, and renderer channels', () => {
  // Break caught: returning only the last pass Surface from a volume generator loses either
  // volumeCache or geoBuffer before the downstream renderer can sample both.
  const result = volumeFixture().render(`
    search synth3d, filter3d, render
    volumeSeed(volumeSize: 4).volumeFilter(volumeSize: 8).volumeRender(volumeSize: 4).write(o0)
    render(o0)
  `, { width: 2, height: 2 })

  const pixel = result.surface.data.slice(0, 4)
  assert.ok(Math.abs(pixel[0] - 0.04) < 0.001, `volume width marker: ${pixel[0]}`)
  assert.ok(Math.abs(pixel[1] - 0.16) < 0.001, `volume height marker: ${pixel[1]}`)
  assert.ok(Math.abs(pixel[2] - 0.75) < 0.001, `geometry marker: ${pixel[2]}`)
  assert.equal(pixel[3], 1)
})

test('volume atlas validation rejects dimensions that are not N by N squared', () => {
  // Break caught: silently accepting a 4x8 atlas as volumeSize=4 makes 3D slice addressing read
  // unrelated rows instead of failing at the producer boundary.
  assert.throws(
    () => volumeFixture().render(`
      search synth3d, render
      badVolume(volumeSize: 4).volumeRender(volumeSize: 4).write(o0)
      render(o0)
    `, { width: 2, height: 2 }),
    /synth3d\/badVolume volume atlas expected 4x16, received 4x8/,
  )
})

test('volume atlas allocation is bounded before a numeric volumeSize can exhaust memory', () => {
  assert.throws(
    () => volumeFixture().render(`
      search synth3d, render
      volumeSeed(volumeSize: 4096).volumeRender(volumeSize: 4096).write(o0)
      render(o0)
    `, { width: 1, height: 1 }),
    /16,777,216 pixel limit/,
  )
})

test('stateful volume groups advance within one render and reset between render calls', () => {
  const program = (iterations) => `
    search synth3d, render
    volumeState(volumeSize: 4, iterationCount: ${iterations}).volumeRender(volumeSize: 4).write(o0)
    render(o0)
  `
  const renderer = volumeFixture()
  const n1 = renderer.render(program(1), { width: 1, height: 1 })
  const n3 = renderer.render(program(3), { width: 1, height: 1 })
  const n3Again = renderer.render(program(3), { width: 1, height: 1 })
  const n0 = renderer.render(program(0), { width: 1, height: 1 })
  assert.ok(Math.abs(n1.surface.data[0] - 0.1) < 0.002)
  assert.ok(Math.abs(n3.surface.data[0] - 0.3) < 0.002)
  assert.deepEqual([...n3Again.surface.data], [...n3.surface.data])
  assert.equal(n0.surface.data[0], 0)
})

test('canonical stateful 3D generators consume an upstream volume and render finite pixels', () => {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernelFactories, tileRows: 2 })
  for (const effect of ['cellularAutomata3d', 'reactionDiffusion3d']) {
    const result = renderer.render(`
      search synth3d, render
      noise3d(seed: 0, volumeSize: x16)
        .${effect}(volumeSize: x16, iterationCount: 1)
        .render3d(volumeSize: v16)
        .write(o0)
      render(o0)
    `, { width: 2, height: 2, time: 0.25, seed: 1 })
    assert.ok(result.surface.data.every(Number.isFinite), `${effect} emitted a non-finite channel`)
  }
})

test('downstream volume filters and renderers inherit the incoming atlas size for uniforms', () => {
  const renderer = volumeFixture()
  const filtered = renderer.render(`
    search synth3d, filter3d, render
    volumeSeed(volumeSize: 4)
      .volumeSizeFilter(volumeSize: 8)
      .volumeRender(volumeSize: 4)
      .write(o0)
    render(o0)
  `, { width: 1, height: 1 })
  const rendered = renderer.render(`
    search synth3d, render
    volumeSeed(volumeSize: 4).volumeSizeRender(volumeSize: 8).write(o0)
    render(o0)
  `, { width: 1, height: 1 })

  assert.ok(Math.abs(filtered.surface.data[0] - 0.4) < 0.002, `filter volumeSize: ${filtered.surface.data[0]}`)
  assert.ok(Math.abs(rendered.surface.data[0] - 0.4) < 0.002, `renderer volumeSize: ${rendered.surface.data[0]}`)
})

test('async volume rendering inherits the incoming atlas size for uniforms', async () => {
  const result = await volumeFixture().renderAsync(`
    search synth3d, render
    volumeSeed(volumeSize: 4).volumeSizeRender().write(o0)
    render(o0)
  `, { width: 1, height: 1, scheduler: async () => {} })

  assert.ok(Math.abs(result.surface.data[0] - 0.4) < 0.002, `async renderer volumeSize: ${result.surface.data[0]}`)
})

test('iterated volume generators inherit the incoming atlas size before state allocation and uniform binding', () => {
  const result = volumeFixture().render(`
    search synth3d, render
    volumeSeed(volumeSize: 4)
      .volumeSizeState(volumeSize: 8, iterationCount: 1)
      .volumeRender(volumeSize: 4)
      .write(o0)
    render(o0)
  `, { width: 1, height: 1 })

  assert.ok(Math.abs(result.surface.data[0] - 0.4) < 0.002, `iterated volumeSize: ${result.surface.data[0]}`)
})
