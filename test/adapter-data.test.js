import assert from 'node:assert/strict'
import test from 'node:test'

import { historicPaletteData, paletteData } from '../src/effects/generated/canonical-adapter-data.js'

test('generated adapter tables preserve every canonical palette entry', () => {
  assert.equal(historicPaletteData.length, 21)
  assert.ok(historicPaletteData.every((entry) => entry.length === 15))
  assert.equal(paletteData.length, 55)
  assert.ok(paletteData.every((entry) => entry.length === 16))
})
