import test from 'node:test'
import assert from 'node:assert/strict'

import * as api from '../src/index.js'

class FakeAdapter {
  constructor() {
    this.slots = []
    this.destroyError = null
  }

  createSlot(index, descriptor) {
    const slot = { index, descriptor, pending: false, ready: false, value: null, destroys: 0 }
    this.slots.push(slot)
    return slot
  }

  begin(slot, value) {
    slot.pending = true
    slot.ready = false
    slot.value = value
  }

  poll(slot) {
    return slot.ready
  }

  read(slot) {
    slot.pending = false
    return slot.value
  }

  destroySlot(slot) {
    slot.destroys += 1
    if (this.destroyError === slot.index) throw new Error(`destroy ${slot.index} failed`)
  }
}

function result(bytes) {
  return new api.RenderResult(api.Surface.fromRgba8(1, 1, new Uint8Array(bytes)))
}

test('FrameExportQueue validates adapters and enforces a bounded slot count', () => {
  assert.throws(() => new api.FrameExportQueue({}), /adapter/)
  assert.throws(() => new api.FrameExportQueue(new FakeAdapter(), { slots: 1 }), /2 through 8/)
  assert.throws(() => new api.FrameExportQueue(new FakeAdapter(), { slots: 9 }), /2 through 8/)
  assert.doesNotThrow(() => new api.FrameExportQueue(new FakeAdapter(), { slots: 2 }))
})

test('FrameExportQueue drops overflow, preserves callback context, and reuses completed slots', () => {
  const adapter = new FakeAdapter()
  const queue = new api.FrameExportQueue(adapter, { slots: 2 })
  const completed = []
  const context = { sequence: 7 }
  queue.configure({ width: 1, height: 1 })

  assert.equal(queue.enqueue('one', 10, (frame, timestamp, value) => completed.push([frame, timestamp, value]), context), true)
  assert.equal(queue.enqueue('two', 20, () => {}), true)
  assert.equal(queue.enqueue('overflow', 30, () => {}), false)
  adapter.slots[0].ready = true
  queue.poll()

  assert.deepEqual(completed, [['one', 10, context]])
  assert.equal(queue.enqueue('replacement', 40, () => {}), true)
  assert.deepEqual(queue.stats, { accepted: 3, dropped: 1, completed: 1, failed: 0 })
})

test('FrameExportQueue isolates callback failures and remains reusable', () => {
  const errors = []
  const adapter = new FakeAdapter()
  const queue = new api.FrameExportQueue(adapter, { slots: 2, onError(error) { errors.push(error.message) } })
  queue.configure({ width: 1, height: 1 })
  queue.enqueue('one', 10, () => { throw new Error('callback failed') })
  adapter.slots[0].ready = true

  queue.poll()

  assert.deepEqual(errors, ['callback failed'])
  assert.equal(queue.available, true)
  assert.deepEqual(queue.stats, { accepted: 1, dropped: 0, completed: 0, failed: 1 })
})

test('FrameExportQueue closes every slot once and becomes terminal after a destroy error', () => {
  const adapter = new FakeAdapter()
  const queue = new api.FrameExportQueue(adapter, { slots: 2 })
  queue.configure({ width: 1, height: 1 })
  adapter.destroyError = 0

  assert.throws(() => queue.close(), /destroy 0 failed/)
  assert.deepEqual(adapter.slots.map((slot) => slot.destroys), [1, 1])
  assert.doesNotThrow(() => queue.close())
  assert.equal(queue.available, false)
  assert.equal(queue.enqueue('late', 0, () => {}), false)
})

test('CpuRenderer frame export copies top-down RGBA8 bytes into reusable frames', () => {
  const renderer = new api.CpuRenderer({ registry: api.createDefaultRegistry(), kernels: api.kernels, kernelFactories: api.kernelFactories })
  const queue = renderer.createFrameExportQueue({ slots: 2 })
  const frames = []
  queue.configure({ width: 1, height: 1, format: 'rgba8unorm', colorSpace: 'srgb', alphaMode: 'straight', fps: 60 })
  const first = result([255, 0, 128, 255])

  assert.equal(queue.enqueue(first, 42, (frame) => frames.push([...frame.data])), true)
  first.surface.clear([0, 1, 0, 1])
  queue.poll()

  assert.deepEqual(frames, [[255, 0, 128, 255]])
  assert.deepEqual(queue.stats, { accepted: 1, dropped: 0, completed: 1, failed: 0 })
  queue.close()
})

test('CpuRenderer frame export rejects a result whose extent differs from its descriptor', () => {
  const renderer = new api.CpuRenderer({ registry: api.createDefaultRegistry(), kernels: api.kernels, kernelFactories: api.kernelFactories })
  const errors = []
  const queue = renderer.createFrameExportQueue({ slots: 2, onError(error) { errors.push(error.message) } })
  queue.configure({ width: 2, height: 1, format: 'rgba8unorm', colorSpace: 'srgb', alphaMode: 'straight', fps: 60 })

  assert.equal(queue.enqueue(result([0, 0, 0, 255]), 0, () => {}), false)
  assert.match(errors[0], /extent 1x1 does not match configured extent 2x1/)
  assert.deepEqual(queue.stats, { accepted: 0, dropped: 0, completed: 0, failed: 1 })
})
