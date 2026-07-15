import test from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync, inflateSync } from 'node:zlib'

import { decodePng, encodePng } from '../src/node/png.js'

function chunks(png) {
  const out = []
  let offset = 8
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.subarray(offset + 4, offset + 8).toString('ascii')
    const data = png.subarray(offset + 8, offset + 8 + length)
    const crc = png.readUInt32BE(offset + 8 + length)
    out.push({ type, data, crc })
    offset += 12 + length
  }
  return out
}

function crc32(data) {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const output = Buffer.alloc(data.length + 12)
  output.writeUInt32BE(data.length, 0)
  output.write(type, 4, 4, 'ascii')
  data.copy(output, 8)
  output.writeUInt32BE(crc32(output.subarray(4, 8 + data.length)), 8 + data.length)
  return output
}

test('encodePng writes deterministic RGBA PNG chunks and scanlines', () => {
  const input = { width: 2, height: 1, data: Uint8Array.of(255, 0, 0, 255, 0, 128, 255, 64) }
  const first = Buffer.from(encodePng(input))
  const second = Buffer.from(encodePng(input))

  assert.deepEqual(first, second)
  assert.deepEqual([...first.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  const parsed = chunks(first)
  assert.deepEqual(parsed.map((chunk) => chunk.type), ['IHDR', 'IDAT', 'IEND'])
  assert.equal(parsed[0].data.readUInt32BE(0), 2)
  assert.equal(parsed[0].data.readUInt32BE(4), 1)
  assert.deepEqual([...inflateSync(parsed[1].data)], [0, ...input.data])
})

test('encodePng validates dimensions and RGBA length', () => {
  assert.throws(() => encodePng({ width: 0, height: 1, data: new Uint8Array() }), /positive integer/)
  assert.throws(() => encodePng({ width: 1, height: 1, data: new Uint8Array(3) }), /length 4/)
})

test('decodePng round-trips encoded RGBA pixels', () => {
  const original = {
    width: 2,
    height: 2,
    data: new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 128,
      0, 0, 255, 64, 255, 255, 255, 0,
    ]),
  }
  const decoded = decodePng(encodePng(original))
  assert.equal(decoded.width, original.width)
  assert.equal(decoded.height, original.height)
  assert.deepEqual(decoded.data, original.data)
})

test('decodePng rejects corrupt CRCs and invalid chunk ordering', () => {
  const corrupted = Buffer.from(encodePng({ width: 1, height: 1, data: Uint8Array.of(1, 2, 3, 4) }))
  corrupted[29] ^= 1
  assert.throws(() => decodePng(corrupted), /CRC mismatch in IHDR/)

  const parsed = chunks(Buffer.from(encodePng({ width: 1, height: 1, data: Uint8Array.of(1, 2, 3, 4) })))
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const duplicateHeader = Buffer.concat([signature, pngChunk('IHDR', parsed[0].data), pngChunk('IHDR', parsed[0].data), pngChunk('IDAT', parsed[1].data), pngChunk('IEND')])
  assert.throws(() => decodePng(duplicateHeader), /IHDR must appear exactly once and first/)
})

test('decodePng rejects oversized dimensions and bounded-inflate bombs', () => {
  const base = Buffer.from(encodePng({ width: 1, height: 1, data: Uint8Array.of(1, 2, 3, 4) }))
  const parsed = chunks(base)
  const signature = base.subarray(0, 8)
  const hugeHeader = Buffer.from(parsed[0].data)
  hugeHeader.writeUInt32BE(16_777_217, 0)
  const huge = Buffer.concat([signature, pngChunk('IHDR', hugeHeader), pngChunk('IDAT', parsed[1].data), pngChunk('IEND')])
  assert.throws(() => decodePng(huge), /PNG exceeds the 16,777,216 pixel limit/)

  const bomb = Buffer.concat([
    signature,
    pngChunk('IHDR', parsed[0].data),
    pngChunk('IDAT', deflateSync(Buffer.alloc(1024 * 1024))),
    pngChunk('IEND'),
  ])
  assert.throws(() => decodePng(bomb), /decompressed data exceeds the expected scanline length/)
})

test('decodePng applies grayscale and true-color tRNS transparency', () => {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const makeHeader = (colorType) => {
    const header = Buffer.alloc(13)
    header.writeUInt32BE(1, 0)
    header.writeUInt32BE(1, 4)
    header[8] = 8
    header[9] = colorType
    return header
  }
  const grayscale = Buffer.concat([
    signature, pngChunk('IHDR', makeHeader(0)), pngChunk('tRNS', Buffer.from([0, 7])),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 7]))), pngChunk('IEND'),
  ])
  assert.deepEqual([...decodePng(grayscale).data], [7, 7, 7, 0])

  const trueColor = Buffer.concat([
    signature, pngChunk('IHDR', makeHeader(2)), pngChunk('tRNS', Buffer.from([0, 1, 0, 2, 0, 3])),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 1, 2, 3]))), pngChunk('IEND'),
  ])
  assert.deepEqual([...decodePng(trueColor).data], [1, 2, 3, 0])
})
