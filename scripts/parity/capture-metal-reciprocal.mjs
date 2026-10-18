#!/usr/bin/env node
// Measures the hardware float32 reciprocal of an Apple GPU through WebGL2 and
// writes src/csl/metal-reciprocal-data.js, which src/csl/metal-division.js
// uses for GLSL division. Run it on the authority host (Apple M4, ANGLE Metal):
//
//   node scripts/parity/capture-metal-reciprocal.mjs [--playwright <playwright-core entry>] [--out <file>]
//
// Each draw computes `1.0 / b` in a fragment shader for all 2^23 mantissas of
// one binade and sign, and reads the results back exactly through an RGBA32UI
// target. Four binades and signs must give the same deviations from the
// correctly rounded reciprocal, or the capture fails.
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { inReciprocalBand, reciprocalGridPosition } from '../../src/csl/metal-reciprocal-grid.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const option = (name) => {
  const index = args.indexOf(name)
  return index === -1 ? null : args[index + 1]
}
const playwrightEntry = option('--playwright') ?? process.env.PLAYWRIGHT_CORE ?? 'playwright-core'
const outputPath = resolve(option('--out') ?? resolve(projectRoot, 'src', 'csl', 'metal-reciprocal-data.js'))
const MANTISSAS = 1 << 23
const variants = [
  { name: 'positive 2^0', exponentBits: 127 << 23, sign: 0 },
  { name: 'positive 2^5', exponentBits: (127 + 5) << 23, sign: 0 },
  { name: 'positive 2^-3', exponentBits: (127 - 3) << 23, sign: 0 },
  { name: 'negative 2^0', exponentBits: 127 << 23, sign: 1 },
]

// Runs in the page. Returns the reciprocal deviation of every mantissa as
// 2-bit codes (0 exact, 1 one ulp above, 2 one ulp below, 3 other), base64.
async function captureVariant(variant) {
  const width = 2048
  const height = 1024
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2')
  if (!gl) throw new Error('WebGL2 is unavailable')
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown'
  const compile = (type, source) => {
    const shader = gl.createShader(type)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader))
    return shader
  }
  const program = gl.createProgram()
  gl.attachShader(program, compile(gl.VERTEX_SHADER, '#version 300 es\nin vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }'))
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float; precision highp int;
uniform uint baseBits;
out uvec4 result;
float divisor(uint lane) {
  uint mantissa = (uint(gl_FragCoord.y) * ${width}u + uint(gl_FragCoord.x)) * 4u + lane;
  return uintBitsToFloat(baseBits | mantissa);
}
void main() {
  result = uvec4(floatBitsToUint(1.0 / divisor(0u)), floatBitsToUint(1.0 / divisor(1u)),
                 floatBitsToUint(1.0 / divisor(2u)), floatBitsToUint(1.0 / divisor(3u)));
}`))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
  gl.useProgram(program)
  const baseBits = ((variant.sign ? 0x80000000 : 0) | variant.exponentBits) >>> 0
  gl.uniform1ui(gl.getUniformLocation(program, 'baseBits'), baseBits)
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const location = gl.getAttribLocation(program, 'p')
  gl.enableVertexAttribArray(location)
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0)
  const target = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, target)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, width, height, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, null)
  const framebuffer = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0)
  gl.viewport(0, 0, width, height)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  const words = new Uint32Array(width * height * 4)
  gl.readPixels(0, 0, width, height, gl.RGBA_INTEGER, gl.UNSIGNED_INT, words)
  const error = gl.getError()
  if (error !== gl.NO_ERROR) throw new Error(`WebGL error ${error}`)
  const value = new Float32Array(1)
  const bits = new Uint32Array(value.buffer)
  const codes = new Uint8Array(words.length / 4)
  for (let mantissa = 0; mantissa < words.length; mantissa += 1) {
    bits[0] = (baseBits | mantissa) >>> 0
    value[0] = 1 / value[0]
    const delta = (words[mantissa] | 0) - (bits[0] | 0)
    const code = delta === 0 ? 0 : delta === 1 ? 1 : delta === -1 ? 2 : 3
    codes[mantissa >> 2] |= code << ((mantissa & 3) * 2)
  }
  let binary = ''
  for (let index = 0; index < codes.length; index += 8192) binary += String.fromCharCode.apply(null, codes.subarray(index, index + 8192))
  return { renderer, codes: btoa(binary) }
}

const { chromium } = await import(playwrightEntry.startsWith('/') ? pathToFileURL(playwrightEntry).href : playwrightEntry)
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const browserVersion = browser.version()
const captures = []
try {
  for (const variant of variants) {
    const page = await browser.newPage()
    const capture = await page.evaluate(captureVariant, variant)
    await page.close()
    captures.push({ ...variant, ...capture, codes: Buffer.from(capture.codes, 'base64') })
    console.log(`${variant.name}: ${capture.renderer}`)
  }
} finally {
  await browser.close()
}

const renderer = captures[0].renderer
if (!/Apple/.test(renderer) || !/Metal/.test(renderer)) throw new Error(`Not an Apple Metal renderer: ${renderer}`)
for (const capture of captures) {
  if (capture.renderer !== renderer) throw new Error(`Renderer changed between draws: ${capture.renderer}`)
  if (!capture.codes.equals(captures[0].codes)) throw new Error(`${capture.name} deviates differently from ${captures[0].name}`)
}
const table = captures[0].codes
const code = (mantissa) => (table[mantissa >> 2] >> ((mantissa & 3) * 2)) & 3
let positive = 0
let negative = 0
let low = 1
let high = 0
for (let mantissa = 0; mantissa < MANTISSAS; mantissa += 1) {
  const value = code(mantissa)
  if (value === 0) continue
  if (value === 3 || mantissa === 0) throw new Error(`Mantissa ${mantissa} deviates by more than one ulp`)
  const position = reciprocalGridPosition(mantissa)
  if (value === 1) positive += 1
  else negative += 1
  low = Math.min(low, position)
  high = Math.max(high, position)
}
const band = { bandLow: Math.floor(low * 100) / 100, bandHigh: Math.ceil(high * 100) / 100 }
const stream = new Uint8Array(MANTISSAS >> 3)
let bandBits = 0
for (let mantissa = 1; mantissa < MANTISSAS; mantissa += 1) {
  if (!inReciprocalBand(mantissa, band)) {
    if (code(mantissa) !== 0) throw new Error(`Deviating mantissa ${mantissa} lies outside the band`)
    continue
  }
  if (code(mantissa) !== 0) stream[bandBits >> 3] |= 1 << (bandBits & 7)
  bandBits += 1
}
const bits = Buffer.from(stream.subarray(0, (bandBits + 7) >> 3)).toString('base64').replace(/.{1,120}/g, (line) => `${line}\n`)
const sha256 = createHash('sha256').update(table).digest('hex')
const capturedAt = new Date().toISOString().slice(0, 10)
const source = `// Generated by scripts/parity/capture-metal-reciprocal.mjs. Do not edit.
// Hardware float32 reciprocal deviations measured through WebGL2 on
// ${renderer}, ${browserVersion}, ${capturedAt}.
// One bit per mantissa whose exact reciprocal lies between bandLow and bandHigh
// ulps of the float32 grid; tableSha256 is the SHA-256 of the captured 2-bit
// table (four mantissas per byte, low bits first).
export const METAL_RECIPROCAL = Object.freeze({
  renderer: ${JSON.stringify(renderer)},
  browser: ${JSON.stringify(browserVersion)},
  capturedAt: ${JSON.stringify(capturedAt)},
  bandLow: ${band.bandLow},
  bandHigh: ${band.bandHigh},
  bandBits: ${bandBits},
  positiveDeviations: ${positive},
  negativeDeviations: ${negative},
  tableSha256: ${JSON.stringify(sha256)},
  bits: \`
${bits}\`,
})
`
await writeFile(outputPath, source)
console.log(`METAL-RECIPROCAL ${JSON.stringify({ renderer, positive, negative, low, high, ...band, bandBits, tableSha256: sha256, out: outputPath })}`)
