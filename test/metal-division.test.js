import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { decodeReciprocalDeviations, metalDivide, metalReciprocal } from '../src/csl/metal-division.js'
import { METAL_RECIPROCAL } from '../src/csl/metal-reciprocal-data.js'
import { reciprocalGridPosition } from '../src/csl/metal-reciprocal-grid.js'
import { sampleNearestTexelBottomLeft } from '../src/runtime/sampler.js'

const scratch = new Float32Array(1)
const scratchBits = new Uint32Array(scratch.buffer)
const fromBits = (bits) => {
  scratchBits[0] = bits >>> 0
  return scratch[0]
}
const toBits = (value) => {
  scratch[0] = value
  return scratchBits[0]
}
const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/authority/${name}`, import.meta.url), 'utf8'))

test('the reciprocal band data rebuilds the captured 2-bit table', () => {
  const deviations = decodeReciprocalDeviations()
  const table = new Uint8Array((1 << 23) >> 2)
  let positive = 0
  let negative = 0
  for (let mantissa = 1; mantissa < 1 << 23; mantissa += 1) {
    if (!((deviations[mantissa >> 3] >> (mantissa & 7)) & 1)) continue
    const up = reciprocalGridPosition(mantissa) < 0.5
    if (up) positive += 1
    else negative += 1
    table[mantissa >> 2] |= (up ? 1 : 2) << ((mantissa & 3) * 2)
  }
  assert.equal(positive, METAL_RECIPROCAL.positiveDeviations)
  assert.equal(negative, METAL_RECIPROCAL.negativeDeviations)
  assert.deepEqual([positive, negative], [859417, 8757])
  assert.equal(createHash('sha256').update(table).digest('hex'), METAL_RECIPROCAL.tableSha256)
})

test('the Metal reciprocal of 41 is one ulp above the correctly rounded value', () => {
  assert.equal(toBits(metalReciprocal(41)), toBits(1 / 41) + 1)
  assert.equal(toBits(metalReciprocal(-41)), toBits(-1 / 41) + 1)
  assert.equal(toBits(metalReciprocal(41 * 64)), toBits(1 / (41 * 64)) + 1)
  assert.equal(metalReciprocal(23), Math.fround(1 / 23))
  assert.equal(metalReciprocal(64), 1 / 64)
})

test('runtime-divisor division matches the M4 for measured operand pairs', async () => {
  const { runtime, special } = await fixture('metal-division-m4.json')
  assert.equal(runtime.length, 256)
  for (const [a, b, expected] of [...runtime, ...special]) {
    const actual = Math.fround(metalDivide(fromBits(a), fromBits(b)))
    assert.ok(Object.is(actual, fromBits(expected)) || (Number.isNaN(actual) && Number.isNaN(fromBits(expected))),
      `${fromBits(a)} / ${fromBits(b)}: expected ${fromBits(expected)}, received ${actual}`)
  }
  let correctlyRounded = 0
  for (const [a, b, expected] of runtime) if (Math.fround(fromBits(a) / fromBits(b)) === fromBits(expected)) correctlyRounded += 1
  assert.equal(correctlyRounded, 64, 'the fixture keeps 192 pairs that a correctly rounded division gets wrong')
})

test('nearest sampling selects the texel of the float32-scaled coordinate', async () => {
  const { boundaries, special41x3 } = await fixture('nearest-texel-m4.json')
  assert.ok(boundaries.length >= 40)
  for (const [width, uBits, column] of boundaries) {
    const data = new Float32Array(width * 4)
    for (let x = 0; x < width; x += 1) data[x * 4] = x
    const out = sampleNearestTexelBottomLeft({ width, height: 1, data }, fromBits(uBits), 0.5, new Float32Array(4))
    assert.equal(out[0], column, `u=${fromBits(uBits)} on width ${width}`)
  }
  const width = 41
  const height = 3
  const data = new Float32Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((height - 1 - y) * width + x) * 4
      data[offset] = x
      data[offset + 1] = y
    }
  }
  for (const [uBits, vBits, column, row] of special41x3) {
    const out = sampleNearestTexelBottomLeft({ width, height, data }, fromBits(uBits), fromBits(vBits), new Float32Array(4))
    assert.deepEqual([out[0], out[1]], [column, row], `(${fromBits(uBits)}, ${fromBits(vBits)})`)
  }
})
