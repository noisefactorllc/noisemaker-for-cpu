import test from 'node:test'
import assert from 'node:assert/strict'

import { Surface } from '../src/runtime/surface.js'
import { sampleBilinear, sampleNearest } from '../src/runtime/sampler.js'
import { BufferPool } from '../src/runtime/buffer-pool.js'
import { runPass } from '../src/runtime/pass-runner.js'

function corners() {
  const surface = new Surface(2, 2)
  surface.data.set([
    1, 0, 0, 1, 0, 1, 0, 1,
    0, 0, 1, 1, 1, 1, 1, 1,
  ])
  return surface
}

test('samplers use top-left coordinates and clamp to the edge', () => {
  const surface = corners()
  const out = new Float32Array(4)

  sampleNearest(surface, 0, 0, out)
  assert.deepEqual([...out], [1, 0, 0, 1])
  sampleNearest(surface, 1, 1, out)
  assert.deepEqual([...out], [1, 1, 1, 1])
  sampleBilinear(surface, 0.5, 0.5, out)
  assert.deepEqual([...out], [0.5, 0.5, 0.5, 1])
  sampleBilinear(surface, -10, -10, out)
  assert.deepEqual([...out], [1, 0, 0, 1])
})

test('BufferPool reuses same-sized surfaces but not different sizes', () => {
  const pool = new BufferPool()
  const first = pool.acquire(4, 4)
  pool.release(first)
  const reused = pool.acquire(4, 4)
  const different = pool.acquire(2, 4)

  assert.equal(reused, first)
  assert.notEqual(different, first)
  assert.deepEqual(pool.stats(), { allocated: 2, available: 0, inUse: 2 })
})

test('runPass stores top-down rows while exposing bottom-left shader coordinates', () => {
  const destination = new Surface(2, 3)
  const contexts = new Set()
  const seen = []
  const stats = runPass({
    destination,
    tileRows: 2,
    time: 0.25,
    seed: 9,
    onTile: (tile) => seen.push(tile),
    kernel(ctx, out) {
      contexts.add(ctx)
      out[0] = ctx.uv[0]
      out[1] = ctx.uv[1]
      out[2] = ctx.time
      out[3] = 1
    },
  })

  assert.equal(contexts.size, 1)
  assert.deepEqual(seen, [{ yStart: 0, yEnd: 2 }, { yStart: 2, yEnd: 3 }])
  assert.deepEqual([...destination.data.slice(0, 4)], [0.25, Math.fround(5 / 6), 0.25, 1])
  assert.deepEqual([...destination.data.slice(-4)], [0.75, Math.fround(1 / 6), 0.25, 1])
  assert.equal(stats.pixels, 6)
  assert.equal(stats.tiles, 2)
})
