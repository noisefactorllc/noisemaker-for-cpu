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

// docs/CSL.md ships with the package and states the same coverage split.
test('docs/CSL.md states the canonical program coverage counts', async () => {
  const { readFile } = await import('node:fs/promises')
  const text = await readFile(new URL('../docs/CSL.md', import.meta.url), 'utf8')
  const generated = programCoverage.filter((program) => program.status === 'generated').length
  const adapter = programCoverage.filter((program) => program.status === 'adapter').length
  const stated = text.match(/Of (\d+) canonical programs, (\d+) are generated and (\d+) use full CPU adapters/)
  assert.ok(stated, 'docs/CSL.md states no program coverage counts')
  assert.deepEqual(stated.slice(1).map(Number), [programCoverage.length, generated, adapter])
  const split = text.match(/the (\d+)\/(\d+) coverage split/)
  assert.ok(split, 'docs/CSL.md states no coverage split')
  assert.deepEqual(split.slice(1).map(Number), [generated, adapter])
})
