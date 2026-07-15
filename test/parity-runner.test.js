import assert from 'node:assert/strict'
import test from 'node:test'

import { compareRgba8 } from '../scripts/parity/lib.js'

test('compareRgba8 reports byte-exact and tolerance parity metrics', () => {
  const result = compareRgba8(
    Uint8Array.of(0, 10, 20, 255, 40, 50, 60, 255),
    Uint8Array.of(0, 11, 18, 255, 44, 50, 60, 255),
    2,
  )
  assert.deepEqual(result, {
    exact: false,
    pass: false,
    maxError: 4,
    meanError: 0.875,
    differingChannels: 3,
    channelsOverTolerance: 1,
  })
})
