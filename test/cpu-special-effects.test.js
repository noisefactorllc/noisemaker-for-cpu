import assert from 'node:assert/strict'
import test from 'node:test'

import { canonicalAdapterFactories, createDefaultRegistry, kernelFactories, kernels } from '../src/effects/catalog.js'
import { crtFactory, fma32 } from '../src/effects/adapters/crt.js'
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

test('CRT uses its float32 Metal-semantics adapter', () => {
  assert.equal(kernelFactories.get('filter/crt:crt'), canonicalAdapterFactories['filter/crt:crt'])
  assert.equal(canonicalAdapterFactories['filter/crt:crt'], crtFactory)
})

test('the CRT fused multiply-add rounds once like the GPU', () => {
  // Reference: exact rational a*b + c, rounded to the nearest float32 (ties to even).
  const exactFma = (a, b, c) => {
    const scale = 2n ** 300n
    const big = (value) => {
      const [mantissa, exponent] = (() => {
        if (value === 0) return [0n, 0]
        let e = 0
        let m = Math.abs(value)
        while (!Number.isInteger(m)) { m *= 2; e -= 1 }
        return [BigInt(m) * (value < 0 ? -1n : 1n), e]
      })()
      return exponent >= 0 ? mantissa * scale * 2n ** BigInt(exponent) : mantissa * scale / 2n ** BigInt(-exponent)
    }
    const exact = big(a) * big(b) / scale + big(c)
    const approx = Math.fround(Number(exact) / Number(scale))
    const candidates = [approx]
    const view = new Float32Array(1)
    const bits = new Int32Array(view.buffer)
    for (const step of [-1, 1]) { view[0] = approx; bits[0] += step; candidates.push(view[0]) }
    let best = candidates[0]
    let bestError = null
    for (const candidate of candidates) {
      const error = big(candidate) - exact
      const magnitude = error < 0n ? -error : error
      if (bestError === null || magnitude < bestError) { best = candidate; bestError = magnitude }
      else if (magnitude === bestError) {
        view[0] = candidate
        if ((bits[0] & 1) === 0) best = candidate
      }
    }
    return best
  }
  let state = 12345
  const next = () => { state = (Math.imul(state, 1103515245) + 12345) >>> 0; return state / 4294967296 }
  // A float64 a*b + c lands exactly on a float32 midpoint here, so rounding it
  // again would double-round; fma32 must round the exact value once.
  const doubleRounding = [
    [1.1836352348327637, 1.7818914651870728, -1.931027560075904e-9],
    [1.715787649154663, 1.694210410118103, -3.285236749306364e-9],
    [1.5398544073104858, 1.8304558992385864, -9.061266736942741e-10],
  ]
  for (const [a, b, c] of doubleRounding.map((values) => values.map(Math.fround))) {
    assert.notEqual(Math.fround(a * b + c), exactFma(a, b, c))
    assert.equal(fma32(a, b, c), exactFma(a, b, c))
  }
  for (const [a, b, c] of [[1, 1 + 2 ** -23, 2 ** -24], [3, 1 / 3, -1]].map((values) => values.map(Math.fround))) {
    assert.equal(fma32(a, b, c), exactFma(a, b, c))
  }
  for (let index = 0; index < 2000; index += 1) {
    const a = Math.fround((next() - 0.5) * 2 ** Math.floor(next() * 20 - 10))
    const b = Math.fround((next() - 0.5) * 2 ** Math.floor(next() * 20 - 10))
    const c = Math.fround((next() - 0.5) * 2 ** Math.floor(next() * 40 - 20))
    assert.equal(fma32(a, b, c), exactFma(a, b, c), `fma32(${a}, ${b}, ${c})`)
  }
})

test('CRT reproduces the Apple Metal capture bytes and stays within the golden tolerance', async () => {
  // Readbacks of global_o0_write from the pinned upstream CanvasRenderer (WebGL2,
  // ANGLE Metal Renderer: Apple M2, macOS 14.8.3, HeadlessChrome 143 through 156,
  // identical bytes on every build), upstream 6cb1a3c3e21010db956d41e7a6d57a02b0be1e7d.
  // The default fixture's capture matches the retained golden within one byte in 18
  // channels; see docs/CRT-PARITY.md.
  const { createHash } = await import('node:crypto')
  const cases = [
    ['noise(seed: 1, ridges: true).crt(seed: 1)', 0.25, '7fc77bf05a97bf7d891f0b6e341676c31fb3deb0f2dc850ebdb662aecfe032db'],
    ['noise(seed: 1, ridges: true).crt(seed: 2)', 0.25, '6677be3188d91baa90e644a0af41800b6d9d3a39aeebbb89f7b5badc1acdad64'],
    ['noise(seed: 1, ridges: true).crt(seed: 1)', 0.6, '8140c3f73a50c7d04ee83c65e494be22962e1a362347fb094bac328a5914b02e'],
    ['noise(seed: 1, ridges: true).crt(seed: 5, speed: 2.5)', 0.4, '6a70fb196c0b09d3220b97afcd23a85ba25d3094240a03b62c437361e4e2c2f7'],
    ['noise(seed: 2).crt(seed: 9, alpha: 1)', 0.25, 'ba012872440d1480d7a54b9cc6bfc116cd919897574e688c37ca702500970983'],
  ]
  for (const [program, time, sha256] of cases) {
    const source = `search filter, synth\n\n${program}\n  .write(o0)\n\nrender(o0)\n`
    const rgba = renderer().render(source, { width: 8, height: 8, time, seed: 1, oneShot: 'initial' }).toRgba8()
    assert.equal(createHash('sha256').update(rgba).digest('hex'), sha256, program)
  }
  const fixture = 'search filter, synth\n\nnoise(seed: 1, ridges: true)\n  .crt(seed: 1)\n  .write(o0)\n\nrender(o0)\n'
  const rgba = renderer().render(fixture, { width: 8, height: 8, time: 0.25, seed: 1, oneShot: 'initial' }).toRgba8()
  const metrics = compareRgba8(rgba, await readGoldenCrt(), 2)
  assert.equal(metrics.pass, true)
  assert.equal(metrics.maxError, 1)
  assert.equal(metrics.differingChannels, 18)
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
