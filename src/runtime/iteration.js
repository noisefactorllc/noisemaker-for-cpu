// Iteration-group computation for the CPU renderer's stateful/particle effects.
//
// Pure and side-effect-free: `computeIterationGroups` only reads the particle-state texture name
// pattern (`PARTICLE_STATE_PATTERN` below) off each step's `definition`/`params`; it never
// touches surfaces, the pool, or render options. Kept separate
// from `renderer.js` so the grouping algorithm is independently unit-testable (see
// `test/iterated-effects.test.js`).

// `render/pointsEmit` (the only definition that declares `global_xyz` itself) opens and owns a
// particle group; any subsequent step whose pass graph references one of these names joins the
// open group. A texture that is merely `global_`-prefixed by convention (e.g.
// `synth/reactionDiffusion`'s private `global_rd_state`) does NOT match this pattern — it stays
// ordinary per-step scratch, never shared across steps.
export const PARTICLE_STATE_PATTERN = /^global_(xyz|vel|rgba|life_data)$|^global_.*_trail$/

export function isParticleStateName(name) {
  return typeof name === 'string' && PARTICLE_STATE_PATTERN.test(name)
}

// Upstream's synthetic per-simulation-tick step: 1/60s over its canonical 10s wraparound loop.
export const ITERATION_DELTA_TIME = 1 / 600

export function wrap01(value) {
  return ((value % 1) + 1) % 1
}

function declaresXyz(step) {
  return Object.prototype.hasOwnProperty.call(step.definition.textures ?? {}, 'global_xyz')
}

function referencesParticleState(step) {
  for (const pass of step.definition.passes ?? []) {
    for (const value of Object.values(pass.inputs ?? {})) if (isParticleStateName(value)) return true
    for (const value of Object.values(pass.outputs ?? {})) if (isParticleStateName(value)) return true
  }
  return false
}

// Groups a chain's steps for iterated execution.
//
// - A step declaring `global_xyz` in its own `definition.textures` (only `render/pointsEmit`)
//   always closes whatever group is currently open and OPENS a new one that it owns — even if
//   the immediately preceding step was itself an open particle group (two `pointsEmit()` calls
//   in one chain therefore open two independent groups, never one merged group).
// - While a particle group is open, a step joins it iff any of its OWN pass inputs/outputs
//   reference a particle-state name; otherwise it closes the group.
// - `read`/`write` steps are always boundaries: they close any open group and pass through as
//   their own single-step, non-iterated group entry. The renderer recognizes these by
//   `steps[0].kind` and runs its existing read/write handling instead of the iteration-group
//   executor.
//
// Returns `[{ steps: [...], iterated: boolean }]`. A group's `iterated` flag is simply the
// group-opening/owning step's own `definition.iterated` — true for every particle group (only
// `render/pointsEmit` can open one, and it is always in the iterated set) and for single-step
// groups formed from any of the 21 iterated effects; false for read/write boundaries and for
// every other (today-unchanged, single-iteration) effect.
export function computeIterationGroups(steps) {
  const groups = []
  let openGroup = null
  let openLoop = null

  const closeOpenGroup = () => {
    if (!openGroup) return
    groups.push({ steps: openGroup.steps, iterated: openGroup.iterated })
    openGroup = null
  }

  for (const step of steps) {
    if (openLoop) {
      if (step.kind === 'read' || step.kind === 'write') throw new Error('Loop iteration group cannot cross a read/write boundary')
      if (step.definition?.loopRole === 'begin') throw new Error('Nested loop iteration groups are not supported')
      openLoop.steps.push(step)
      if (step.definition?.loopRole === 'end') {
        groups.push({ steps: openLoop.steps, iterated: true, loop: true })
        openLoop = null
      }
      continue
    }
    if (step.kind === 'read' || step.kind === 'write') {
      closeOpenGroup()
      groups.push({ steps: [step], iterated: false })
      continue
    }
    if (step.definition?.loopRole === 'end') throw new Error('loopEnd has no matching loopBegin')
    if (step.definition?.loopRole === 'begin') {
      closeOpenGroup()
      openLoop = { steps: [step] }
      continue
    }
    if (declaresXyz(step)) {
      closeOpenGroup()
      openGroup = { steps: [step], iterated: step.definition.iterated === true }
      continue
    }
    if (openGroup && referencesParticleState(step)) {
      openGroup.steps.push(step)
      continue
    }
    closeOpenGroup()
    groups.push({ steps: [step], iterated: step.definition.iterated === true })
  }
  if (openLoop) throw new Error('loopBegin has no matching loopEnd')
  closeOpenGroup()
  return groups
}
