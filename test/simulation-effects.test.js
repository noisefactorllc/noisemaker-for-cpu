import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createDefaultRegistry, kernels, kernelFactories } from '../src/effects/catalog.js'
import { CpuRenderer } from '../src/runtime/renderer.js'
import { tokenizeDsl } from '../src/dsl/tokenize.js'

// The 21 stateful/particle effects added on top of the 167-effect baseline (see
// docs/EFFECTS.md's "CPU iteration divergence" section). Each has a checked-in default program
// at parity/upstream-defaults/<namespace>__<func>.dsl (seed-pinned, shared with the parity
// runner) — that fixture IS "the default program" this file renders.
const ITERATED = [
  'filter/convolutionFeedback',
  'filter/feedback',
  'filter/motionBlur',
  'filter/temporalAberration',
  'points/attractor',
  'points/buddhabrot',
  'points/dla',
  'points/flock',
  'points/flow',
  'points/hydraulic',
  'points/lenia',
  'points/life',
  'points/physarum',
  'points/physical',
  'render/pointsBillboardRender',
  'render/pointsEmit',
  'render/pointsRender',
  'synth/cellularAutomata',
  'synth/mnca',
  'synth/navierStokes',
  'synth/reactionDiffusion',
]

// Effects whose N=4 vs N=8 default-program output is empirically byte-identical at this file's
// test scale (16x16 or 8x8, stateSize 64, seed/time pinned by the fixture) — re-verified directly
// against the live catalog, not assumed. Two DIFFERENT, non-interchangeable reasons
// produce N=4-vs-N=8 byte-equality, and conflating them (as an earlier draft of this comment did)
// is itself a bug: only one of the two is genuine settling.
//
// `SETTLES_BY_N8`: the output is byte-identical from N=4 all the way through N=60 (re-verified) -
// these five have genuinely reached a stable configuration:
const SETTLES_BY_N8 = new Set([
  'filter/feedback', // a delay-line/blend loop that stabilizes within a handful of frames.
  'points/physical', // shares a fixture with the two render/points* entries below.
  'render/pointsBillboardRender',
  'render/pointsEmit',
  'render/pointsRender', // `pointsEmit().physical().pointsRender()` - one fixture, three ids.
])
//
// `PLATEAUS_BY_N8`: the output is NOT stable - N=4..8 is a deterministic plateau at THIS exact
// test scale, but iterating further resumes changing the output (re-verified: points/physarum
// first differs at N=11, points/flow and points/life at N=10, points/lenia at N=22). This is a
// small-scale artifact, not evidence of settling: re-run at a larger scale (32x32 canvas,
// stateSize:128), points/physarum shows NO plateau at all - every consecutive N from 1 to 60
// differs. Do not describe these as "settled" or "converged" in code or docs.
const PLATEAUS_BY_N8 = new Set([
  'points/flow',
  'points/lenia',
  'points/life',
  'points/physarum',
])
const CONVERGES_BY_N8 = new Set([...SETTLES_BY_N8, ...PLATEAUS_BY_N8])

// `synth/cellularAutomata`, `synth/mnca`, and `synth/reactionDiffusion` size their internal
// simulation grid as `ceil(canvasSize / zoom)`. At this file's 16x16 canvas their own default
// `zoom` (32, 8, and 8 respectively) collapses that grid to 1x1 or 2x2 - `cellularAutomata`'s
// default is provably degenerate (re-verified: at zoom:32/16x16, every live cell dies after
// exactly one tick under its rule and the grid stays all-zero through iterationCount:60, at every
// seed tried - the N=4-vs-N=8 equality this produced was never simulation logic, it was
// mathematical extinction), and `reactionDiffusion`'s default 2x2 grid was ALSO the cause of a
// false N=4-vs-N=8 plateau (re-verified: it evolves normally at a larger 32x32 canvas). `zoom: 2`
// (an 8x8 grid at 16x16) restores a real, non-degenerate grid for all three - re-verified directly
// to evolve (N=4 differs from N=8) once applied. `mnca` was already correctly classified as
// evolving even at its own marginal 2x2 default grid, but gets the same override for consistency
// and a more representative test (240/256 nonzero pixels at zoom:2, vs. a barely-functional 2x2
// grid otherwise).
const ZOOM_OVERRIDE = new Map([
  ['synth/cellularAutomata', 2],
  ['synth/mnca', 2],
  ['synth/reactionDiffusion', 2],
])

// points/lenia (convolution search radius over its agent grid) and synth/navierStokes (a 30-step
// internal pressure-solve per rendered pixel, independent of iterationCount) are the most
// expensive of the 21 per rendered pixel, so they get the smallest canvas here to keep this file fast.
function sizeFor(id) {
  return id === 'points/lenia' || id === 'synth/navierStokes' ? 8 : 16
}

// Mirrors scripts/parity/pin-default-seeds.js's own token-scan-and-insert technique: locate the
// first `funcName(...)` call and insert `argName: value` as its first argument. A no-op (returns
// `source` unchanged) if the call already carries that argument explicitly, so a fixture's own
// authored value (e.g. points/buddhabrot's `pointsEmit(stateSize: 512)`) is never silently
// shadowed by a duplicate, contradictory argument.
function withNamedArg(source, funcName, argName, value) {
  const tokens = tokenizeDsl(source)
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const call = tokens[index]
    if (call.type !== 'identifier' || call.lexeme !== funcName || tokens[index + 1]?.lexeme !== '(') continue
    const open = tokens[index + 1]
    let depth = 0
    let closeIndex = -1
    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      if (tokens[cursor].lexeme === '(') depth += 1
      else if (tokens[cursor].lexeme === ')' && --depth === 0) {
        closeIndex = cursor
        break
      }
    }
    if (closeIndex < 0) throw new Error(`${funcName}: unterminated call in fixture`)
    let argDepth = 0
    for (let cursor = index + 2; cursor < closeIndex; cursor += 1) {
      const token = tokens[cursor]
      if (['(', '['].includes(token.lexeme)) argDepth += 1
      else if ([')', ']'].includes(token.lexeme)) argDepth -= 1
      else if (argDepth === 0 && token.type === 'identifier' && token.lexeme === argName && tokens[cursor + 1]?.lexeme === ':') {
        return source
      }
    }
    const hasArgs = closeIndex > index + 2
    const insertText = hasArgs ? `${argName}: ${value}, ` : `${argName}: ${value}`
    return source.slice(0, open.index + 1) + insertText + source.slice(open.index + 1)
  }
  throw new Error(`Call "${funcName}(" not found in fixture source`)
}

// `render/pointsEmit` is the only definition that opens an iteration group (see
// src/runtime/iteration.js), so it is always the group owner whenever a fixture chains through
// it; only the owner's own `iterationCount` controls how many times the group runs
// (src/runtime/renderer.js's `runIteratedGroupSync`/`Async`: `N = group.steps[0].params.
// iterationCount`). Every non-particle fixture (filter/*, synth/*) forms its own single-step
// group, so its own call is the owner.
function ownerFuncFor(id, source) {
  return source.includes('pointsEmit(') ? 'pointsEmit' : id.split('/')[1]
}

function fixtureSource(id) {
  const name = id.replace('/', '__')
  return readFileSync(resolve('parity/upstream-defaults', `${name}.dsl`), 'utf8')
}

// Renders an iterated effect's checked-in default program with `iterationCount` overridden on
// the group owner (and `stateSize` floored to the DSL-enforced minimum of 64 for any
// `pointsEmit`-owned chain, keeping the whole file fast). Returns a COPY of the rendered bytes:
// `CpuRenderer` pools its surfaces, so a later `render()` call on the same renderer can recycle
// the exact buffer a previous result pointed at — every other determinism check in this codebase
// spreads/copies out for the same reason (see e.g. test/iterated-effects.test.js).
function renderDefault(renderer, id, { iterationCount } = {}) {
  let source = fixtureSource(id)
  const ownerFunc = ownerFuncFor(id, source)
  if (iterationCount !== undefined) source = withNamedArg(source, ownerFunc, 'iterationCount', iterationCount)
  if (ownerFunc === 'pointsEmit') source = withNamedArg(source, 'pointsEmit', 'stateSize', 64)
  if (ZOOM_OVERRIDE.has(id)) source = withNamedArg(source, ownerFunc, 'zoom', ZOOM_OVERRIDE.get(id))
  const size = sizeFor(id)
  const result = renderer.render(source, { width: size, height: size, time: 0.25, seed: 1, oneShot: 'initial' })
  return Float32Array.from(result.surface.data)
}

function allFinite(data) {
  return data.every(Number.isFinite)
}

function nonZeroPixels(surface) {
  const { data, width, height } = surface
  let count = 0
  for (let index = 0; index < width * height; index += 1) {
    const base = index * 4
    if (data[base] !== 0 || data[base + 1] !== 0 || data[base + 2] !== 0) count += 1
  }
  return count
}

test('every iterated effect default program renders finite bytes and evolves with iterationCount', () => {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories, tileRows: 4 })
  for (const id of ITERATED) {
    const zero = renderDefault(renderer, id, { iterationCount: 0 })
    const four = renderDefault(renderer, id, { iterationCount: 4 })
    const eight = renderDefault(renderer, id, { iterationCount: 8 })

    assert.ok(allFinite(zero), `${id} iterationCount:0 produced non-finite pixels`)
    assert.ok(allFinite(four), `${id} iterationCount:4 produced non-finite pixels`)
    assert.ok(allFinite(eight), `${id} iterationCount:8 produced non-finite pixels`)

    // N=0 is the documented bypass (a clone of the group's input, zero passes run — see
    // docs/EFFECTS.md); N=4 actually runs the simulation. These must differ for every one of the
    // 21, with no exceptions - verified true across all of them.
    assert.notDeepEqual(zero, four, `${id} iterationCount:0 must differ from iterationCount:4 (the N=0 bypass must be observable)`)

    if (CONVERGES_BY_N8.has(id)) {
      // Documented exception, not a silent skip - see SETTLES_BY_N8/PLATEAUS_BY_N8 above for the
      // measured, per-effect reason. Never say "converged" for a PLATEAUS_BY_N8 member: it hasn't.
      const reason = SETTLES_BY_N8.has(id)
        ? `${id} has genuinely settled (byte-identical from iterationCount:4 through :60, re-verified)`
        : `${id} is on a deterministic plateau at this test scale (byte-identical N=4..8, but resumes changing at a larger iterationCount or canvas - this is NOT settling)`
      assert.deepEqual(four, eight, reason)
    } else {
      assert.notDeepEqual(four, eight, `${id} state must still be advancing between iterationCount:4 and iterationCount:8`)
    }

    assert.deepEqual(renderDefault(renderer, id, { iterationCount: 4 }), four, `${id} must be deterministic at a fixed iterationCount`)
  }
})

test('particle chain accumulates trails across iterations', () => {
  // perlin().pointsEmit(stateSize: 64).dla().pointsRender() at 16x16 (stateSize floored to the
  // DSL-enforced minimum of 64, not an illustrative 16 - see withNamedArg's doc comment
  // above): DLA (diffusion-limited aggregation) only ever accretes, so its stuck
  // population is monotonically non-decreasing in iteration count.
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories, tileRows: 4 })
  const program = (n) => `search synth, points, render\nperlin().pointsEmit(stateSize: 64, iterationCount: ${n}).dla().pointsRender().write(o0)\nrender(o0)`
  const one = renderer.render(program(1), { width: 16, height: 16, time: 0.25, seed: 1, oneShot: 'initial' })
  const eight = renderer.render(program(8), { width: 16, height: 16, time: 0.25, seed: 1, oneShot: 'initial' })

  assert.notDeepEqual([...eight.surface.data], [...one.surface.data], 'iterationCount 8 must differ from 1')
  assert.ok(nonZeroPixels(eight.surface) >= nonZeroPixels(one.surface), 'trail coverage must not shrink as iterationCount grows')
})

test('two particle pipelines in one chain do not share state', () => {
  // Two independent pointsEmit()...pointsRender() segments in ONE chain (no read/write boundary
  // between them): computeIterationGroups (src/runtime/iteration.js) closes the first particle
  // group and opens a second, independent one the moment it sees the second pointsEmit() declare
  // global_xyz again, even though the first group is still "open" (references the same particle-
  // state names). Changing ONLY the second segment's seed must change the output, proving the
  // second group's own groupResources are fresh rather than leaking/inheriting the first group's.
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories, tileRows: 4 })
  const program = (secondSeed) => `search synth, points, render
perlin(seed: 1).pointsEmit(seed: 1, stateSize: 64, iterationCount: 4).dla().pointsRender().pointsEmit(seed: ${secondSeed}, stateSize: 64, iterationCount: 4).dla().pointsRender().write(o0)
render(o0)`

  const a = renderer.render(program(2), { width: 16, height: 16, time: 0.25, seed: 1, oneShot: 'initial' })
  const b = renderer.render(program(9), { width: 16, height: 16, time: 0.25, seed: 1, oneShot: 'initial' })
  assert.notDeepEqual([...b.surface.data], [...a.surface.data], 'changing only the second pointsEmit seed must change the final output')

  const aAgain = renderer.render(program(2), { width: 16, height: 16, time: 0.25, seed: 1, oneShot: 'initial' })
  assert.deepEqual([...aAgain.surface.data], [...a.surface.data], 'two independent groups in one chain must still render deterministically')
})

test('a points sim effect with no upstream pointsEmit passes its input through unchanged', () => {
  // No pointsEmit ahead of a points/* effect means computeIterationGroups (src/runtime/
  // iteration.js) finds no group owner to seed global_xyz from - the sim falls back to a fresh,
  // zeroed particle-state texture (its own stateSize default, or 256 if it declares none - see
  // docs/EFFECTS.md's "points" section and PARTICLE_STATE_FALLBACK_SIZE in
  // src/runtime/renderer.js). A zeroed global_xyz means every agent's pos.w is 0, which upstream's
  // own agent shaders treat as dead: a dead agent neither moves nor deposits, so the whole pass
  // graph is a no-op and the step's output is simply its input, byte-for-byte - an actual
  // passthrough, not an approximation of inertness. Checked for two independent points effects
  // (one with no own stateSize param, one with) so the assertion isn't an accident of one
  // family's math.
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories, tileRows: 4 })
  const size = 8
  const renderOptions = { width: size, height: size, time: 0.25, seed: 1, oneShot: 'initial' }
  const base = renderer.render('search synth\nsolid(color: #58c).write(o0)\nrender(o0)', renderOptions)
  const baseBytes = Float32Array.from(base.surface.data)

  for (const func of ['flock', 'life']) {
    const program = `search points, synth\nsolid(color: #58c).${func}(iterationCount: 4).write(o0)\nrender(o0)`
    const result = renderer.render(program, renderOptions)
    assert.deepEqual(Float32Array.from(result.surface.data), baseBytes, `points/${func} with no upstream pointsEmit must pass its input through unchanged`)
  }
})
