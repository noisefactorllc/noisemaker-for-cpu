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
  'filter3d/flow3d:deposit',
  'points/dla:depositGrid',
  'points/lenia:deposit',
  'points/physarum:deposit',
  'render/pointsBillboardRender:deposit',
  'render/pointsRender:deposit',
  'synth/julia:julia',
]

test('every eligible canonical GLSL program is transpiled or assigned a parity adapter', () => {
  assert.equal(programCoverage.length, 308)
  assert.equal(programCoverage.filter((program) => program.status === 'generated').length, 298)
  assert.equal(programCoverage.filter((program) => program.status === 'adapter').length, 10)
  assert.deepEqual(
    [...new Set(programCoverage.filter((program) => program.status === 'adapter').map((program) => `${program.effectId}:${program.program}`))].sort(),
    ADAPTER_PROGRAMS,
  )
  // The reactive and mesh trees are imported with the catalog: the reactive
  // fragment programs and the meshLoader preview / meshRender clear programs transpile
  // normally; meshRender's triangle-draw `render` program is driven by the hand-written
  // CPU rasterizer in src/effects/cpu/mesh-render.js (its transpiled fragment body is
  // retained but not executed per-pixel).
  assert.deepEqual([...new Set(programCoverage.map((program) => program.effectId))].length, 210)
  assert.ok(programCoverage.every((program) => program.sourceBytes > 0 && program.normalizedBytes > 0))
})
