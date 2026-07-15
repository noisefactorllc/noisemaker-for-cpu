import { Surface } from './surface.js'

function key(width, height) {
  return `${width}x${height}`
}

export class BufferPool {
  constructor() {
    this.available = new Map()
    this.inUse = new Set()
    this.allocated = 0
  }

  acquire(width, height) {
    const bucketKey = key(width, height)
    const bucket = this.available.get(bucketKey)
    const surface = bucket?.pop() ?? new Surface(width, height)
    if (bucket && bucket.length === 0) this.available.delete(bucketKey)
    this.inUse.add(surface)
    if (!bucket || surface.width !== width || surface.height !== height) this.allocated += 1
    return surface
  }

  release(surface) {
    if (!this.inUse.delete(surface)) throw new Error('Cannot release a surface that is not in use')
    const bucketKey = key(surface.width, surface.height)
    const bucket = this.available.get(bucketKey) ?? []
    bucket.push(surface)
    this.available.set(bucketKey, bucket)
  }

  reset() {
    for (const surface of [...this.inUse]) this.release(surface)
  }

  stats() {
    let available = 0
    for (const bucket of this.available.values()) available += bucket.length
    return { allocated: this.allocated, available, inUse: this.inUse.size }
  }
}
