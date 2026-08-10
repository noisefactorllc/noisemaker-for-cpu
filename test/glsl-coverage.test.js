import test from 'node:test'
import assert from 'node:assert/strict'

import { programCoverage } from '../src/effects/generated/glsl-coverage.js'

// Program-key (`${effectId}:${program}`), not effect-id: dla/lenia/physarum/pointsRender/
// pointsBillboardRender each have OTHER programs that are transpiled normally — only their
// vertex-stage scatter program (the `.frag` half of a `.vert`+`.frag` gl.POINTS draw) is an
// adapter. The original 4 remain whole-effect adapters (their one canonical program each).
const ADAPTER_PROGRAMS = [
  'classicNoisedeck/fractal:fractal',
  'filter/historicPalette:historicPalette',
  'filter/palette:palette',
  'points/dla:depositGrid',
  'points/lenia:deposit',
  'points/physarum:deposit',
  'render/pointsBillboardRender:deposit',
  'render/pointsRender:deposit',
  'synth/julia:julia',
]

test('every eligible canonical GLSL program is transpiled or assigned a parity adapter', () => {
  assert.equal(programCoverage.length, 274)
  assert.equal(programCoverage.filter((program) => program.status === 'generated').length, 265)
  assert.equal(programCoverage.filter((program) => program.status === 'adapter').length, 9)
  assert.deepEqual(
    [...new Set(programCoverage.filter((program) => program.status === 'adapter').map((program) => `${program.effectId}:${program.program}`))].sort(),
    ADAPTER_PROGRAMS,
  )
  assert.deepEqual([...new Set(programCoverage.map((program) => program.effectId))].length, 188)
  assert.ok(programCoverage.every((program) => program.sourceBytes > 0 && program.normalizedBytes > 0))
})
