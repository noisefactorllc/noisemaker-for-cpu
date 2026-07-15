import { deflateSync, inflateSync } from 'node:zlib'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const MAX_PNG_PIXELS = 16_777_216
const MAX_PNG_ENCODED_BYTES = 256 * 1024 * 1024
const MAX_PNG_DECODED_BYTES = 96 * 1024 * 1024
const CRC_TABLE = new Uint32Array(256)
for (let index = 0; index < 256; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  CRC_TABLE[index] = value >>> 0
}

function crc32(data) {
  let crc = 0xffffffff
  for (let index = 0; index < data.length; index += 1) crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, 'ascii')
  const output = Buffer.allocUnsafe(data.length + 12)
  output.writeUInt32BE(data.length, 0)
  typeBytes.copy(output, 4)
  data.copy(output, 8)
  output.writeUInt32BE(crc32(output.subarray(4, 8 + data.length)), 8 + data.length)
  return output
}

function validateImage(image) {
  if (!Number.isInteger(image?.width) || image.width <= 0) throw new RangeError('width must be a positive integer')
  if (!Number.isInteger(image?.height) || image.height <= 0) throw new RangeError('height must be a positive integer')
  if (image.height > Math.floor(MAX_PNG_PIXELS / image.width)) throw new RangeError('PNG exceeds the 16,777,216 pixel limit')
  const expected = image.width * image.height * 4
  if (!(image.data instanceof Uint8Array) && !(image.data instanceof Uint8ClampedArray)) {
    throw new TypeError('data must be RGBA bytes')
  }
  if (image.data.length !== expected) throw new TypeError(`data must have length ${expected}`)
}

export function encodePng(image) {
  validateImage(image)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(image.width, 0)
  ihdr.writeUInt32BE(image.height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const stride = image.width * 4
  const scanlines = Buffer.allocUnsafe((stride + 1) * image.height)
  for (let y = 0; y < image.height; y += 1) {
    const target = y * (stride + 1)
    scanlines[target] = 0
    scanlines.set(image.data.subarray(y * stride, (y + 1) * stride), target + 1)
  }

  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(scanlines, { level: 9 })), chunk('IEND')])
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upperLeftDistance = Math.abs(estimate - upperLeft)
  return leftDistance <= upDistance && leftDistance <= upperLeftDistance
    ? left
    : upDistance <= upperLeftDistance ? up : upperLeft
}

function decodeScanlines(compressed, width, height, bytesPerPixel) {
  const stride = width * bytesPerPixel
  const expected = (stride + 1) * height
  if (!Number.isSafeInteger(expected) || expected > MAX_PNG_DECODED_BYTES) throw new RangeError('PNG decoded scanlines exceed the 96 MiB limit')
  let filtered
  try {
    filtered = inflateSync(compressed, { maxOutputLength: expected })
  } catch (error) {
    throw new TypeError(`PNG decompressed data exceeds the expected scanline length or is invalid: ${error.message}`, { cause: error })
  }
  if (filtered.length !== expected) throw new TypeError('PNG scanline data has an invalid length')
  const decoded = Buffer.allocUnsafe(stride * height)
  for (let y = 0; y < height; y += 1) {
    const sourceRow = y * (stride + 1)
    const targetRow = y * stride
    const filter = filtered[sourceRow]
    if (filter > 4) throw new TypeError(`Unsupported PNG row filter ${filter}`)
    for (let x = 0; x < stride; x += 1) {
      const raw = filtered[sourceRow + x + 1]
      const left = x >= bytesPerPixel ? decoded[targetRow + x - bytesPerPixel] : 0
      const up = y > 0 ? decoded[targetRow + x - stride] : 0
      const upperLeft = y > 0 && x >= bytesPerPixel ? decoded[targetRow + x - stride - bytesPerPixel] : 0
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? (left + up) >>> 1
              : paeth(left, up, upperLeft)
      decoded[targetRow + x] = (raw + predictor) & 0xff
    }
  }
  return decoded
}

/** Decode a non-interlaced, 8-bit PNG into top-down RGBA bytes. */
export function decodePng(input) {
  const png = Buffer.isBuffer(input) ? input : Buffer.from(input)
  if (png.length > MAX_PNG_ENCODED_BYTES) throw new RangeError('PNG exceeds the 256 MiB encoded input limit')
  if (png.length < SIGNATURE.length || !png.subarray(0, SIGNATURE.length).equals(SIGNATURE)) {
    throw new TypeError('Input is not a PNG image')
  }
  let offset = SIGNATURE.length
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = -1
  let interlace = 0
  let palette = null
  let transparency = null
  let seenHeader = false
  let seenPalette = false
  let seenTransparency = false
  let seenIdat = false
  let idatClosed = false
  let seenEnd = false
  const idat = []
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > png.length) throw new TypeError('PNG contains a truncated chunk')
    const type = png.subarray(offset + 4, offset + 8).toString('ascii')
    const data = png.subarray(offset + 8, offset + 8 + length)
    const expectedCrc = png.readUInt32BE(offset + 8 + length)
    const actualCrc = crc32(png.subarray(offset + 4, offset + 8 + length))
    if (actualCrc !== expectedCrc) throw new TypeError(`PNG CRC mismatch in ${type}`)
    if (type === 'IHDR') {
      if (seenHeader || offset !== SIGNATURE.length) throw new TypeError('PNG IHDR must appear exactly once and first')
      if (length !== 13) throw new TypeError('PNG IHDR has an invalid length')
      seenHeader = true
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (width === 0 || height === 0) throw new TypeError('PNG dimensions must be positive')
      if (height > Math.floor(MAX_PNG_PIXELS / width)) throw new RangeError('PNG exceeds the 16,777,216 pixel limit')
      bitDepth = data[8]
      colorType = data[9]
      if (data[10] !== 0 || data[11] !== 0) throw new TypeError('Unsupported PNG compression or filter method')
      interlace = data[12]
    } else if (type === 'PLTE') {
      if (!seenHeader || seenPalette || seenIdat) throw new TypeError('PNG PLTE must appear at most once before IDAT')
      seenPalette = true
      palette = Buffer.from(data)
    } else if (type === 'tRNS') {
      if (!seenHeader || seenTransparency || seenIdat) throw new TypeError('PNG tRNS must appear at most once before IDAT')
      seenTransparency = true
      transparency = Buffer.from(data)
    } else if (type === 'IDAT') {
      if (!seenHeader || idatClosed) throw new TypeError('PNG IDAT chunks must be consecutive and follow IHDR')
      seenIdat = true
      idat.push(data)
    } else if (type === 'IEND') {
      if (!seenIdat || length !== 0) throw new TypeError('PNG IEND must be empty and follow IDAT')
      seenEnd = true
      offset = end
      break
    } else {
      if (seenIdat) idatClosed = true
      if (type[0] === type[0]?.toUpperCase()) throw new TypeError(`Unsupported critical PNG chunk ${type}`)
    }
    offset = end
  }
  if (!seenHeader || !seenIdat || !seenEnd) throw new TypeError('PNG is missing required IHDR, IDAT, or IEND chunks')
  if (offset !== png.length) throw new TypeError('PNG contains trailing data after IEND')
  if (bitDepth !== 8) throw new TypeError(`Unsupported PNG bit depth ${bitDepth}; expected 8`)
  if (interlace !== 0) throw new TypeError('Interlaced PNG images are not supported')
  const components = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
  if (!components) throw new TypeError(`Unsupported PNG color type ${colorType}`)
  if (colorType === 3 && (!palette || palette.length === 0 || palette.length % 3 !== 0)) {
    throw new TypeError('Indexed PNG is missing a valid palette')
  }
  if (transparency) {
    if (colorType === 0 && transparency.length !== 2) throw new TypeError('Grayscale PNG tRNS must contain one 16-bit sample')
    if (colorType === 2 && transparency.length !== 6) throw new TypeError('True-color PNG tRNS must contain three 16-bit samples')
    if (colorType === 3 && transparency.length > palette.length / 3) throw new TypeError('Indexed PNG tRNS exceeds its palette length')
    if (colorType === 4 || colorType === 6) throw new TypeError(`PNG color type ${colorType} cannot contain tRNS`)
  }
  const transparentGray = colorType === 0 && transparency ? transparency.readUInt16BE(0) : -1
  const transparentRed = colorType === 2 && transparency ? transparency.readUInt16BE(0) : -1
  const transparentGreen = colorType === 2 && transparency ? transparency.readUInt16BE(2) : -1
  const transparentBlue = colorType === 2 && transparency ? transparency.readUInt16BE(4) : -1
  const decoded = decodeScanlines(Buffer.concat(idat), width, height, components)
  const rgba = new Uint8Array(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixel * components
    const target = pixel * 4
    if (colorType === 0) {
      rgba[target] = decoded[source]
      rgba[target + 1] = decoded[source]
      rgba[target + 2] = decoded[source]
      rgba[target + 3] = decoded[source] === transparentGray ? 0 : 255
    } else if (colorType === 2) {
      rgba[target] = decoded[source]
      rgba[target + 1] = decoded[source + 1]
      rgba[target + 2] = decoded[source + 2]
      rgba[target + 3] = decoded[source] === transparentRed && decoded[source + 1] === transparentGreen && decoded[source + 2] === transparentBlue ? 0 : 255
    } else if (colorType === 3) {
      const index = decoded[source]
      if (index * 3 + 2 >= palette.length) throw new TypeError(`PNG palette index ${index} is out of range`)
      rgba[target] = palette[index * 3]
      rgba[target + 1] = palette[index * 3 + 1]
      rgba[target + 2] = palette[index * 3 + 2]
      rgba[target + 3] = transparency?.[index] ?? 255
    } else if (colorType === 4) {
      rgba[target] = decoded[source]
      rgba[target + 1] = decoded[source]
      rgba[target + 2] = decoded[source]
      rgba[target + 3] = decoded[source + 1]
    } else {
      rgba.set(decoded.subarray(source, source + 4), target)
    }
  }
  return { width, height, data: rgba }
}

export async function readPng(path) {
  const info = await stat(path)
  if (info.size > MAX_PNG_ENCODED_BYTES) throw new RangeError('PNG exceeds the 256 MiB encoded input limit')
  return decodePng(await readFile(path))
}

let temporaryCounter = 0

export async function writePng(path, surfaceOrImage) {
  const image = surfaceOrImage?.toRgba8
    ? { width: surfaceOrImage.width, height: surfaceOrImage.height, data: surfaceOrImage.toRgba8() }
    : surfaceOrImage
  const bytes = encodePng(image)
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp-${process.pid}-${temporaryCounter++}`
  try {
    await writeFile(temporaryPath, bytes)
    await rename(temporaryPath, path)
  } catch (error) {
    throw new Error(`Failed to write PNG ${path}: ${error.message}`, { cause: error })
  }
  return path
}
