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
