const EMPTY_DESCRIPTOR = Object.freeze({})

function normalizeDescriptor(descriptor) {
  return descriptor === undefined ? EMPTY_DESCRIPTOR : descriptor
}

function validateSink(sink) {
  if (!sink || typeof sink.configure !== 'function' || typeof sink.submit !== 'function' || typeof sink.close !== 'function') {
    throw new TypeError('Sink must implement configure, submit, and close')
  }
}

function validateCanvasDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') throw new TypeError('Canvas sink descriptor must be an object')
  if (!Number.isSafeInteger(descriptor.width) || descriptor.width <= 0) throw new RangeError('Canvas sink width must be a positive integer')
  if (!Number.isSafeInteger(descriptor.height) || descriptor.height <= 0) throw new RangeError('Canvas sink height must be a positive integer')
}

export class CanvasSink {
  constructor(canvas) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('canvas must provide getContext()')
    this.canvas = canvas
    this.descriptor = EMPTY_DESCRIPTOR
    this.closed = false
    this.configured = false
  }

  configure(descriptor) {
    if (this.closed) return
    validateCanvasDescriptor(descriptor)
    this.descriptor = descriptor
    this.canvas.width = descriptor.width
    this.canvas.height = descriptor.height
    this.configured = true
  }

  submit(result) {
    if (this.closed) return false
    if (!this.configured) throw new Error('CanvasSink must be configured before submission')
    if (!result || typeof result.toRgba8 !== 'function' || !Number.isInteger(result.width) || !Number.isInteger(result.height)) {
      throw new TypeError('CanvasSink requires a RenderResult-compatible frame')
    }
    if (result.width !== this.descriptor.width || result.height !== this.descriptor.height) {
      throw new Error(`CanvasSink frame extent ${result.width}x${result.height} does not match configured extent ${this.descriptor.width}x${this.descriptor.height}`)
    }
    const context = this.canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D context is unavailable')
    const image = context.createImageData(result.width, result.height)
    image.data.set(result.toRgba8())
    context.putImageData(image, 0, 0)
    return true
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.canvas = null
  }
}

export class SinkManager {
  constructor({ onError } = {}) {
    this._onError = onError
    this._registrations = []
    this._registrationsBySink = new Map()
    this._stats = new Map()
    this._descriptor = EMPTY_DESCRIPTOR
    this._configured = false
    this._closed = false
    this._iterationDepth = 0
    this._hasTombstones = false
  }

  get stats() {
    return this._stats
  }

  add(sink) {
    if (this._closed) throw new Error('SinkManager is closed')
    validateSink(sink)
    if (this._registrationsBySink.has(sink)) throw new Error('Sink is already registered')
    if (this._configured) sink.configure(this._descriptor)

    const registration = { sink, stats: { accepted: 0, dropped: 0, failed: 0 }, active: true }
    this._registrations.push(registration)
    this._registrationsBySink.set(sink, registration)
    this._stats.set(sink, registration.stats)

    let removed = false
    return () => {
      if (removed) return
      removed = true
      this._removeRegistration(registration)
    }
  }

  remove(sink) {
    this._removeRegistration(this._registrationsBySink.get(sink))
  }

  _removeRegistration(registration) {
    if (!registration || !registration.active) return
    const sink = registration.sink
    registration.active = false
    this._hasTombstones = true
    if (this._registrationsBySink.get(sink) === registration) {
      this._registrationsBySink.delete(sink)
      this._stats.delete(sink)
    }
    registration.sink = null
    try {
      sink.close()
    } finally {
      if (this._iterationDepth === 0) this._compactRegistrations()
    }
  }

  _compactRegistrations() {
    if (!this._hasTombstones) return
    let writeIndex = 0
    for (let readIndex = 0; readIndex < this._registrations.length; readIndex += 1) {
      const registration = this._registrations[readIndex]
      if (registration.active) {
        this._registrations[writeIndex] = registration
        writeIndex += 1
      }
    }
    this._registrations.length = writeIndex
    this._hasTombstones = false
  }

  configure(descriptor) {
    if (this._closed) return
    this._descriptor = normalizeDescriptor(descriptor)
    this._configured = true
    this._iterationDepth += 1
    try {
      for (const registration of this._registrations) {
        if (!registration.active) continue
        const sink = registration.sink
        try {
          sink.configure(this._descriptor)
        } catch (error) {
          registration.stats.failed += 1
          this._report(error, sink)
        }
      }
    } finally {
      this._iterationDepth -= 1
      if (this._iterationDepth === 0) this._compactRegistrations()
    }
  }

  submit(frame, timestamp) {
    if (this._closed) return
    this._iterationDepth += 1
    try {
      for (const registration of this._registrations) {
        if (!registration.active) continue
        const sink = registration.sink
        let result
        try {
          result = sink.submit(frame, timestamp)
        } catch (error) {
          registration.stats.failed += 1
          this._report(error, sink)
          continue
        }
        if (result === true) registration.stats.accepted += 1
        else if (result === false) registration.stats.dropped += 1
      }
    } finally {
      this._iterationDepth -= 1
      if (this._iterationDepth === 0) this._compactRegistrations()
    }
  }

  close(options) {
    if (this._closed) return
    this._closed = true
    let firstError
    for (const registration of this._registrations) {
      if (!registration.active) continue
      const sink = registration.sink
      registration.active = false
      registration.sink = null
      try {
        sink.close(options)
      } catch (error) {
        if (!firstError) firstError = error
      }
    }
    this._registrations.length = 0
    this._registrationsBySink.clear()
    this._stats.clear()
    this._hasTombstones = false
    if (firstError) throw firstError
  }

  _report(error, sink) {
    if (typeof this._onError !== 'function') return
    try {
      this._onError(error, sink)
    } catch {
      // Sink error reporters are isolated from rendering.
    }
  }
}
