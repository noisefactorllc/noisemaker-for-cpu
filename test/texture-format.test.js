import assert from 'node:assert/strict'
import test from 'node:test'

import { Surface } from '../src/runtime/surface.js'
import { float16Truncate, quantizeTexture } from '../src/runtime/texture-format.js'

test('canonical half-float textures truncate pass outputs like reference WebGL attachments', () => {
  assert.equal(float16Truncate(0.1), 0.0999755859375)
  assert.equal(float16Truncate(-0.1), -0.0999755859375)

  const half = new Surface(1, 1, new Float32Array([0.1, 0.3333, 1.5, -0.25]))
  quantizeTexture(half, 'rgba16f')
  assert.deepEqual([...half.data], [0.0999755859375, 0.333251953125, 1.5, -0.25])

  const unorm = new Surface(1, 1, new Float32Array([0.1, 0.5, 2, -1]))
  quantizeTexture(unorm, 'rgba8unorm')
  assert.deepEqual([...unorm.toRgba8()], [26, 128, 255, 0])
})

test('rgba32f and rgba32float formats are an explicit quantization no-op', () => {
  // Captured post-construction (already float32-rounded) so the comparison below proves
  // quantizeTexture leaves the bits untouched without needing to predict rounding.
  const precise = new Surface(1, 1, new Float32Array([0.00001, 0.3333, 1.5, -0.25]))
  const before = [...precise.data]
  quantizeTexture(precise, 'rgba32f')
  assert.deepEqual([...precise.data], before)

  quantizeTexture(precise, 'rgba32float')
  assert.deepEqual([...precise.data], before)
})
