import test from 'node:test'
import assert from 'node:assert/strict'

import * as api from '../src/index.js'

function frame(bytes = [255, 128, 0, 255]) {
  const surface = api.Surface.fromRgba8(1, 1, new Uint8Array(bytes))
  return new api.RenderResult(surface, { time: 0.25 })
}

test('CanvasSink presents a real RenderResult into a Canvas 2D host', () => {
  const presented = {}
  const context = {
    createImageData(width, height) {
      return { width, height, data: new Uint8ClampedArray(width * height * 4) }
    },
    putImageData(image, x, y) {
      Object.assign(presented, { image, x, y })
    },
  }
  const canvas = { width: 0, height: 0, getContext: () => context }
  const sink = new api.CanvasSink(canvas)

  sink.configure({ width: 1, height: 1, format: 'rgba8unorm', colorSpace: 'srgb', alphaMode: 'straight', fps: 60 })
  assert.equal(sink.submit(frame(), 1234), true)
  sink.close()
  sink.close()

  assert.equal(canvas.width, 1)
  assert.equal(canvas.height, 1)
  assert.deepEqual([...presented.image.data], [255, 128, 0, 255])
  assert.deepEqual([presented.x, presented.y], [0, 0])
})

test('CanvasSink rejects malformed descriptors and frame extents', () => {
  const context = {
    createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4) } },
    putImageData() {},
  }
  const sink = new api.CanvasSink({ width: 0, height: 0, getContext: () => context })

  assert.throws(() => sink.configure({ width: 0, height: 1 }), /width/)
  sink.configure({ width: 1, height: 1 })
  assert.throws(() => sink.submit(new api.RenderResult(new api.Surface(2, 1))), /extent/)
})

test('SinkManager configures current and later sinks with one descriptor', () => {
  const descriptors = []
  const first = { configure(value) { descriptors.push(value) }, submit() { return true }, close() {} }
  const later = { configure(value) { descriptors.push(value) }, submit() { return true }, close() {} }
  const manager = new api.SinkManager()
  const descriptor = { width: 2, height: 3 }

  manager.add(first)
  manager.configure(descriptor)
  manager.add(later)

  assert.deepEqual(descriptors, [descriptor, descriptor])
})

test('SinkManager counts outcomes and isolates sink and reporter failures', () => {
  const reported = []
  let laterCalls = 0
  const accepted = { configure() {}, submit() { return true }, close() {} }
  const dropped = { configure() {}, submit() { return false }, close() {} }
  const failed = { configure() {}, submit() { throw new Error('sink failed') }, close() {} }
  const later = { configure() {}, submit() { laterCalls += 1; return true }, close() {} }
  const manager = new api.SinkManager({
    onError(error, sink) {
      reported.push([error.message, sink])
      throw new Error('reporter failed')
    },
  })

  manager.add(accepted)
  manager.add(dropped)
  manager.add(failed)
  manager.add(later)
  assert.doesNotThrow(() => manager.submit(frame(), 10))

  assert.deepEqual(manager.stats.get(accepted), { accepted: 1, dropped: 0, failed: 0 })
  assert.deepEqual(manager.stats.get(dropped), { accepted: 0, dropped: 1, failed: 0 })
  assert.deepEqual(manager.stats.get(failed), { accepted: 0, dropped: 0, failed: 1 })
  assert.equal(laterCalls, 1)
  assert.deepEqual(reported, [['sink failed', failed]])
})

test('SinkManager removes a sink during submission without skipping later sinks', () => {
  const manager = new api.SinkManager()
  let laterCalls = 0
  let closes = 0
  const selfRemoving = {
    configure() {},
    submit() { manager.remove(selfRemoving); return true },
    close() { closes += 1 },
  }
  const later = { configure() {}, submit() { laterCalls += 1; return true }, close() {} }

  manager.add(selfRemoving)
  manager.add(later)
  manager.submit(frame(), 20)

  assert.equal(closes, 1)
  assert.equal(laterCalls, 1)
  assert.equal(manager.stats.has(selfRemoving), false)
})

test('SinkManager close is terminal, closes every sink once, and reports the first close error', () => {
  const closes = []
  const manager = new api.SinkManager()
  manager.add({ configure() {}, submit() { return true }, close() { closes.push('first'); throw new Error('first close failed') } })
  manager.add({ configure() {}, submit() { return true }, close() { closes.push('second') } })

  assert.throws(() => manager.close(), /first close failed/)
  assert.doesNotThrow(() => manager.close())
  assert.deepEqual(closes, ['first', 'second'])
  assert.throws(() => manager.add({ configure() {}, submit() {}, close() {} }), /closed/)
})
