import assert from 'node:assert/strict'
import test from 'node:test'

import { EffectDefinition } from '../src/effects/definition.js'
import { EffectRegistry } from '../src/effects/registry.js'
import { CpuRenderer } from '../src/runtime/renderer.js'

function fillFactory($bindings, runtime) {
  return function fillKernel(context, out) {
    runtime.beginPixel(context)
    out[0] = $bindings.value
    out[1] = 0
    out[2] = 0
    out[3] = 1
  }
}

function addFactory($bindings, runtime) {
  const sample = runtime.stdlib.texture
  return function addKernel(context, out) {
    runtime.beginPixel(context)
    const color = sample($bindings.inputTex, context.uv)
    out[0] = color[0] + $bindings.amount
    out[1] = color[1]
    out[2] = color[2]
    out[3] = color[3]
  }
}

function compositeFactory($bindings, runtime) {
  const sample = runtime.stdlib.texture
  return function compositeKernel(context, out) {
    runtime.beginPixel(context)
    const original = sample($bindings.originalTex, context.uv)
    const processed = sample($bindings.processedTex, context.uv)
    out[0] = original[0] + processed[0]
    out[1] = 0
    out[2] = 0
    out[3] = 1
  }
}

function externalFactory($bindings, runtime) {
  const sample = runtime.stdlib.texture
  return function externalKernel(context, out) {
    runtime.beginPixel(context)
    runtime.writeColor(sample($bindings.imageTex, context.uv), out)
  }
}

function externalFilterFactory($bindings, runtime) {
  return function externalFilterKernel(context, out) {
    runtime.beginPixel(context)
    runtime.writeColor(runtime.stdlib.texture($bindings.imageTex, [0.5, 0.5]), out)
  }
}

function surfaceFallbackFactory($bindings, runtime) {
  const sample = runtime.stdlib.texture
  return function surfaceFallbackKernel(context, out) {
    runtime.beginPixel(context)
    const input = sample($bindings.inputTex, context.uv)
    const optional = sample($bindings.optionalTex, context.uv)
    out[0] = (input[0] + optional[0] * $bindings.optional_active) * $bindings.gain
    out[1] = 0
    out[2] = 0
    out[3] = 1
  }
}

// Writes two distinguishable RGBA chunks in one invocation; `outputNames` (location-ascending)
// is how the executor learns which chunk belongs to which declared GLSL output variable.
function mrtFactory($bindings, runtime) {
  return function mrtKernel(context, out) {
    runtime.beginPixel(context)
    out[0] = 0.125
    out[1] = 0.25
    out[2] = 0.375
    out[3] = 1
    out[4] = 0.625
    out[5] = 0.75
    out[6] = 0.875
    out[7] = 1
  }
}
mrtFactory.outputNames = ['outA', 'outB']

function combineFactory($bindings, runtime) {
  const sample = runtime.stdlib.texture
  return function combineKernel(context, out) {
    runtime.beginPixel(context)
    const a = sample($bindings.aTex, context.uv)
    const b = sample($bindings.bTex, context.uv)
    out[0] = a[0]
    out[1] = a[1]
    out[2] = b[0]
    out[3] = b[1]
  }
}

// Writes this pass's own destination resolution into red/green, proving texture-size resolution.
function writeResolutionFactory($bindings, runtime) {
  return function writeResolutionKernel(context, out) {
    runtime.beginPixel(context)
    out[0] = $bindings.resolution[0]
    out[1] = $bindings.resolution[1]
    out[2] = 0
    out[3] = 1
  }
}

function probeFactory($bindings, runtime) {
  const sample = runtime.stdlib.texture
  return function probeKernel(context, out) {
    runtime.beginPixel(context)
    const grid = sample($bindings.gridTex, context.uv)
    const agents = sample($bindings.agentsTex, context.uv)
    out[0] = grid[0]
    out[1] = agents[0]
    out[2] = 0
    out[3] = 1
  }
}

function writeTinyFactory($bindings, runtime) {
  return function writeTinyKernel(context, out) {
    runtime.beginPixel(context)
    out[0] = 0.00001
    out[1] = 0
    out[2] = 0
    out[3] = 1
  }
}

function copyFactory($bindings, runtime) {
  const sample = runtime.stdlib.texture
  return function copyKernel(context, out) {
    runtime.beginPixel(context)
    runtime.writeColor(sample($bindings.srcTex, context.uv), out)
  }
}

function fixture() {
  const definitions = [
    new EffectDefinition({
      namespace: 'synth', func: 'fill', kind: 'generator', params: { value: { type: 'float', default: 0.1, uniform: 'value' } },
      passes: [{ name: 'render', program: 'fill', inputs: {}, outputs: { fragColor: 'outputTex' } }],
    }),
    new EffectDefinition({
      namespace: 'filter', func: 'optional', kind: 'mixer',
      params: {
        optional: { type: 'surface', default: 'none', colorModeUniform: 'optional_active' },
        value: { type: 'float', default: 1, uniform: 'gain' },
      },
      textures: { generatedOverlay: { width: 'screen', height: 'screen', format: 'rgba8' } },
      passes: [{ name: 'render', program: 'optional', inputs: { inputTex: 'inputTex', optionalTex: 'optional', overlayTex: 'generatedOverlay' }, uniforms: { gain: 'gain' }, outputs: { fragColor: 'outputTex' } }],
    }),
    new EffectDefinition({
      namespace: 'filter', func: 'multi', kind: 'filter', params: { amount: { type: 'float', default: 0.1, uniform: 'amount' } },
      passes: [
        { name: 'seed', program: 'add', inputs: { inputTex: 'inputTex' }, outputs: { fragColor: '_state' } },
        { name: 'repeat', program: 'add', inputs: { inputTex: '_state' }, outputs: { fragColor: '_state' }, repeat: 2 },
        { name: 'composite', program: 'composite', inputs: { originalTex: 'inputTex', processedTex: '_state' }, outputs: { fragColor: 'outputTex' } },
      ],
      textures: { _state: { width: '50%', height: '50%', format: 'rgba16f' } },
    }),
    new EffectDefinition({
      namespace: 'synth', func: 'external', kind: 'generator', params: {}, externalTexture: 'imageTex',
      passes: [{ name: 'render', program: 'external', inputs: { imageTex: 'imageTex' }, outputs: { fragColor: 'outputTex' } }],
    }),
    new EffectDefinition({
      namespace: 'synth', func: 'externalFilter', kind: 'generator', params: {}, externalTexture: 'imageTex',
      passes: [{ name: 'render', program: 'externalFilter', inputs: { imageTex: 'imageTex' }, outputs: { fragColor: 'outputTex' } }],
    }),
    // String-valued repeat: a single pass reads and writes the reserved `inputTex` resource
    // slot itself (the one resource guaranteed pre-seeded before a single pass's first
    // iteration), so it ping-pongs across `iterations` runs; the final iteration's write
    // becomes the effect's result via the `lastOutput` fallback (no pass ever names its
    // output `outputTex`).
    new EffectDefinition({
      namespace: 'filter', func: 'repeatUniform', kind: 'filter',
      params: { iterations: { type: 'int', default: 3, uniform: 'iterations' } },
      passes: [
        {
          name: 'accumulate',
          program: 'add',
          inputs: { inputTex: 'inputTex' },
          outputs: { fragColor: 'inputTex' },
          uniforms: { amount: 0.125 },
          repeat: 'iterations',
        },
      ],
    }),
    // Conditional passes: exactly one of the two branches is active for a given `mode`.
    new EffectDefinition({
      namespace: 'filter', func: 'conditional', kind: 'filter',
      params: { mode: { type: 'int', default: 0, uniform: 'mode' } },
      passes: [
        {
          name: 'branchA', program: 'fill', inputs: {}, outputs: { fragColor: 'outputTex' },
          uniforms: { value: 0.25 }, conditions: { runIf: [{ uniform: 'mode', equals: 0 }] },
        },
        {
          name: 'branchB', program: 'fill', inputs: {}, outputs: { fragColor: 'outputTex' },
          uniforms: { value: 0.75 }, conditions: { runIf: [{ uniform: 'mode', equals: 1 }] },
        },
      ],
    }),
    // MRT: one pass writes two named destinations at once; a follow-up pass samples both.
    new EffectDefinition({
      namespace: 'filter', func: 'mrt', kind: 'filter', params: {},
      textures: {
        _texA: { width: 'input', height: 'input', format: 'rgba16f' },
        _texB: { width: 'input', height: 'input', format: 'rgba16f' },
      },
      passes: [
        { name: 'split', program: 'mrt', inputs: {}, outputs: { outA: '_texA', outB: '_texB' }, drawBuffers: 2 },
        { name: 'combine', program: 'combine', inputs: { aTex: '_texA', bTex: '_texB' }, outputs: { fragColor: 'outputTex' } },
      ],
    }),
    // MRT with mismatched declared destination sizes — must throw loudly, not scramble pixels.
    new EffectDefinition({
      namespace: 'filter', func: 'mrtMismatch', kind: 'filter', params: {},
      textures: {
        _texA: { width: 'input', height: 'input', format: 'rgba16f' },
        _texB: { width: 2, height: 2, format: 'rgba16f' },
      },
      passes: [
        { name: 'split', program: 'mrt', inputs: {}, outputs: { outA: '_texA', outB: '_texB' }, drawBuffers: 2 },
      ],
    }),
    // Object-shaped texture sizes: `_grid` via screenDivide, `_agents` via param.
    new EffectDefinition({
      namespace: 'filter', func: 'sizedScratch', kind: 'filter',
      params: {
        zoom: { type: 'int', default: 4, uniform: 'zoom' },
        stateSize: { type: 'int', default: 8, uniform: 'stateSize' },
      },
      textures: {
        _grid: { width: { screenDivide: 'zoom', default: 4 }, height: { screenDivide: 'zoom', default: 4 }, format: 'rgba16f' },
        _agents: { width: { param: 'stateSize', default: 8 }, height: { param: 'stateSize', default: 8 }, format: 'rgba16f' },
      },
      passes: [
        { name: 'writeGrid', program: 'writeResolution', inputs: {}, outputs: { fragColor: '_grid' } },
        { name: 'writeAgents', program: 'writeResolution', inputs: {}, outputs: { fragColor: '_agents' } },
        { name: 'probe', program: 'probe', inputs: { gridTex: '_grid', agentsTex: '_agents' }, outputs: { fragColor: 'outputTex' } },
      ],
    }),
    // rgba32f: both the scratch texture and outputTex stay full-precision end to end.
    new EffectDefinition({
      namespace: 'filter', func: 'highPrecision', kind: 'filter', params: {},
      textures: {
        _precise: { width: 'input', height: 'input', format: 'rgba32f' },
        outputTex: { width: 'input', height: 'input', format: 'rgba32f' },
      },
      passes: [
        { name: 'writePrecise', program: 'writeTiny', inputs: {}, outputs: { fragColor: '_precise' } },
        { name: 'readBack', program: 'copy', inputs: { srcTex: '_precise' }, outputs: { fragColor: 'outputTex' } },
      ],
    }),
  ]
  return new CpuRenderer({
    registry: new EffectRegistry(definitions),
    kernelFactories: new Map([
      ['synth/fill:fill', fillFactory],
      ['filter/multi:add', addFactory],
      ['filter/multi:composite', compositeFactory],
      ['synth/external:external', externalFactory],
      ['synth/externalFilter:externalFilter', externalFilterFactory],
      ['filter/optional:optional', surfaceFallbackFactory],
      ['filter/repeatUniform:add', addFactory],
      ['filter/conditional:fill', fillFactory],
      ['filter/mrt:mrt', mrtFactory],
      ['filter/mrt:combine', combineFactory],
      ['filter/mrtMismatch:mrt', mrtFactory],
      ['filter/sizedScratch:writeResolution', writeResolutionFactory],
      ['filter/sizedScratch:probe', probeFactory],
      ['filter/highPrecision:writeTiny', writeTinyFactory],
      ['filter/highPrecision:copy', copyFactory],
    ]),
    tileRows: 2,
  })
}

test('canonical graphs route named textures, preserve original input, size and quantize intermediates, and repeat passes', () => {
  const result = fixture().render('search synth, filter\nfill().multi().write(o0)\nrender(o0)', { width: 4, height: 4 })

  assert.equal(result.surface.data[0], 0.49951171875)
  assert.equal(result.stats.passes, 5)
  assert.equal(result.stats.pixels, 16 + 4 + 4 + 4 + 16)
})

test('optional canonical surfaces bind transparent fallback textures and activity uniforms', () => {
  const program = 'search synth, filter\nfill(value: 0.25).optional().write(o0)\nrender(o0)'
  const result = fixture().render(program, { width: 1, height: 1 })
  assert.equal(result.surface.data[0], 0.25)
})

test('canonical graphs bind caller-provided external surfaces by declared texture name', async () => {
  const { Surface } = await import('../src/runtime/surface.js')
  const image = new Surface(1, 1, new Float32Array([0.25, 0.5, 0.75, 1]))
  const program = 'search synth\nexternal().write(o0)\nrender(o0)'
  const result = fixture().render(program, { width: 1, height: 1, externalTextures: { imageTex: image } })

  assert.deepEqual([...result.surface.data], [0.25, 0.5, 0.75, 1])
  assert.throws(() => fixture().render(program, { width: 1, height: 1 }), /requires external texture "imageTex"/)
})

test('canonical external textures use linear filtering', async () => {
  const { Surface } = await import('../src/runtime/surface.js')
  const image = new Surface(2, 2, new Float32Array([
    1, 0, 0, 1, 0, 1, 0, 1,
    0, 0, 1, 1, 1, 1, 1, 1,
  ]))
  const result = fixture().render('search synth\nexternalFilter().write(o0)\nrender(o0)', {
    width: 1,
    height: 1,
    externalTextures: { imageTex: image },
  })
  assert.deepEqual([...result.surface.data], [0.5, 0.5, 0.5, 1])
})

test('string-valued pass.repeat resolves from uniforms', async () => {
  const defaultProgram = 'search synth, filter\nfill(value: 0).repeatUniform().write(o0)\nrender(o0)'
  const defaultResult = fixture().render(defaultProgram, { width: 1, height: 1 })
  assert.equal(defaultResult.surface.data[0], 0.375) // 3 (default iterations) * 0.125

  const overrideProgram = 'search synth, filter\nfill(value: 0).repeatUniform(iterations: 5).write(o0)\nrender(o0)'
  const overrideResult = fixture().render(overrideProgram, { width: 1, height: 1 })
  assert.equal(overrideResult.surface.data[0], 0.625) // 5 * 0.125

  // Async twin must mirror the sync path byte-for-byte.
  const asyncResult = await fixture().renderAsync(overrideProgram, { width: 1, height: 1 })
  assert.deepEqual([...asyncResult.surface.data], [...overrideResult.surface.data])
})

test('conditional passes honor runIf equals', () => {
  const modeA = fixture().render('search filter\nconditional(mode: 0).write(o0)\nrender(o0)', { width: 1, height: 1 })
  const modeB = fixture().render('search filter\nconditional(mode: 1).write(o0)\nrender(o0)', { width: 1, height: 1 })

  assert.equal(modeA.surface.data[0], 0.25)
  assert.equal(modeA.stats.passes, 1) // proves branchB was skipped, not merely overwritten
  assert.equal(modeB.surface.data[0], 0.75)
  assert.equal(modeB.stats.passes, 1)
})

test('drawBuffers pass writes every named destination', async () => {
  const program = 'search filter\nmrt().write(o0)\nrender(o0)'
  const result = fixture().render(program, { width: 1, height: 1 })
  assert.deepEqual([...result.surface.data], [0.125, 0.25, 0.625, 0.75])

  const asyncResult = await fixture().renderAsync(program, { width: 1, height: 1 })
  assert.deepEqual([...asyncResult.surface.data], [...result.surface.data])
})

test('MRT destinations with mismatched resolved sizes throw instead of scrambling pixels', async () => {
  // _texA resolves to 4x4 (width:'input' against a 4x4 render); _texB is fixed at 2x2 —
  // a real-world analog of points/life's undeclared (screen-size) agent textures next to
  // its fixed-size global_life_data. Must fail loudly, not silently corrupt the smaller one.
  const program = 'search filter\nmrtMismatch().write(o0)\nrender(o0)'
  const expectedMessage = /filter\/mrtMismatch.*"split".*_texA \(4x4\).*_texB \(2x2\)/s

  assert.throws(() => fixture().render(program, { width: 4, height: 4 }), expectedMessage)
  await assert.rejects(() => fixture().renderAsync(program, { width: 4, height: 4 }), expectedMessage)
})

test('param and screenDivide texture sizes resolve', () => {
  const result = fixture().render('search filter\nsizedScratch().write(o0)\nrender(o0)', { width: 64, height: 64 })
  assert.equal(result.surface.data[0], 16) // _grid: ceil(64 / zoom-default 4)
  assert.equal(result.surface.data[1], 8) // _agents: stateSize default 8
})

test('rgba32f textures are not quantized', () => {
  const result = fixture().render('search filter\nhighPrecision().write(o0)\nrender(o0)', { width: 1, height: 1 })
  assert.equal(result.surface.data[0], Math.fround(0.00001))
})
