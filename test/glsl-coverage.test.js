import test from 'node:test'
import assert from 'node:assert/strict'

import { programCoverage } from '../src/effects/generated/glsl-coverage.js'

const ADAPTER_EFFECTS = [
  'classicNoisedeck/fractal',
  'filter/historicPalette',
  'filter/palette',
  'synth/julia',
]

test('every eligible canonical GLSL program is transpiled or assigned a parity adapter', () => {
  assert.equal(programCoverage.length, 212)
  assert.equal(programCoverage.filter((program) => program.status === 'generated').length, 208)
  assert.equal(programCoverage.filter((program) => program.status === 'adapter').length, 4)
  assert.deepEqual(
    [...new Set(programCoverage.filter((program) => program.status === 'adapter').map((program) => program.effectId))].sort(),
    ADAPTER_EFFECTS,
  )
  assert.deepEqual([...new Set(programCoverage.map((program) => program.effectId))].length, 167)
  assert.ok(programCoverage.every((program) => program.sourceBytes > 0 && program.normalizedBytes > 0))
})
