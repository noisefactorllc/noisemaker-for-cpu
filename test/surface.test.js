import test from 'node:test'
import assert from 'node:assert/strict'

import { Surface } from '../src/runtime/surface.js'
import { RenderResult } from '../src/runtime/render-result.js'

test('Surface stores linear float RGBA and clamps byte output', () => {
  const surface = new Surface(1, 1)
  surface.data.set([-0.2, 0.5, 1.5, Number.NaN])

  assert.deepEqual([...surface.toRgba8()], [0, 128, 255, 0])
})

test('Surface validates dimensions and input length', () => {
  assert.throws(() => new Surface(0, 1), /positive integer/)
  assert.throws(() => new Surface(1, 1, new Float32Array(3)), /length 4/)
})

test('Surface rejects unsafe and oversized allocations before constructing typed arrays', () => {
  assert.throws(() => new Surface(Number.MAX_SAFE_INTEGER + 1, 2), /safe integer/)
  assert.throws(() => new Surface(4097, 4096), /16,777,216 pixel limit/)
  assert.throws(() => Surface.fromRgba8(4097, 4096, new Uint8Array(4)), /16,777,216 pixel limit/)
})

test('Surface clone, clear, and RGBA byte conversion are independent', () => {
  const original = Surface.fromRgba8(1, 1, Uint8Array.of(255, 128, 0, 64))
  const copy = original.clone()
  copy.clear([0.25, 0.5, 0.75, 1])

  assert.deepEqual([...original.toRgba8()], [255, 128, 0, 64])
  assert.deepEqual([...copy.toRgba8()], [64, 128, 191, 255])
})

test('RenderResult exposes the surface and stable metadata', () => {
  const surface = new Surface(2, 3)
  const result = new RenderResult(surface, { elapsedMs: 12.5, seed: 7, time: 0.25 })

  assert.equal(result.width, 2)
  assert.equal(result.height, 3)
  assert.equal(result.elapsedMs, 12.5)
  assert.equal(result.seed, 7)
  assert.equal(result.time, 0.25)
  assert.equal(result.toRgba8().length, 24)
})
