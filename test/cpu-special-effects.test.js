import assert from 'node:assert/strict'
import test from 'node:test'

import { canonicalAdapterFactories, createDefaultRegistry, kernelFactories, kernels } from '../src/effects/catalog.js'
import { CpuRenderer } from '../src/runtime/renderer.js'

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
