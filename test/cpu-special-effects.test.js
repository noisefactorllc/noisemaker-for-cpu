import assert from 'node:assert/strict'
import test from 'node:test'

import { canonicalAdapterFactories, canonicalKernelFactories, createDefaultRegistry, kernelFactories, kernels } from '../src/effects/catalog.js'
import { crtFactory } from '../src/effects/adapters/crt.js'
import { CpuRenderer } from '../src/runtime/renderer.js'
import { readPng } from '../src/node/png.js'
import { compareRgba8 } from '../scripts/parity/lib.js'

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

async function readGoldenCrt() {
  const goldenPath = resolve(dirname(fileURLToPath(import.meta.url)), '../parity/goldens/defaults/filter__crt.golden.png')
  const golden = await readPng(goldenPath)
  return golden.data
}

function renderer() {
  return new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories, tileRows: 8 })
}

test('snow uses its float32 semantic adapter for GPU operation boundaries', () => {
  assert.equal(kernelFactories.get('filter/snow:snow'), canonicalAdapterFactories['filter/snow:snow'])
  const result = renderer().render(
    'search filter, synth\nnoise(seed: 1, ridges: true).snow().write(o0)\nrender(o0)',
    { width: 8, height: 8, time: 0.25, oneShot: 'initial' },
  )
  assert.deepEqual(
    [...result.toRgba8().slice(0, 16)],
    [160, 147, 81, 255, 103, 76, 88, 255, 110, 82, 150, 255, 119, 67, 16, 255],
  )
})

test('CRT uses its reduced-turn sine adapter for Metal fast-math range reduction', () => {
  assert.equal(kernelFactories.get('filter/crt:crt'), canonicalAdapterFactories['filter/crt:crt'])
})

test('cosine-wrap configurations: no-op on metalSine, two-variable delta on plain sin', async () => {
  // Characterization evidence for docs/CRT-PARITY.md. Three configurations, measured
  // 2026-09-26:
  //   plain     — committed adapter (metalSine, no cos wrap): the recorded baseline.
  //   wrapped   — metalSine + turn-based metalCosine (the reverted 8debec5 configuration,
  //               rebuilt through crtFactory with a cos-extended stdlib): byte-identical to
  //               plain, so the cos wrap is a no-op on top of the retained sine adapter.
  //   rawWrap   — plain runtime sin + metalCosine (no sine adapter): the two-variable
  //               configuration behind the earlier 94/105/5.86328125 figures; its delta from
  //               plain confounds the sine and cosine variables and is pinned only to keep
  //               the measured numbers honest.
  const F32 = Math.fround
  const TAU = F32(6.283185307179586)
  const INV_TAU = F32(1 / 6.283185307179586)
  const metalCosine = (value) => {
    const turns = F32(value * INV_TAU)
    const phase = turns - Math.floor(turns)
    return F32(Math.cos(phase * TAU))
  }
  const cosWrappedAdapterFactory = ($bindings, $runtime) => {
    const runtime = Object.create($runtime)
    const cos = (value) => {
      if (!ArrayBuffer.isView(value) && !Array.isArray(value)) return metalCosine(value)
      const out = $runtime.alloc(value.length)
      for (let index = 0; index < value.length; index += 1) out[index] = metalCosine(value[index])
      return out
    }
    runtime.stdlib = Object.freeze({ ...$runtime.stdlib, cos })
    // Route through the committed adapter so metalSine stays in effect: crtFactory builds
    // its stdlib from $runtime.stdlib, so the canonical kernel's cos destructure resolves to
    // metalCosine while sin resolves to the adapter's metalSine — exactly the 8debec5 config.
    const composedRuntime = Object.create($runtime)
    composedRuntime.stdlib = runtime.stdlib
    return crtFactory($bindings, composedRuntime)
  }
  const rawCosAdapterFactory = ($bindings, $runtime) => {
    const runtime = Object.create($runtime)
    runtime.stdlib = Object.freeze({ ...$runtime.stdlib, cos: metalCosine })
    return canonicalKernelFactories['filter/crt:crt']($bindings, runtime)
  }
  const source = 'search synth, filter\nnoise(seed: 1, ridges: true).crt(seed: 1).write(o0)\nrender(o0)'
  const options = { width: 8, height: 8, time: 0.25, seed: 1, oneShot: 'initial' }
  const plain = renderer().render(source, options).toRgba8()
  const wrapped = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories: new Map(kernelFactories).set('filter/crt:crt', cosWrappedAdapterFactory), tileRows: 8 }).render(source, options).toRgba8()
  const rawWrapped = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories: new Map(kernelFactories).set('filter/crt:crt', rawCosAdapterFactory), tileRows: 8 }).render(source, options).toRgba8()
  const goldenData = await readGoldenCrt()
  const plainMetrics = compareRgba8(plain, goldenData, 2)
  const wrappedMetrics = compareRgba8(wrapped, goldenData, 2)
  const rawMetrics = compareRgba8(rawWrapped, goldenData, 2)
  assert.deepEqual([...wrapped], [...plain])
  assert.equal(plainMetrics.channelsOverTolerance, 89)
  assert.equal(plainMetrics.maxError, 80)
  assert.equal(plainMetrics.meanError, 5.05859375)
  assert.equal(rawMetrics.channelsOverTolerance, 94)
  assert.equal(rawMetrics.maxError, 105)
  assert.equal(rawMetrics.meanError, 5.86328125)
})

test('bitEffects uses its scalar bit-mask adapter and matches the canonical first pixel', () => {
  assert.equal(
    kernelFactories.get('classicNoisedeck/bitEffects:bitEffects'),
    canonicalAdapterFactories['classicNoisedeck/bitEffects:bitEffects'],
  )
  const result = renderer().render(
    'search classicNoisedeck\nbitEffects(seed: 63).write(o0)\nrender(o0)',
    { width: 8, height: 8, time: 0.25, oneShot: 'initial' },
  )
  assert.deepEqual([...result.toRgba8().slice(0, 4)], [195, 119, 228, 255])
})

test('wormhole point deposit scatters every source pixel with additive luminance weighting', () => {
  const result = renderer().render(
    'search synth, filter\nsolid(color: #fff).wormhole(stride: 0, alpha: 1).write(o0)\nrender(o0)',
    { width: 1, height: 1 },
  )
  for (const channel of result.surface.data.slice(0, 3)) assert.ok(Math.abs(channel - 0.5) < 1e-6)
  assert.equal(result.surface.data[3], 1)
})

for (const [effect, base, predicate] of [
  ['fibers', '#000', (value) => value > 0],
  ['scratches', '#000', (value) => value > 0],
  ['strayHair', '#fff', (value) => value < 1],
]) {
  test(`${effect} builds its canonical deterministic CPU overlay before blending`, () => {
    const result = renderer().render(
      `search synth, filter\nsolid(color: ${base}).${effect}(density: 1, seed: 7, alpha: 1).write(o0)\nrender(o0)`,
      { width: 16, height: 16 },
    )
    assert.ok(result.surface.data.some((value, index) => index % 4 !== 3 && predicate(value)))
  })
}

test('one-shot CPU overlays can reproduce the upstream pre-init first frame', () => {
  const result = renderer().render(
    'search synth, filter\nsolid(color: #2b2b2b).scratches(alpha: 1).write(o0)\nrender(o0)',
    { width: 8, height: 8, oneShot: 'initial' },
  )
  assert.ok(result.surface.data.every((value, index) => index % 4 === 3 ? value === 1 : value === result.surface.data[index % 4]))
  assert.deepEqual([...result.toRgba8().slice(0, 4)], [43, 43, 43, 255])
})

test('one-shot CPU overlay cache is byte-bounded, LRU-evicted, and disposable', () => {
  const instance = new CpuRenderer({
    registry: createDefaultRegistry(), kernels, kernelFactories, tileRows: 8, cpuTextureCacheByteLimit: 1024,
  })
  for (const seed of [1, 2, 3]) {
    instance.render(
      `search synth, filter\nsolid().scratches(seed: ${seed}, density: 1).write(o0)\nrender(o0)`,
      { width: 8, height: 8 },
    )
  }
  assert.deepEqual(instance.cpuTextureCacheStats(), { entries: 1, bytes: 1024, byteLimit: 1024 })
  instance.dispose()
  assert.deepEqual(instance.cpuTextureCacheStats(), { entries: 0, bytes: 0, byteLimit: 1024 })
})
