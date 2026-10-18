// Float division as the Apple GPU authority evaluates it.
//
// ANGLE's Metal backend compiles WebGL2 shaders with fast math, so a GLSL
// `a / b` becomes `a * rcp(b)`: the float32 product of `a` and the hardware
// reciprocal of `b`. The M4 reciprocal is not correctly rounded. For 859,417
// of the 2^23 float32 mantissas it is one ulp above the correctly rounded
// value, and for 8,757 it is one ulp below; it depends only on the mantissa.
// 41 is one of the mantissas above, so `x / width` lands on or above a texel
// boundary on a 41-pixel-wide image where a correctly rounded quotient lands
// below it. The kernel generator routes only run-time divisors here
// (scripts/upstream/compile-glsl.js); the compiler folds constant divisors,
// and those divisions keep their float64 form.
//
// The deviating mantissas come from scripts/parity/capture-metal-reciprocal.mjs
// (measured on an Apple M4). A mantissa can deviate only when the exact
// reciprocal lies between the band limits of the float32 grid (in ulps), so
// the data stores one bit for each mantissa in that band and none for the
// rest. Subnormal inputs and results flush to zero, as on the GPU.
import { METAL_RECIPROCAL } from './metal-reciprocal-data.js'
import { inReciprocalBand } from './metal-reciprocal-grid.js'

const F32 = Math.fround
const MIN_NORMAL = 1.1754943508222875e-38
const MANTISSAS = 1 << 23
const scratch = new Float32Array(1)
const scratchBits = new Uint32Array(scratch.buffer)
let deviations = null

function decodeBase64(text) {
  const binary = globalThis.atob(text.replace(/\s+/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

// Expand the band bitstream into one bit per mantissa.
export function decodeReciprocalDeviations(data = METAL_RECIPROCAL) {
  const stream = decodeBase64(data.bits)
  const set = new Uint8Array(MANTISSAS >> 3)
  let bit = 0
  let count = 0
  for (let mantissa = 1; mantissa < MANTISSAS; mantissa += 1) {
    if (!inReciprocalBand(mantissa, data)) continue
    if ((stream[bit >> 3] >> (bit & 7)) & 1) {
      set[mantissa >> 3] |= 1 << (mantissa & 7)
      count += 1
    }
    bit += 1
  }
  if (bit !== data.bandBits || count !== data.positiveDeviations + data.negativeDeviations) {
    throw new Error(`Metal reciprocal data is corrupt: ${bit} band bits and ${count} deviations`)
  }
  return set
}

function deviates(mantissa) {
  deviations ??= decodeReciprocalDeviations()
  return (deviations[mantissa >> 3] >> (mantissa & 7)) & 1
}

// The hardware reciprocal of a float32 value.
export function metalReciprocal(value) {
  scratch[0] = value
  const word = scratchBits[0]
  const exponent = (word >>> 23) & 0xff
  if (exponent === 0) return word >>> 31 ? -Infinity : Infinity
  if (exponent === 0xff) return F32(1 / value)
  const magnitude = Math.abs(scratch[0])
  const exact = 1 / magnitude
  scratch[0] = exact
  const mantissa = word & 0x7fffff
  if (mantissa !== 0 && deviates(mantissa)) {
    // A deviation rounds the other way: up where the correctly rounded value
    // is below the exact reciprocal, down where it is above.
    if (scratch[0] < exact) scratchBits[0] += 1
    else scratchBits[0] -= 1
  }
  let result = scratch[0]
  if (result < MIN_NORMAL) result = 0
  return word >>> 31 ? -result : result
}

// Both operands are float32 values on the GPU, and subnormals flush to zero.
function flush(value) {
  const rounded = F32(value)
  return rounded !== 0 && Math.abs(rounded) < MIN_NORMAL ? (rounded < 0 ? -0 : 0) : rounded
}

// `a / b` for a run-time divisor. The product of two float32 values is exact
// in float64 and is left unrounded, so a following add rounds once, like the
// fused multiply-add the GPU emits for `a / b + c`. A subnormal quotient
// flushes to zero.
export function metalDivide(dividend, divisor) {
  const product = flush(dividend) * metalReciprocal(divisor)
  return product !== 0 && Math.abs(product) < MIN_NORMAL ? (product < 0 ? -0 : 0) : product
}
