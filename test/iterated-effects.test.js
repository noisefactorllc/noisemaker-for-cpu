import assert from 'node:assert/strict'
import test from 'node:test'

import { computeIterationGroups } from '../src/runtime/iteration.js'
import { registerScatterAdapter } from '../src/effects/cpu/scatter-registry.js'
import { EffectDefinition } from '../src/effects/definition.js'
import { EffectRegistry } from '../src/effects/registry.js'
import { CpuRenderer } from '../src/runtime/renderer.js'

// ---------------------------------------------------------------------------------------------
// Step 1a: computeIterationGroups — pure grouping unit tests (no renderer involved)
// ---------------------------------------------------------------------------------------------

function step(id, textures = {}, passes = [], iterated = false, params = {}) {
  return { definition: { id, textures, passes, iterated }, params }
}

test('computeIterationGroups groups particle segments and isolates stateful effects', () => {
  const emit = step('render/pointsEmit', { global_xyz: {}, global_vel: {}, global_rgba: {} },
    [{ inputs: { xyzTex: 'global_xyz' }, outputs: { outXYZ: 'global_xyz', fragColor: 'outputTex' } }], true, { iterationCount: 5 })
  const flock = step('points/flock', {}, [{ inputs: { xyzTex: 'global_xyz' }, outputs: { outXYZ: 'global_xyz' } }], true)
  const blur = step('filter/blur', {}, [{ inputs: { inputTex: 'inputTex' }, outputs: { fragColor: 'outputTex' } }])
  const rd = step('synth/reactionDiffusion', { global_rd_state: {} },
    [{ inputs: { bufTex: 'global_rd_state' }, outputs: { fragColor: 'global_rd_state' } }], true)
  const groups = computeIterationGroups([emit, flock, blur, rd])
  assert.deepEqual(groups.map((g) => [g.iterated, g.steps.length]), [[true, 2], [false, 1], [true, 1]])
})

test('computeIterationGroups opens a new independent group for each global_xyz-declaring step, even while one is already open', () => {
  const emitA = step('render/pointsEmit', { global_xyz: {} },
    [{ inputs: { xyzTex: 'global_xyz' }, outputs: { outXYZ: 'global_xyz' } }], true, { iterationCount: 5 })
  const emitB = step('render/pointsEmit', { global_xyz: {} },
    [{ inputs: { xyzTex: 'global_xyz' }, outputs: { outXYZ: 'global_xyz' } }], true, { iterationCount: 9 })
  const flock = step('points/flock', {}, [{ inputs: { xyzTex: 'global_xyz' }, outputs: { outXYZ: 'global_xyz' } }], true)
  const groups = computeIterationGroups([emitA, emitB, flock])
  assert.deepEqual(groups.map((g) => [g.iterated, g.steps.length]), [[true, 1], [true, 2]])
  assert.equal(groups[0].steps[0], emitA)
  assert.equal(groups[1].steps[0], emitB)
  assert.equal(groups[1].steps[1], flock)
})

test('computeIterationGroups treats read/write chain steps as boundaries that close an open group', () => {
  const emit = step('render/pointsEmit', { global_xyz: {} },
    [{ inputs: { xyzTex: 'global_xyz' }, outputs: { outXYZ: 'global_xyz' } }], true, { iterationCount: 5 })
  const flock = step('points/flock', {}, [{ inputs: { xyzTex: 'global_xyz' }, outputs: { outXYZ: 'global_xyz' } }], true)
  const write = { kind: 'write', surface: 'o1' }
  const read = { kind: 'read', surface: 'o1' }
  const groups = computeIterationGroups([emit, write, read, flock])
  assert.deepEqual(groups.map((g) => [g.iterated, g.steps.length]), [[true, 1], [false, 1], [false, 1], [true, 1]])
  assert.equal(groups[1].steps[0], write)
  assert.equal(groups[2].steps[0], read)
  assert.equal(groups[3].steps[0], flock) // its group was closed by the write boundary; it forms its own
})

test('computeIterationGroups leaves a chain with no particle/stateful steps as one non-iterated group per step', () => {
  const blur = step('filter/blur', {}, [{ inputs: { inputTex: 'inputTex' }, outputs: { fragColor: 'outputTex' } }])
  const invert = step('filter/invert', {}, [{ inputs: { inputTex: 'inputTex' }, outputs: { fragColor: 'outputTex' } }])
  const groups = computeIterationGroups([blur, invert])
  assert.deepEqual(groups.map((g) => [g.iterated, g.steps.length]), [[false, 1], [false, 1]])
})

test('computeIterationGroups makes a balanced loop region one iteration-owned group', () => {
  // Break caught: leaving loopBegin/loopEnd as independent groups runs the enclosed blur once
  // instead of once per accumulator iteration.
  const solid = step('synth/solid')
  const begin = step('render/loopBegin', {}, [], true, { iterationCount: 3 })
  begin.definition.loopRole = 'begin'
  const blur = step('filter/blur')
  const end = step('render/loopEnd')
  end.definition.loopRole = 'end'
  const invert = step('filter/invert')

  const groups = computeIterationGroups([solid, begin, blur, end, invert])
  assert.deepEqual(groups.map((group) => [group.iterated, group.loop === true, group.steps.length]), [
    [false, false, 1],
    [true, true, 3],
    [false, false, 1],
  ])
  assert.equal(groups[1].steps[0], begin)
  assert.equal(groups[1].steps[2], end)
})

// ---------------------------------------------------------------------------------------------
// Step 1b: renderer-level fixtures (hand-built registry, same style as canonical-render-graph.test.js)
// ---------------------------------------------------------------------------------------------

function fillFactory($bindings, runtime) {
  return function fillKernel(context, out) {
    runtime.beginPixel(context)
    out[0] = $bindings.value
    out[1] = 0
    out[2] = 0
    out[3] = 1
  }
}

// Accumulates via selfTex (previous-iteration own output): proves both the iteration count AND
// (as a side effect) the per-iteration frame/time/deltaTime schedule, since the g/b/a channels
// only reflect the LAST iteration's bindings once accumulation across N iterations is trusted.
function scheduleFactory($bindings, runtime) {
  const sample = runtime.stdlib.texture
  return function scheduleKernel(context, out) {
    runtime.beginPixel(context)
    const previous = sample($bindings.selfTexInput, context.uv)
    out[0] = previous[0] + 1 / 16
    out[1] = $bindings.frame
    out[2] = $bindings.time
    out[3] = $bindings.deltaTime
  }
}

function selfTexProbeFactory($bindings, runtime) {
  const sample = runtime.stdlib.texture
  return function selfTexProbeKernel(context, out) {
    runtime.beginPixel(context)
    const previous = sample($bindings.selfTexInput, context.uv)
    out[0] = previous[0] + 0.25
    out[1] = 0
    out[2] = 0
    out[3] = 1
  }
}

// F5 regression fixture: writes to a fixed, small `scratchTex` instead of `outputTex`. Paired
// with an `EffectDefinition` below that leaves `outputTex` undeclared (so `selfTexSurface` falls
// back to render/screen size) while `scratchTex` is a fixed literal size — the two sizes
// genuinely diverge, unlike every real catalog effect (see `assertSelfTexMatchesOutput`'s own doc
// comment in src/runtime/renderer.js for why that's unreachable there). Proves the assertion
// actually fires instead of only ever seeing matched sizes.
function selfTexMismatchFactory() {
  return function selfTexMismatchKernel(context, out) {
    out[0] = 1
    out[1] = 0
    out[2] = 0
    out[3] = 1
  }
}

function addConstFactory($bindings, runtime) {
  const sample = runtime.stdlib.texture
  return function addConstKernel(context, out) {
    runtime.beginPixel(context)
    const color = sample($bindings.inputTex, context.uv)
    out[0] = color[0] + 0.1
    out[1] = color[1]
    out[2] = color[2]
    out[3] = color[3]
  }
}

// Step A of the interleaving fixture: "moves" state by reading-and-writing its own `global_xyz`
// (the group-opening particle name) each iteration.
function moveStateFactory($bindings, runtime) {
  const sample = runtime.stdlib.texture
  return function moveStateKernel(context, out) {
    runtime.beginPixel(context)
    const state = sample($bindings.xyzTex, context.uv)
    out[0] = state[0] + 1
    out[1] = 0
    out[2] = 0
    out[3] = 1
  }
}

function constOutputFactory() {
  return function constOutputKernel(context, out) {
    out[0] = 0
    out[1] = 0
    out[2] = 0
    out[3] = 1
  }
}

// Step B of the interleaving fixture: "deposits" the CURRENT (this-iteration, already-moved)
// state value into a `_trail`-suffixed group-shared accumulator.
function depositStateFactory($bindings, runtime) {
  const sample = runtime.stdlib.texture
  return function depositStateKernel(context, out) {
    runtime.beginPixel(context)
    const state = sample($bindings.xyzTex, context.uv)
    const trail = sample($bindings.trailTex, context.uv)
    out[0] = trail[0] + state[0]
    out[1] = 0
    out[2] = 0
    out[3] = 1
  }
}

function copyFactory($bindings, runtime, sourceKey) {
  const sample = runtime.stdlib.texture
  return function copyKernel(context, out) {
    runtime.beginPixel(context)
    runtime.writeColor(sample($bindings[sourceKey], context.uv), out)
  }
}

function copyFromTrailFactory($bindings, runtime) {
  return copyFactory($bindings, runtime, 'trailTex')
}

function copyFromXyzFactory($bindings, runtime) {
  return copyFactory($bindings, runtime, 'xyzTex')
}

// MRT pass writing two DIFFERENT group-shared particle names (`global_xyz`/`global_vel`) at once,
// each accumulating independently — proves MRT destinations route through `groupResources` and
// persist across iterations, mirroring points/life's real (4-output) shape at smaller scale.
function mrtParticleFactory($bindings, runtime) {
  const sample = runtime.stdlib.texture
  return function mrtParticleKernel(context, out) {
    runtime.beginPixel(context)
    const previousXyz = sample($bindings.xyzTex, context.uv)
    const previousVel = sample($bindings.velTex, context.uv)
    out[0] = previousXyz[0] + 1
    out[1] = 0
    out[2] = 0
    out[3] = 1
    out[4] = previousVel[0] + 10
    out[5] = 0
    out[6] = 0
    out[7] = 1
  }
}
mrtParticleFactory.outputNames = ['outXYZ', 'outVel']

function combineXyzVelFactory($bindings, runtime) {
  const sample = runtime.stdlib.texture
  return function combineXyzVelKernel(context, out) {
    runtime.beginPixel(context)
    const xyz = sample($bindings.xyzTex, context.uv)
    const vel = sample($bindings.velTex, context.uv)
    out[0] = xyz[0]
    out[1] = vel[0]
    out[2] = 0
    out[3] = 1
  }
}

// Marks its OWN destination resolution into r/g, proving the size a group-scoped particle
// texture resolved to (used by the "standalone points effect, no declaring step" fixture).
function markResolutionFactory($bindings, runtime) {
  return function markResolutionKernel(context, out) {
    runtime.beginPixel(context)
    out[0] = $bindings.resolution[0]
    out[1] = $bindings.resolution[1]
    out[2] = 0
    out[3] = 1
  }
}

// MRT pass mirroring points/life's real shape (an agent pass that writes xyz alongside a
// per-step-declared name, life_data, in one MRT call): out[0] passes xyz through, out[4]/out[5]
// mark the SHARED MRT resolution and the bound `stateSize` uniform respectively — proving both
// size and shader-visible uniform observe the group owner's stateSize, not the joining step's own.
function agentMrtFactory($bindings, runtime) {
  const sample = runtime.stdlib.texture
  return function agentMrtKernel(context, out) {
    runtime.beginPixel(context)
    const xyz = sample($bindings.xyzTex, context.uv)
    out[0] = xyz[0]
    out[1] = 0
    out[2] = 0
    out[3] = 1
    out[4] = $bindings.resolution[0]
    out[5] = $bindings.stateSize
    out[6] = 0
    out[7] = 1
  }
}
agentMrtFactory.outputNames = ['outXYZ', 'outData']

function copyFromLifeDataFactory($bindings, runtime) {
  return copyFactory($bindings, runtime, 'lifeTex')
}

function loopBeginFactory($bindings, runtime) {
  const sample = runtime.stdlib.texture
  return function loopBeginKernel(context, out) {
    runtime.beginPixel(context)
    const input = sample($bindings.inputTex, context.uv)
    const accum = sample($bindings.accumTex, context.uv)
    out[0] = input[0] + accum[0]
    out[1] = 0
    out[2] = 0
    out[3] = 1
  }
}

function loopCopyFactory($bindings, runtime) {
  return copyFactory($bindings, runtime, 'inputTex')
}

// Registers into scatter-registry.js's shared, process-global `adapters` Map at import time, under
// a synthetic key ('filter/customScatter:deposit') no shipped effect uses. Safe only because
// `node --test` runs each test file in its own process, so this registration never leaks into
// another file's `resolveScatterAdapter` lookups — it would need to move into a per-test
// setup/teardown (register/unregister, or a fresh registry instance) if the runner ever started
// sharing a process across test files.
registerScatterAdapter('filter/customScatter:deposit', (context) => {
  context.destination.data[0] = 0.5
  context.destination.data[1] = 0
  context.destination.data[2] = 0
  context.destination.data[3] = 1
  return { pixels: 1 }
})

function fixture() {
  const definitions = [
    new EffectDefinition({
      namespace: 'synth', func: 'fill', kind: 'generator',
      params: { value: { type: 'float', default: 0, uniform: 'value' } },
      passes: [{ name: 'render', program: 'fill', inputs: {}, outputs: { fragColor: 'outputTex' } }],
    }),
    // Single-step iterated group: proves the per-iteration schedule (frame/time/deltaTime) and
    // that N iterations actually ran, via selfTex-driven accumulation.
    new EffectDefinition({
      namespace: 'synth', func: 'iterSchedule', kind: 'generator', iterated: true,
      params: { iterationCount: { type: 'int', default: 60, min: 0, max: 10000 } },
      textures: { outputTex: { width: 'screen', height: 'screen', format: 'rgba32f' } },
      passes: [{ name: 'accumulate', program: 'schedule', inputs: { selfTexInput: 'selfTex' }, outputs: { fragColor: 'outputTex' } }],
    }),
    // selfTex fixture: N=1 vs N=3 comparison.
    new EffectDefinition({
      namespace: 'filter', func: 'selfTexProbe', kind: 'filter', iterated: true,
      params: { iterationCount: { type: 'int', default: 60, min: 0, max: 10000 } },
      textures: { outputTex: { width: 'input', height: 'input', format: 'rgba32f' } },
      passes: [{ name: 'accumulate', program: 'selfTexProbe', inputs: { selfTexInput: 'selfTex' }, outputs: { fragColor: 'outputTex' } }],
    }),
    // F5 regression: `outputTex` is deliberately left undeclared (so `selfTexSurface` falls back
    // to render/screen size) while the only pass writes a fixed, differently-sized `scratchTex`
    // instead of `outputTex` — a genuine size divergence, constructed without touching the
    // renderer itself.
    new EffectDefinition({
      namespace: 'filter', func: 'selfTexSizeMismatch', kind: 'filter', iterated: true,
      params: { iterationCount: { type: 'int', default: 1, min: 0, max: 10000 } },
      textures: { scratchTex: { width: 5, height: 5, format: 'rgba32f' } },
      passes: [{ name: 'mismatch', program: 'mismatchWrite', inputs: { selfTexInput: 'selfTex' }, outputs: { fragColor: 'scratchTex' } }],
    }),
    // iterationCount: 0 fixture — never actually runs `add`; output must equal input exactly.
    new EffectDefinition({
      namespace: 'filter', func: 'iterZero', kind: 'filter', iterated: true,
      params: { iterationCount: { type: 'int', default: 60, min: 0, max: 10000 } },
      passes: [{ name: 'bump', program: 'addConst', inputs: { inputTex: 'inputTex' }, outputs: { fragColor: 'outputTex' } }],
    }),
    new EffectDefinition({
      namespace: 'render', func: 'loopBegin', kind: 'filter', domain: 'loop-begin', loopRole: 'begin', iterated: true,
      params: { iterationCount: { type: 'int', default: 60, min: 0, max: 10000 } },
      passes: [{ name: 'begin', program: 'loopBegin', inputs: { inputTex: 'inputTex', accumTex: 'global_accum' }, outputs: { fragColor: 'outputTex' } }],
    }),
    new EffectDefinition({
      namespace: 'filter', func: 'loopAdd', kind: 'filter',
      params: {},
      passes: [{ name: 'add', program: 'addConst', inputs: { inputTex: 'inputTex' }, outputs: { fragColor: 'outputTex' } }],
    }),
    new EffectDefinition({
      namespace: 'render', func: 'loopEnd', kind: 'filter', domain: 'loop-end', loopRole: 'end',
      params: {},
      passes: [
        { name: 'feedback', program: 'copy', inputs: { inputTex: 'inputTex' }, outputs: { fragColor: 'global_accum' } },
        { name: 'output', program: 'copy', inputs: { inputTex: 'inputTex' }, outputs: { fragColor: 'outputTex' } },
      ],
    }),
    // Two-step particle group: proves per-iteration interleaving (respawn/move/deposit style).
    new EffectDefinition({
      // Namespace deliberately not `render`: `render` is a reserved DSL keyword (see
      // src/dsl/tokenize.js's KEYWORDS set) and cannot appear in a `search` clause — a
      // pre-existing DSL-parser limitation, out of this task's scope, flagged in the report.
      namespace: 'points', func: 'testEmit', kind: 'generator', iterated: true,
      params: { iterationCount: { type: 'int', default: 60, min: 0, max: 10000 } },
      textures: { global_xyz: { width: 'screen', height: 'screen', format: 'rgba32f' } },
      passes: [
        { name: 'move', program: 'moveState', inputs: { xyzTex: 'global_xyz' }, outputs: { fragColor: 'global_xyz' } },
        { name: 'pass', program: 'constOutput', inputs: {}, outputs: { fragColor: 'outputTex' } },
      ],
    }),
    new EffectDefinition({
      namespace: 'points', func: 'testDeposit', kind: 'filter', iterated: true,
      params: { iterationCount: { type: 'int', default: 60, min: 0, max: 10000 } },
      textures: { global_test_trail: { width: 'screen', height: 'screen', format: 'rgba32f' } },
      passes: [
        { name: 'deposit', program: 'depositState', inputs: { xyzTex: 'global_xyz', trailTex: 'global_test_trail' }, outputs: { fragColor: 'global_test_trail' } },
        { name: 'pass', program: 'copyFromTrail', inputs: { trailTex: 'global_test_trail' }, outputs: { fragColor: 'outputTex' } },
      ],
    }),
    // Standalone (ungrouped) points-like effect: global_xyz is referenced but declared nowhere
    // in its own group, so it must fall back to its own stateSize param, never screen size.
    new EffectDefinition({
      namespace: 'points', func: 'testStandalone', kind: 'filter', iterated: true,
      params: {
        stateSize: { type: 'int', default: 8, uniform: 'stateSize' },
        iterationCount: { type: 'int', default: 1, min: 0, max: 10000 },
      },
      passes: [
        { name: 'mark', program: 'markResolution', inputs: { xyzTex: 'global_xyz' }, outputs: { fragColor: 'global_xyz' } },
        { name: 'pass', program: 'copyFromXyz', inputs: { xyzTex: 'global_xyz' }, outputs: { fragColor: 'outputTex' } },
      ],
    }),
    // MRT pass inside a particle group, writing two group-shared particle names at once.
    new EffectDefinition({
      namespace: 'points', func: 'testEmitMrt', kind: 'generator', iterated: true,
      params: { iterationCount: { type: 'int', default: 60, min: 0, max: 10000 } },
      textures: {
        global_xyz: { width: 'screen', height: 'screen', format: 'rgba32f' },
        global_vel: { width: 'screen', height: 'screen', format: 'rgba32f' },
      },
      passes: [
        { name: 'emit', program: 'mrtParticle', inputs: { xyzTex: 'global_xyz', velTex: 'global_vel' }, outputs: { outXYZ: 'global_xyz', outVel: 'global_vel' }, drawBuffers: 2 },
        { name: 'pass', program: 'combineXyzVel', inputs: { xyzTex: 'global_xyz', velTex: 'global_vel' }, outputs: { fragColor: 'outputTex' } },
      ],
    }),
    // stateSize inheritance: owner declares its own stateSize (default 8, sizing global_xyz);
    // the joining step declares its OWN stateSize at a DIFFERENT default (4) plus a
    // particle-pattern texture (global_life_data) sized from it, written by an MRT pass
    // alongside global_xyz (mirrors points/life's real agent-pass shape). Upstream hides a
    // joining step's own stateSize as a non-control default, so the group owner's normalized
    // value must win unconditionally for BOTH the texture size and the step's own uniform.
    new EffectDefinition({
      namespace: 'points', func: 'testEmitState', kind: 'generator', iterated: true,
      params: {
        stateSize: { type: 'int', default: 8, uniform: 'stateSize' },
        iterationCount: { type: 'int', default: 60, min: 0, max: 10000 },
      },
      textures: { global_xyz: { width: { param: 'stateSize', default: 8 }, height: { param: 'stateSize', default: 8 }, format: 'rgba32f' } },
      passes: [
        { name: 'emit', program: 'constOutput', inputs: {}, outputs: { fragColor: 'global_xyz' } },
        { name: 'pass', program: 'constOutput', inputs: {}, outputs: { fragColor: 'outputTex' } },
      ],
    }),
    new EffectDefinition({
      namespace: 'points', func: 'testJoinState', kind: 'filter', iterated: true,
      params: {
        stateSize: { type: 'int', default: 4, uniform: 'stateSize' },
        iterationCount: { type: 'int', default: 60, min: 0, max: 10000 },
      },
      textures: { global_life_data: { width: { param: 'stateSize', default: 4 }, height: { param: 'stateSize', default: 4 }, format: 'rgba16f' } },
      passes: [
        {
          name: 'agent', program: 'agentMrt',
          inputs: { xyzTex: 'global_xyz', dataTex: 'global_life_data' },
          outputs: { outXYZ: 'global_xyz', outData: 'global_life_data' },
          drawBuffers: 2,
        },
        { name: 'pass', program: 'copyFromLifeData', inputs: { lifeTex: 'global_life_data' }, outputs: { fragColor: 'outputTex' } },
      ],
    }),
    // Scatter dispatch: a non-iterated effect with a registered custom adapter.
    new EffectDefinition({
      namespace: 'filter', func: 'customScatter', kind: 'filter',
      params: {},
      passes: [{ name: 'deposit', program: 'deposit', inputs: { inputTex: 'inputTex' }, outputs: { fragColor: 'outputTex' }, drawMode: 'points', count: 'input' }],
    }),
    // Scatter dispatch: a non-iterated effect with NO registered adapter — must throw.
    new EffectDefinition({
      namespace: 'filter', func: 'missingScatter', kind: 'filter',
      params: {},
      passes: [{ name: 'deposit', program: 'deposit', inputs: { inputTex: 'inputTex' }, outputs: { fragColor: 'outputTex' }, drawMode: 'points', count: 'input' }],
    }),
    // Scatter dispatch: an ITERATED effect with NO registered adapter — must also throw, from
    // inside the group-execution pass loop.
    new EffectDefinition({
      namespace: 'points', func: 'missingScatterIter', kind: 'filter', iterated: true,
      params: { iterationCount: { type: 'int', default: 2, min: 0, max: 10000 } },
      passes: [{ name: 'deposit', program: 'deposit', inputs: { inputTex: 'inputTex' }, outputs: { fragColor: 'outputTex' }, drawMode: 'points', count: 'input' }],
    }),
  ]
  return new CpuRenderer({
    registry: new EffectRegistry(definitions),
    kernelFactories: new Map([
      ['synth/fill:fill', fillFactory],
      ['synth/iterSchedule:schedule', scheduleFactory],
      ['filter/selfTexProbe:selfTexProbe', selfTexProbeFactory],
      ['filter/selfTexSizeMismatch:mismatchWrite', selfTexMismatchFactory],
      ['filter/iterZero:addConst', addConstFactory],
      ['render/loopBegin:loopBegin', loopBeginFactory],
      ['filter/loopAdd:addConst', addConstFactory],
      ['render/loopEnd:copy', loopCopyFactory],
      ['points/testEmit:moveState', moveStateFactory],
      ['points/testEmit:constOutput', constOutputFactory],
      ['points/testDeposit:depositState', depositStateFactory],
      ['points/testDeposit:copyFromTrail', copyFromTrailFactory],
      ['points/testStandalone:markResolution', markResolutionFactory],
      ['points/testStandalone:copyFromXyz', copyFromXyzFactory],
      ['points/testEmitMrt:mrtParticle', mrtParticleFactory],
      ['points/testEmitMrt:combineXyzVel', combineXyzVelFactory],
      ['points/testEmitState:constOutput', constOutputFactory],
      ['points/testJoinState:agentMrt', agentMrtFactory],
      ['points/testJoinState:copyFromLifeData', copyFromLifeDataFactory],
    ]),
    tileRows: 2,
  })
}

test('iterated group binds the per-iteration frame/time/deltaTime schedule and iterates N times', async () => {
  const N = 4
  const T = 0.5
  const program = `search synth\niterSchedule(iterationCount: ${N}).write(o0)\nrender(o0)`
  const result = fixture().render(program, { width: 1, height: 1, time: T })
  const [r, g, b, a] = result.surface.data
  assert.ok(Math.abs(r - N / 16) < 1e-6, `red should accumulate N * 1/16, got ${r}`)
  assert.equal(g, N - 1, 'green (frame) must reflect the final iteration index')
  assert.ok(Math.abs(b - T) < 1e-6, 'blue (time) must land exactly on the render-level time on the final iteration')
  assert.equal(a, Math.fround(1 / 600), 'alpha (deltaTime) must be the fixed 1/600 simulation step')

  const asyncResult = await fixture().renderAsync(program, { width: 1, height: 1, time: T })
  assert.deepEqual([...asyncResult.surface.data], [...result.surface.data])
})

test('a two-step particle group interleaves per-iteration, proving trails see intermediate not final state', () => {
  const result = fixture().render(
    'search points\ntestEmit(iterationCount: 4).testDeposit().write(o0)\nrender(o0)',
    { width: 1, height: 1 },
  )
  // sum(1..4) = 10 under correct interleaving; per-effect (run-to-completion) iteration would
  // deposit the FINAL state (4) four times instead: 4 * 4 = 16.
  assert.ok(Math.abs(result.surface.data[0] - 10) < 1e-6)
})

test('iterationCount: 0 produces a byte-exact clone of the group input and runs no passes', () => {
  const before = fixture().render('search synth\nfill(value: 0.4).write(o0)\nrender(o0)', { width: 3, height: 3 })
  const after = fixture().render(
    'search synth, filter\nfill(value: 0.4).iterZero(iterationCount: 0).write(o0)\nrender(o0)',
    { width: 3, height: 3 },
  )
  assert.deepEqual([...after.surface.data], [...before.surface.data])
  assert.equal(after.stats.passes, before.stats.passes, 'the N=0 group must not run its pass at all')
})

test('loop regions reuse one accumulator while freezing the pre-loop input across iterations', async () => {
  // Break caught: feeding the previous loop output back as the next iteration's input double
  // counts it; only global_accum should advance while the pre-loop input stays fixed.
  const program = `
    search synth, filter, render
    fill(value: 0.2).loopBegin(iterationCount: 3).loopAdd().loopEnd().write(o0)
    render(o0)
  `
  const sync = fixture().render(program, { width: 1, height: 1 })
  assert.ok(Math.abs(sync.surface.data[0] - 0.9) < 0.002, `expected 0.9, received ${sync.surface.data[0]}`)
  const asyncResult = await fixture().renderAsync(program, { width: 1, height: 1 })
  assert.deepEqual([...asyncResult.surface.data], [...sync.surface.data])

  const bypass = fixture().render(program.replace('iterationCount: 3', 'iterationCount: 0'), { width: 1, height: 1 })
  assert.ok(Math.abs(bypass.surface.data[0] - 0.2) < 0.002)
})

test('selfTex resolves to the same step\'s previous-iteration output, zero on iteration 0', () => {
  const n3 = fixture().render('search synth, filter\nfill(value: 0).selfTexProbe(iterationCount: 3).write(o0)\nrender(o0)', { width: 1, height: 1 })
  const n1 = fixture().render('search synth, filter\nfill(value: 0).selfTexProbe(iterationCount: 1).write(o0)\nrender(o0)', { width: 1, height: 1 })
  assert.ok(Math.abs(n3.surface.data[0] - 0.75) < 1e-6, `N=3 should accumulate 3 * 0.25 = 0.75, got ${n3.surface.data[0]}`)
  assert.ok(Math.abs(n1.surface.data[0] - 0.25) < 1e-6, `N=1 should see a zero seed then one 0.25 step, got ${n1.surface.data[0]}`)
})

// F5 (final-review): the end-of-iteration selfTex memcpy used to silently skip the copy whenever
// `result.data.length !== state.selfTexSurface.data.length`, which would leave selfTex
// permanently zero with no signal. `selfTexSizeMismatch` (defined above) genuinely diverges the
// two sizes by construction — its `outputTex` is undeclared (selfTexSurface falls back to the
// 2x2 render size) while its only pass writes a fixed 5x5 `scratchTex` instead. Both the sync and
// async paths must throw, naming the effect id and both sizes, per `assertSelfTexMatchesOutput`.
test('selfTex size mismatch throws naming the effect and both sizes, instead of silently skipping the copy', async () => {
  const program = 'search synth, filter\nfill(value: 0).selfTexSizeMismatch().write(o0)\nrender(o0)'
  assert.throws(
    () => fixture().render(program, { width: 2, height: 2 }),
    /filter\/selfTexSizeMismatch selfTex \(2x2\) must match the step's output \(5x5\)/,
  )
  await assert.rejects(
    () => fixture().renderAsync(program, { width: 2, height: 2 }),
    /filter\/selfTexSizeMismatch selfTex \(2x2\) must match the step's output \(5x5\)/,
  )
})

test('iterated group rendering is deterministic across repeated renders and separate renderer instances', async () => {
  const program = 'search synth\niterSchedule(iterationCount: 5).write(o0)\nrender(o0)'
  const first = fixture().render(program, { width: 2, height: 2, time: 0.37 })
  const second = fixture().render(program, { width: 2, height: 2, time: 0.37 }) // fresh CpuRenderer + pool
  assert.deepEqual([...second.surface.data], [...first.surface.data])

  const asyncResult = await fixture().renderAsync(program, { width: 2, height: 2, time: 0.37 })
  assert.deepEqual([...asyncResult.surface.data], [...first.surface.data])
})

test('a standalone (ungrouped) points-like effect sizes undeclared particle textures from its own stateSize param, never screen size', () => {
  const result = fixture().render(
    'search points\ntestStandalone(stateSize: 8).write(o0)\nrender(o0)',
    { width: 32, height: 32 },
  )
  assert.equal(result.surface.data[0], 8)
  assert.equal(result.surface.data[1], 8)
})

test('an MRT pass inside a particle group writes multiple group-shared particle textures that persist across iterations', () => {
  const result = fixture().render(
    'search points\ntestEmitMrt(iterationCount: 3).write(o0)\nrender(o0)',
    { width: 2, height: 2 },
  )
  assert.equal(result.surface.data[0], 3) // global_xyz: 3 iterations * +1
  assert.equal(result.surface.data[1], 30) // global_vel: 3 iterations * +10
})

test('drawMode scatter passes dispatch through the registry with the documented adapter context shape', () => {
  const result = fixture().render('search synth, filter\nfill(value: 0).customScatter().write(o0)\nrender(o0)', { width: 1, height: 1 })
  assert.equal(result.surface.data[0], 0.5)
})

test('a pass with drawMode "points"/"billboards" and no registered adapter throws naming the missing key (non-iterated path)', () => {
  assert.throws(
    () => fixture().render('search synth, filter\nfill().missingScatter().write(o0)\nrender(o0)', { width: 1, height: 1 }),
    /Missing CPU scatter adapter "filter\/missingScatter:deposit"/,
  )
})

test('a pass with drawMode "points"/"billboards" and no registered adapter throws naming the missing key (iterated group path)', () => {
  assert.throws(
    () => fixture().render('search synth, points\nfill().missingScatterIter().write(o0)\nrender(o0)', { width: 1, height: 1 }),
    /Missing CPU scatter adapter "points\/missingScatterIter:deposit"/,
  )
})

// Regression coverage for the fix-round-1 Critical finding: a joining step's OWN stateSize
// default/argument must never win over the group owner's — both for group-scoped texture sizing
// (or the MRT dimension-mismatch assertion fires) and for the joining step's own uniform binding
// (or its kernel's agent-indexing math silently disagrees with the texture it just resolved to).
test('a joining step inherits the group owner\'s stateSize for its group-scoped MRT texture sizing and its own uniform binding, without throwing', () => {
  const program = 'search points\ntestEmitState(stateSize: 8).testJoinState(stateSize: 4).write(o0)\nrender(o0)'
  assert.doesNotThrow(() => fixture().render(program, { width: 2, height: 2 }))
  const result = fixture().render(program, { width: 2, height: 2 })
  assert.equal(result.surface.data[0], 8, 'the shared MRT resolution (global_xyz, the owner-declared texture) must be the owner\'s stateSize (8), not mismatched against life_data')
  assert.equal(result.surface.data[1], 8, 'the joining step\'s own bound stateSize uniform must observe the owner\'s value (8), not its own declared default/argument (4)')
})

test('an ungrouped (standalone) points effect keeps using its own stateSize default — inheritance only applies to steps that actually joined an owner', () => {
  const result = fixture().render('search points\ntestJoinState().write(o0)\nrender(o0)', { width: 2, height: 2 })
  assert.equal(result.surface.data[0], 4, 'no owner is present, so global_xyz falls back to this step\'s own stateSize default (4)')
  assert.equal(result.surface.data[1], 4, 'no owner is present, so the stateSize uniform stays this step\'s own default (4)')
})
