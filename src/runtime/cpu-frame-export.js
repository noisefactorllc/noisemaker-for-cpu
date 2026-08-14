const ALPHA_MODES = new Set(['straight', 'opaque', 'premultiplied'])

function validateDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') throw new TypeError('Frame export descriptor must be an object')
  if (!Number.isSafeInteger(descriptor.width) || descriptor.width <= 0) throw new RangeError('Frame export width must be a positive integer')
  if (!Number.isSafeInteger(descriptor.height) || descriptor.height <= 0) throw new RangeError('Frame export height must be a positive integer')
  if (descriptor.format !== 'rgba8unorm') throw new TypeError("CPU frame export format must be 'rgba8unorm'")
  if (descriptor.colorSpace !== 'srgb' && descriptor.colorSpace !== 'display-p3') {
    throw new TypeError("CPU frame export colorSpace must be 'srgb' or 'display-p3'")
  }
  if (!ALPHA_MODES.has(descriptor.alphaMode)) {
    throw new TypeError("CPU frame export alphaMode must be 'opaque', 'straight', or 'premultiplied'")
  }
  if (!Number.isFinite(descriptor.fps) || descriptor.fps <= 0) throw new RangeError('Frame export fps must be finite and positive')
  const byteLength = descriptor.width * descriptor.height * 4
  if (!Number.isSafeInteger(byteLength)) throw new RangeError('Frame export dimensions are too large')
  return byteLength
}

export class CpuFrameExportAdapter {
  createSlot(index, descriptor) {
    const byteLength = validateDescriptor(descriptor)
    const data = new Uint8Array(byteLength)
    return {
      index,
      width: descriptor.width,
      height: descriptor.height,
      alphaMode: descriptor.alphaMode,
      data,
      frame: { width: descriptor.width, height: descriptor.height, rowStride: descriptor.width * 4, data },
      ready: false,
      destroyed: false,
    }
  }

  begin(slot, result) {
    this._assertUsable(slot)
    if (slot.ready) throw new Error('CPU frame export slot is already pending')
    if (!result || typeof result.toRgba8 !== 'function' || !Number.isInteger(result.width) || !Number.isInteger(result.height)) {
      throw new TypeError('CPU frame export requires a RenderResult-compatible frame')
    }
    if (result.width !== slot.width || result.height !== slot.height) {
      throw new Error(`CPU frame export source extent ${result.width}x${result.height} does not match configured extent ${slot.width}x${slot.height}`)
    }
    slot.data.set(result.toRgba8())
    if (slot.alphaMode === 'opaque') {
      for (let index = 3; index < slot.data.length; index += 4) slot.data[index] = 255
    } else if (slot.alphaMode === 'premultiplied') {
      for (let index = 0; index < slot.data.length; index += 4) {
        const alpha = slot.data[index + 3] / 255
        slot.data[index] = Math.round(slot.data[index] * alpha)
        slot.data[index + 1] = Math.round(slot.data[index + 1] * alpha)
        slot.data[index + 2] = Math.round(slot.data[index + 2] * alpha)
      }
    }
    slot.ready = true
  }

  poll(slot) {
    this._assertUsable(slot)
    return slot.ready
  }

  read(slot) {
    this._assertUsable(slot)
    if (!slot.ready) throw new Error('CPU frame export slot is not ready')
    slot.ready = false
    return slot.frame
  }

  destroySlot(slot) {
    if (!slot || slot.destroyed) return
    slot.destroyed = true
    slot.ready = false
  }

  _assertUsable(slot) {
    if (!slot || slot.destroyed) throw new Error('CPU frame export slot is not usable')
  }
}
