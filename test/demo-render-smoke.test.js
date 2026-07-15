import test from 'node:test'
import assert from 'node:assert/strict'

import { createDefaultRegistry, CpuRenderer, kernels, kernelFactories } from '../src/index.js'
import { buildDsl } from '../examples/browser/pipeline.js'

test('a representative demo pipeline renders finite, non-blank RGBA bytes', () => {
  const registry = createDefaultRegistry()
  const renderer = new CpuRenderer({ registry, kernels, kernelFactories })
  const state = {
    generator: { id: 'synth/noise', values: { scaleX: 18, scaleY: 12, ridges: true, type: 'sine' } },
    filters: [{ id: 'filter/posterize', values: { levels: 8 }, skipped: false }],
  }
  const dsl = buildDsl(state, registry)
  const result = renderer.render(dsl, { width: 32, height: 32, seed: 11, time: 0 })
  const bytes = result.toRgba8()
  assert.equal(bytes.length, 32 * 32 * 4)
  assert.equal(bytes.every((b) => Number.isFinite(b)), true)
  assert.equal(
    bytes.some((b) => b !== 0),
    true,
  ) // not a blank frame
})

test('a solid generator renders the requested color', () => {
  const registry = createDefaultRegistry()
  const renderer = new CpuRenderer({ registry, kernels, kernelFactories })
  const state = {
    generator: { id: 'synth/solid', values: { color: [1, 0, 0] } },
    filters: [],
  }
  const dsl = buildDsl(state, registry)
  const result = renderer.render(dsl, { width: 8, height: 8, seed: 1, time: 0 })
  const bytes = result.toRgba8()
  // top-left pixel should be red-ish
  assert.ok(bytes[0] > 200, `expected red channel high, got ${bytes[0]}`)
  assert.ok(bytes[1] < 60, `expected green channel low, got ${bytes[1]}`)
  assert.ok(bytes[2] < 60, `expected blue channel low, got ${bytes[2]}`)
})
