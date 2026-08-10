import assert from 'node:assert/strict'
import test from 'node:test'

import { Surface } from '../src/runtime/surface.js'
import {
  dlaDepositGridAdapter,
  leniaDepositAdapter,
  physarumDepositAdapter,
  pointsRenderDepositAdapter,
  scatterPointPixel,
  computeClipCenter,
  texelFetchAgent,
  fract,
  GOLDEN_RATIO_CONJUGATE,
} from '../src/effects/cpu/points-deposit.js'
import {
  pointsBillboardRenderDepositAdapter,
  hash,
  billboardShapeAlpha,
  evaluateBillboardFragment,
  isPremultipliedBlend,
} from '../src/effects/cpu/billboard-deposit.js'
import { registerScatterAdapter, resolveScatterAdapter, scatterAdapterKeys } from '../src/effects/cpu/scatter-registry.js'

// ---- fixture helpers ------------------------------------------------------------------------
// Agent-state textures (xyzTex/velTex/rgbaTex) are read via `texelFetch`, which - per the
// established convention this repo already uses for every other kernel
// (src/csl/glsl-runtime.js#texelFetch, verified directly against source before writing the
// adapters) - flips the GL (bottom-up) row into our top-down `Surface` storage row:
// `storageRow = height - 1 - shaderY`. `pokeAgent` writes with that exact same, independently
// stated formula (not by calling into the adapters' own helper) so a flip-direction bug in
// either side would show up as a mismatch, not cancel out.
function makeAgentSurface(width, height) {
  return new Surface(width, height)
}

function pokeAgent(surface, sx, sy, rgba) {
  const storageRow = surface.height - 1 - sy
  const offset = (storageRow * surface.width + sx) * 4
  surface.data.set(rgba, offset)
}

function pixelAt(surface, storageRow, col) {
  const offset = (storageRow * surface.width + col) * 4
  return [...surface.data.slice(offset, offset + 4)]
}

// Builds a full expected destination buffer: `seedColor` everywhere except the listed
// `{storageRow, col, color}` overrides. Used where the whole grid (not just the touched pixel)
// is small enough to state exhaustively, so "nothing else moved" is checked directly rather than
// by a couple of spot-checks.
function buildExpectedGrid(width, height, seedColor, overrides) {
  const expected = new Surface(width, height)
  expected.clear(seedColor)
  for (const { storageRow, col, color } of overrides) {
    const offset = (storageRow * width + col) * 4
    expected.data.set(color, offset)
  }
  return [...expected.data]
}

const FLAT_VIEW_UNIFORMS = { density: 100, viewMode: 0, rotateX: 0, rotateY: 0, rotateZ: 0, viewScale: 1, posX: 0, posY: 0 }

function closeTo(actual, expected, epsilon, message) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${message}: expected ~${expected}, got ${actual}`)
}

// =========================================================================================
// render/pointsRender:deposit
// =========================================================================================

test('pointsRender deposit writes one additive pixel per live, non-culled agent', () => {
  // 2x2 agent state; density=70 -> cullThreshold=0.7. fract(v*0.618033988749895):
  //   v=0 -> 0               (kept)      v=1 -> 0.618033988749895 (kept, <= 0.7)
  //   v=2 -> 0.236067977...  (irrelevant - dead) v=3 -> 0.854101966... (culled, > 0.7)
  const xyzTex = makeAgentSurface(2, 2)
  const rgbaTex = makeAgentSurface(2, 2)
  pokeAgent(xyzTex, 0, 0, [0.25, 0.25, 0, 1]); pokeAgent(rgbaTex, 0, 0, [1, 0, 0, 1]) // v=0 alive, red
  pokeAgent(xyzTex, 1, 0, [0.75, 0.75, 0, 1]); pokeAgent(rgbaTex, 1, 0, [0, 1, 0, 1]) // v=1 alive, green
  pokeAgent(xyzTex, 0, 1, [0.1, 0.1, 0, 0]); pokeAgent(rgbaTex, 0, 1, [0, 0, 1, 1]) // v=2 dead
  pokeAgent(xyzTex, 1, 1, [0.9, 0.1, 0, 1]); pokeAgent(rgbaTex, 1, 1, [1, 1, 1, 1]) // v=3 alive, density-culled

  const destination = new Surface(8, 8)
  destination.clear([0.5, 0, 0, 0])
  const uniforms = { ...FLAT_VIEW_UNIFORMS, density: 70 }
  const result = pointsRenderDepositAdapter({ uniforms, inputs: { xyzTex, rgbaTex }, destination })

  assert.equal(result.pixels, 2)
  // agent v=0: clip=(-0.5,-0.5) -> GL pixel (col=2,row=2) -> storageRow = 8-1-2 = 5
  // agent v=1: clip=(0.5,0.5) -> GL pixel (col=6,row=6) -> storageRow = 8-1-6 = 1
  // every other pixel of the 8x8 destination must still read the plain 0.5-red seed.
  assert.deepEqual(
    [...destination.data],
    buildExpectedGrid(8, 8, [0.5, 0, 0, 0], [
      { storageRow: 5, col: 2, color: [1.5, 0, 0, 1] }, // 0.5 seed + (1,0,0,1)
      { storageRow: 1, col: 6, color: [0.5, 1, 0, 1] }, // 0.5 seed + (0,1,0,1)
    ]),
  )
})

test('pointsRender deposit discards an agent whose position rasterizes outside the destination', () => {
  const xyzTex = makeAgentSurface(1, 1)
  const rgbaTex = makeAgentSurface(1, 1)
  // x=1.5 -> clip.x=2.0 -> ndc*0.5+0.5=1.5 -> pixel col = floor(1.5*4)=6, outside [0,4).
  pokeAgent(xyzTex, 0, 0, [1.5, 0.5, 0, 1])
  pokeAgent(rgbaTex, 0, 0, [1, 1, 1, 1])
  const destination = new Surface(4, 4)
  const result = pointsRenderDepositAdapter({ uniforms: FLAT_VIEW_UNIFORMS, inputs: { xyzTex, rgbaTex }, destination })
  assert.equal(result.pixels, 0)
  assert.ok(destination.data.every((value) => value === 0))
})

test('pointsRender deposit discards a NaN clip position instead of writing a NaN offset', () => {
  // A non-finite x makes clipX/ndcX/glCol all NaN; every relational comparison against NaN is
  // false, so the naive `<0 || >=extent` bounds check alone would NOT fire - scatterPointPixel's
  // explicit `Number.isFinite` guard is what actually discards this agent.
  const xyzTex = makeAgentSurface(1, 1)
  const rgbaTex = makeAgentSurface(1, 1)
  pokeAgent(xyzTex, 0, 0, [NaN, 0.5, 0, 1])
  pokeAgent(rgbaTex, 0, 0, [1, 1, 1, 1])
  const destination = new Surface(4, 4)
  assert.doesNotThrow(() => {
    const result = pointsRenderDepositAdapter({ uniforms: FLAT_VIEW_UNIFORMS, inputs: { xyzTex, rgbaTex }, destination })
    assert.equal(result.pixels, 0)
  })
  assert.ok(destination.data.every((value) => value === 0))
})

test('pointsRender ortho mode: 2D system (no rotation) centers, scales 3.5x, and pans', () => {
  // is2DSystem (|z|<1, x,y in [0,1]): p = (0.75-0.5, 0.75-0.5) = (0.25,0.25); identity rotation;
  // clip = (0.25*3.5, 0.25*3.5) = (0.875, 0.875) -> GL pixel (col=7,row=7) -> storageRow=0.
  const xyzTex = makeAgentSurface(1, 1)
  const rgbaTex = makeAgentSurface(1, 1)
  pokeAgent(xyzTex, 0, 0, [0.75, 0.75, 0, 1])
  pokeAgent(rgbaTex, 0, 0, [1, 0, 0, 1])
  const destination = new Surface(8, 8)
  const uniforms = { ...FLAT_VIEW_UNIFORMS, viewMode: 1 }
  const result = pointsRenderDepositAdapter({ uniforms, inputs: { xyzTex, rgbaTex }, destination })
  assert.equal(result.pixels, 1)
  assert.deepEqual(pixelAt(destination, 0, 7), [1, 0, 0, 1])
})

test('pointsRender ortho mode: non-2D (3D attractor) coordinates divide by 40, no centering', () => {
  // z=5 -> |z|<1 is false -> not is2DSystem; clip = (10/40, -5/40) = (0.25,-0.125)
  // -> GL pixel (col=5,row=3) -> storageRow = 8-1-3 = 4.
  const xyzTex = makeAgentSurface(1, 1)
  const rgbaTex = makeAgentSurface(1, 1)
  pokeAgent(xyzTex, 0, 0, [10, -5, 5, 1])
  pokeAgent(rgbaTex, 0, 0, [0, 1, 0, 1])
  const destination = new Surface(8, 8)
  const uniforms = { ...FLAT_VIEW_UNIFORMS, viewMode: 1 }
  const result = pointsRenderDepositAdapter({ uniforms, inputs: { xyzTex, rgbaTex }, destination })
  assert.equal(result.pixels, 1)
  assert.deepEqual(pixelAt(destination, 4, 5), [0, 1, 0, 1])
})

test('pointsRender ortho mode applies the rotateX/Y/Z pipeline (rotateZ=PI flips a centered 2D agent)', () => {
  // Same agent as the "2D system" test above, but rotateZ=PI: cos(PI)=-1, sin(PI)~=1.2e-16.
  // fx = 0.25*cos - 0.25*sin ~= -0.25, fy = 0.25*sin + 0.25*cos ~= -0.25 (tiny float residue,
  // hence the epsilon compare on the derived clip position via the touched-pixel choice, not a
  // fuzzy pixel index - floor() lands on an exact integer pixel either way).
  // clip ~= (-0.875,-0.875) -> GL pixel (col=0,row=0) -> storageRow=7. Without rotation this same
  // agent would land at (storageRow=0,col=7) (the "2D system" test above) - asserting THAT pixel
  // stays at zero demonstrates the rotation pipeline, not just its identity case, is wired in.
  const xyzTex = makeAgentSurface(1, 1)
  const rgbaTex = makeAgentSurface(1, 1)
  pokeAgent(xyzTex, 0, 0, [0.75, 0.75, 0, 1])
  pokeAgent(rgbaTex, 0, 0, [0, 0, 1, 1])
  const destination = new Surface(8, 8)
  const uniforms = { ...FLAT_VIEW_UNIFORMS, viewMode: 1, rotateZ: Math.PI }
  const result = pointsRenderDepositAdapter({ uniforms, inputs: { xyzTex, rgbaTex }, destination })
  assert.equal(result.pixels, 1)
  assert.deepEqual(pixelAt(destination, 7, 0), [0, 0, 1, 1])
  assert.deepEqual(pixelAt(destination, 0, 7), [0, 0, 0, 0], 'un-rotated placement must stay untouched')
})

test('computeClipCenter flat mode ignores viewMode uniforms entirely (pure 2x-1 remap)', () => {
  assert.deepEqual(computeClipCenter(0.5, 0.25, 999, { viewMode: 0 }), [0, -0.5])
})

// =========================================================================================
// points/dla:depositGrid
// =========================================================================================

test('dla depositGrid only deposits justStuck (vel.y == 1) agents', () => {
  // Non-square 3x1 agent state (exercises `count = width * height`, not a square-only formula).
  // v=1 is the only stuck agent: energy = deposit * 0.1 = 10 * 0.1 = 1 (exact in float64/32).
  // xyz=(0.5,0.5) -> clip=(0,0) -> GL pixel (col=2,row=2) in a 4x4 dest -> storageRow=1.
  const xyzTex = makeAgentSurface(3, 1)
  const velTex = makeAgentSurface(3, 1)
  const rgbaTex = makeAgentSurface(3, 1)
  pokeAgent(xyzTex, 0, 0, [0.1, 0.1, 0, 1]); pokeAgent(velTex, 0, 0, [0, 0, 0, 0]); pokeAgent(rgbaTex, 0, 0, [1, 1, 1, 1])
  pokeAgent(xyzTex, 1, 0, [0.5, 0.5, 0, 1]); pokeAgent(velTex, 1, 0, [0, 1, 0, 0]); pokeAgent(rgbaTex, 1, 0, [0.25, 0.5, 0.75, 1])
  pokeAgent(xyzTex, 2, 0, [0.9, 0.9, 0, 1]); pokeAgent(velTex, 2, 0, [0, 0, 0, 0]); pokeAgent(rgbaTex, 2, 0, [1, 1, 1, 1])

  const destination = new Surface(4, 4)
  const result = dlaDepositGridAdapter({ uniforms: { deposit: 10 }, inputs: { xyzTex, velTex, rgbaTex }, destination })

  assert.equal(result.pixels, 1)
  // fragColor = vec4(rgba.rgb * energy, energy) = (0.25,0.5,0.75,1) * 1 for rgb, alpha = energy.
  // Every other pixel (both non-stuck agents, at different positions) must stay exactly zero.
  assert.deepEqual(
    [...destination.data],
    buildExpectedGrid(4, 4, [0, 0, 0, 0], [{ storageRow: 1, col: 2, color: [0.25, 0.5, 0.75, 1] }]),
  )
})

test('dla depositGrid additive blend accumulates when two stuck agents land on the same pixel', () => {
  const xyzTex = makeAgentSurface(2, 1)
  const velTex = makeAgentSurface(2, 1)
  const rgbaTex = makeAgentSurface(2, 1)
  pokeAgent(xyzTex, 0, 0, [0.5, 0.5, 0, 1]); pokeAgent(velTex, 0, 0, [0, 1, 0, 0]); pokeAgent(rgbaTex, 0, 0, [1, 0, 0, 1])
  pokeAgent(xyzTex, 1, 0, [0.5, 0.5, 0, 1]); pokeAgent(velTex, 1, 0, [0, 1, 0, 0]); pokeAgent(rgbaTex, 1, 0, [0, 1, 0, 1])

  const destination = new Surface(4, 4)
  // deposit=5 -> energy=0.5 (exact). fragColor = (rgba.rgb*energy, energy) per agent:
  //   agent0 (1,0,0,1)*0.5 -> (0.5,0,0,0.5); agent1 (0,1,0,1)*0.5 -> (0,0.5,0,0.5)
  //   additive sum: (0.5,0.5,0,1)
  const result = dlaDepositGridAdapter({ uniforms: { deposit: 5 }, inputs: { xyzTex, velTex, rgbaTex }, destination })
  assert.equal(result.pixels, 2)
  assert.deepEqual(pixelAt(destination, 1, 2), [0.5, 0.5, 0, 1])
})

test('dla depositGrid discards a NaN clip position instead of writing a NaN offset', () => {
  const xyzTex = makeAgentSurface(1, 1)
  const velTex = makeAgentSurface(1, 1)
  const rgbaTex = makeAgentSurface(1, 1)
  pokeAgent(xyzTex, 0, 0, [NaN, 0.5, 0, 1]); pokeAgent(velTex, 0, 0, [0, 1, 0, 0]); pokeAgent(rgbaTex, 0, 0, [1, 1, 1, 1])
  const destination = new Surface(4, 4)
  assert.doesNotThrow(() => {
    const result = dlaDepositGridAdapter({ uniforms: { deposit: 10 }, inputs: { xyzTex, velTex, rgbaTex }, destination })
    assert.equal(result.pixels, 0)
  })
  assert.ok(destination.data.every((value) => value === 0))
})

test('dla depositGrid asymmetric position exercises the bottom-left GL row -> top-down storage row flip', () => {
  // x != y on a square 8x8 destination, so a Y-flip bug (using glRow directly as the storage row)
  // would land the deposit on a different, wrong pixel instead of merely producing a wrong value
  // at the same (accidentally-correct-looking) location.
  //   pos=(0.125,0.625) -> clip=(-0.75,0.25) -> GL pixel: col=floor((-0.75*0.5+0.5)*8)=floor(1.0)=1
  //     row=floor((0.25*0.5+0.5)*8)=floor(5.0)=5 -> CORRECT storageRow = 8-1-5 = 2
  //   An un-flipped (or backwards-flipped) port would instead write storageRow=5 (using glRow raw).
  const xyzTex = makeAgentSurface(1, 1)
  const velTex = makeAgentSurface(1, 1)
  const rgbaTex = makeAgentSurface(1, 1)
  pokeAgent(xyzTex, 0, 0, [0.125, 0.625, 0, 1])
  pokeAgent(velTex, 0, 0, [0, 1, 0, 0])
  pokeAgent(rgbaTex, 0, 0, [0.25, 0.5, 0.75, 1])
  const destination = new Surface(8, 8)
  const result = dlaDepositGridAdapter({ uniforms: { deposit: 10 }, inputs: { xyzTex, velTex, rgbaTex }, destination })
  assert.equal(result.pixels, 1)
  assert.deepEqual(pixelAt(destination, 2, 1), [0.25, 0.5, 0.75, 1])
  assert.deepEqual(pixelAt(destination, 5, 1), [0, 0, 0, 0], 'the un-flipped row location must stay untouched')
})

// =========================================================================================
// points/lenia:deposit
// =========================================================================================

test('lenia deposit writes a constant (depositAmount,0,0,1) per alive agent and skips dead agents', () => {
  // Two alive agents at the SAME position (accumulate) plus one dead agent elsewhere.
  const xyzTex = makeAgentSurface(3, 1)
  pokeAgent(xyzTex, 0, 0, [0.5, 0.5, 0, 1])
  pokeAgent(xyzTex, 1, 0, [0.5, 0.5, 0, 1])
  pokeAgent(xyzTex, 2, 0, [0.1, 0.1, 0, 0]) // dead; would map to a different pixel if it deposited

  const destination = new Surface(4, 4)
  const result = leniaDepositAdapter({ uniforms: { depositAmount: 0.75 }, inputs: { xyzTex }, destination })

  assert.equal(result.pixels, 2)
  // 2 * (0.75,0,0,1); the dead agent (would-be pixel storageRow=3,col=0) must stay zero.
  assert.deepEqual(
    [...destination.data],
    buildExpectedGrid(4, 4, [0, 0, 0, 0], [{ storageRow: 1, col: 2, color: [1.5, 0, 0, 2] }]),
  )
})

test('lenia deposit discards a NaN clip position instead of writing a NaN offset', () => {
  const xyzTex = makeAgentSurface(1, 1)
  pokeAgent(xyzTex, 0, 0, [NaN, 0.5, 0, 1])
  const destination = new Surface(4, 4)
  assert.doesNotThrow(() => {
    const result = leniaDepositAdapter({ uniforms: { depositAmount: 0.75 }, inputs: { xyzTex }, destination })
    assert.equal(result.pixels, 0)
  })
  assert.ok(destination.data.every((value) => value === 0))
})

test('lenia deposit asymmetric position exercises the bottom-left GL row -> top-down storage row flip', () => {
  // Same (0.125,0.625) -> (storageRow=2,col=1) derivation as the dla asymmetric test above.
  const xyzTex = makeAgentSurface(1, 1)
  pokeAgent(xyzTex, 0, 0, [0.125, 0.625, 0, 1])
  const destination = new Surface(8, 8)
  const result = leniaDepositAdapter({ uniforms: { depositAmount: 0.75 }, inputs: { xyzTex }, destination })
  assert.equal(result.pixels, 1)
  assert.deepEqual(pixelAt(destination, 2, 1), [0.75, 0, 0, 1])
  assert.deepEqual(pixelAt(destination, 5, 1), [0, 0, 0, 0], 'the un-flipped row location must stay untouched')
})

// =========================================================================================
// points/physarum:deposit
// =========================================================================================

test('physarum deposit scales agent color by the deposit uniform and skips dead agents', () => {
  const xyzTex = makeAgentSurface(2, 1)
  const rgbaTex = makeAgentSurface(2, 1)
  pokeAgent(xyzTex, 0, 0, [0.5, 0.5, 0, 1]); pokeAgent(rgbaTex, 0, 0, [0.5, 0.25, 1.0, 0.5])
  pokeAgent(xyzTex, 1, 0, [0.1, 0.1, 0, 0]); pokeAgent(rgbaTex, 1, 0, [1, 1, 1, 1]) // dead

  const destination = new Surface(4, 4)
  const result = physarumDepositAdapter({ uniforms: { deposit: 0.5 }, inputs: { xyzTex, rgbaTex }, destination })

  assert.equal(result.pixels, 1)
  // rgba * 0.5; the dead agent (would-be pixel storageRow=3,col=0) must stay zero.
  assert.deepEqual(
    [...destination.data],
    buildExpectedGrid(4, 4, [0, 0, 0, 0], [{ storageRow: 1, col: 2, color: [0.25, 0.125, 0.5, 0.25] }]),
  )
})

test('physarum deposit discards a NaN clip position instead of writing a NaN offset', () => {
  const xyzTex = makeAgentSurface(1, 1)
  const rgbaTex = makeAgentSurface(1, 1)
  pokeAgent(xyzTex, 0, 0, [NaN, 0.5, 0, 1]); pokeAgent(rgbaTex, 0, 0, [1, 1, 1, 1])
  const destination = new Surface(4, 4)
  assert.doesNotThrow(() => {
    const result = physarumDepositAdapter({ uniforms: { deposit: 0.5 }, inputs: { xyzTex, rgbaTex }, destination })
    assert.equal(result.pixels, 0)
  })
  assert.ok(destination.data.every((value) => value === 0))
})

test('physarum deposit asymmetric position exercises the bottom-left GL row -> top-down storage row flip', () => {
  // Same (0.125,0.625) -> (storageRow=2,col=1) derivation as the dla asymmetric test above.
  const xyzTex = makeAgentSurface(1, 1)
  const rgbaTex = makeAgentSurface(1, 1)
  pokeAgent(xyzTex, 0, 0, [0.125, 0.625, 0, 1])
  pokeAgent(rgbaTex, 0, 0, [0.5, 0.25, 1.0, 0.5])
  const destination = new Surface(8, 8)
  const result = physarumDepositAdapter({ uniforms: { deposit: 0.5 }, inputs: { xyzTex, rgbaTex }, destination })
  assert.equal(result.pixels, 1)
  assert.deepEqual(pixelAt(destination, 2, 1), [0.25, 0.125, 0.5, 0.25])
  assert.deepEqual(pixelAt(destination, 5, 1), [0, 0, 0, 0], 'the un-flipped row location must stay untouched')
})

// =========================================================================================
// Shared 1-px rasterization rule: `scatterPointPixel` (clip -> NDC -> pixel; discard rule)
// =========================================================================================

test('scatterPointPixel implements the full discard rule (w<=0, out-of-range) with no shortcuts', () => {
  // w <= 0 discards regardless of xy (unreachable via any of the 5 shaders today - each always
  // emits clip.w = 1.0 - but the general GPU rasterization rule includes it, so it is not
  // shortcut away; this is a direct unit check of that branch in isolation.
  assert.equal(scatterPointPixel(0, 0, 0, 4, 4), null)
  assert.equal(scatterPointPixel(0, 0, -1, 4, 4), null)
  // The three off-screen sentinel constants the ported shaders actually use all discard too.
  assert.equal(scatterPointPixel(2, 2, 1, 4, 4), null) // pointsRender/physarum/billboard sentinel
  assert.equal(scatterPointPixel(-2, -2, 1, 4, 4), null) // dla sentinel
  assert.equal(scatterPointPixel(-999, -999, 1, 4, 4), null) // lenia sentinel
  // Center of a 4x4 destination: ndc=(0,0) -> pixel (col=2,row=2) -> storageRow=1 -> offset 24.
  assert.equal(scatterPointPixel(0, 0, 1, 4, 4), 24)
})

test('scatterPointPixel discards non-finite clip coordinates explicitly', () => {
  // Before this fix, NaN clip coordinates made glCol/glRow NaN, every `<`/`>=` bounds comparison
  // against NaN evaluated false (so the range check never fired), and the function returned a
  // NaN offset instead of null - relying on `data[NaN] += ...` being a silent typed-array no-op
  // at the call sites rather than an explicit, intentional discard.
  assert.equal(scatterPointPixel(NaN, 0, 1, 4, 4), null)
  assert.equal(scatterPointPixel(0, NaN, 1, 4, 4), null)
  assert.equal(scatterPointPixel(NaN, NaN, 1, 4, 4), null)
  assert.equal(scatterPointPixel(Infinity, 0, 1, 4, 4), null)
})

test('texelFetchAgent flips the GL row into storage the same way for every agent-state read', () => {
  const surface = makeAgentSurface(1, 2)
  pokeAgent(surface, 0, 0, [1, 0, 0, 0])
  pokeAgent(surface, 0, 1, [0, 1, 0, 0])
  assert.deepEqual(texelFetchAgent(surface, 0, 0), [1, 0, 0, 0])
  assert.deepEqual(texelFetchAgent(surface, 0, 1), [0, 1, 0, 0])
})

test('fract and GOLDEN_RATIO_CONJUGATE match the golden-ratio cull sequence', () => {
  closeTo(fract(0 * GOLDEN_RATIO_CONJUGATE), 0, 1e-12, 'v=0')
  closeTo(fract(1 * GOLDEN_RATIO_CONJUGATE), 0.618033988749895, 1e-12, 'v=1')
  closeTo(fract(3 * GOLDEN_RATIO_CONJUGATE), 0.8541019662496852, 1e-9, 'v=3')
})

// =========================================================================================
// render/pointsBillboardRender:deposit / deposit_alpha
// =========================================================================================

const ADDITIVE_PASS = { name: 'deposit', program: 'deposit', blend: true }
const PREMULTIPLIED_PASS = { name: 'deposit_alpha', program: 'deposit', blend: ['ONE', 'ONE_MINUS_SRC_ALPHA'] }

const BILLBOARD_BASE_UNIFORMS = {
  ...FLAT_VIEW_UNIFORMS,
  sizeVariation: 0,
  rotationVar: 0,
  seed: 0,
}

test('isPremultipliedBlend reads pass.blend for the two real billboard pass shapes', () => {
  assert.equal(isPremultipliedBlend(ADDITIVE_PASS), false)
  assert.equal(isPremultipliedBlend(PREMULTIPLIED_PASS), true)
})

test('billboard deposit rasterizes a circle SDF with premultiplied-over blend at the covered center pixel', () => {
  // Agent centered so its clip position lands EXACTLY on destination pixel (col=3,row=3 GL)'s
  // sample point: pos.x=pos.y=0.4375 -> clip=(-0.125,-0.125); ((3+0.5)/8)*2-1 = -0.125. So the
  // quad center coincides with a sample point exactly - offset=(0,0) there, p=(0,0),
  // sdf=length(0,0)-0.45=-0.45 (deep inside) -> alpha=1.
  // fragColor = vColor*alpha*opacity = (0.75,0.5,0.25,1)*1*0.5 = (0.375,0.25,0.125,0.5).
  // Premultiplied-over onto a (0.25,0.25,0.25,0.25) seed, inv = 1-0.5 = 0.5:
  //   r: 0.375 + 0.25*0.5 = 0.5     g: 0.25 + 0.25*0.5 = 0.375
  //   b: 0.125 + 0.25*0.5 = 0.25    a: 0.5 + 0.25*0.5 = 0.625
  const xyzTex = makeAgentSurface(1, 1)
  const rgbaTex = makeAgentSurface(1, 1)
  pokeAgent(xyzTex, 0, 0, [0.4375, 0.4375, 0, 1])
  pokeAgent(rgbaTex, 0, 0, [0.75, 0.5, 0.25, 1.0])
  const destination = new Surface(8, 8)
  destination.clear([0.25, 0.25, 0.25, 0.25])
  const uniforms = { ...BILLBOARD_BASE_UNIFORMS, pointSize: 4, shapeMode: 1, depositOpacity: 50 }
  const inputs = { xyzTex, rgbaTex, spriteTex: new Surface(1, 1) }
  const result = pointsBillboardRenderDepositAdapter({ pass: PREMULTIPLIED_PASS, uniforms, inputs, destination })

  assert.ok(result.pixels > 0)
  assert.deepEqual(pixelAt(destination, 4, 3), [0.5, 0.375, 0.25, 0.625])
  assert.deepEqual(pixelAt(destination, 7, 0), [0.25, 0.25, 0.25, 0.25], 'pixel outside the quad AABB must stay at its seed')
})

test('billboard deposit rasterizes a square SDF with additive blend at the covered center pixel', () => {
  // Same center-aligned trick, smaller quad (pointSize=2). Center offset=(0,0): square sdf =
  // max(0,0)-0.4 = -0.4 -> alpha=1. fragColor = (1,0,0,1)*1*1 = (1,0,0,1); additive onto zero.
  const xyzTex = makeAgentSurface(1, 1)
  const rgbaTex = makeAgentSurface(1, 1)
  pokeAgent(xyzTex, 0, 0, [0.4375, 0.4375, 0, 1])
  pokeAgent(rgbaTex, 0, 0, [1, 0, 0, 1])
  const destination = new Surface(8, 8)
  const uniforms = { ...BILLBOARD_BASE_UNIFORMS, pointSize: 2, shapeMode: 3, depositOpacity: 100 }
  const inputs = { xyzTex, rgbaTex, spriteTex: new Surface(1, 1) }
  const result = pointsBillboardRenderDepositAdapter({ pass: ADDITIVE_PASS, uniforms, inputs, destination })

  assert.ok(result.pixels > 0)
  assert.deepEqual(pixelAt(destination, 4, 3), [1, 0, 0, 1])
  assert.deepEqual(pixelAt(destination, 7, 0), [0, 0, 0, 0], 'pixel outside the quad AABB must stay at its seed')
})

test('billboard deposit asymmetric position exercises the bottom-left GL row -> top-down storage row flip', () => {
  // Quad center placed exactly on GL sample point (col=1,row=5) via x != y positions:
  // pos=((1+0.5)/8, (5+0.5)/8) -> clip=(-0.625,0.375) (verified: ((1+0.5)/8)*2-1=-0.625,
  // ((5+0.5)/8)*2-1=0.375). Correct storageRow = 8-1-5 = 2. An un-flipped (or backwards-flipped)
  // port would write to storageRow=5 (glRow used raw) instead.
  const xyzTex = makeAgentSurface(1, 1)
  const rgbaTex = makeAgentSurface(1, 1)
  pokeAgent(xyzTex, 0, 0, [1.5 / 8, 5.5 / 8, 0, 1])
  pokeAgent(rgbaTex, 0, 0, [1, 0, 0, 1])
  const destination = new Surface(8, 8)
  const uniforms = { ...BILLBOARD_BASE_UNIFORMS, pointSize: 2, shapeMode: 1, depositOpacity: 100 }
  const inputs = { xyzTex, rgbaTex, spriteTex: new Surface(1, 1) }
  const result = pointsBillboardRenderDepositAdapter({ pass: ADDITIVE_PASS, uniforms, inputs, destination })

  assert.ok(result.pixels > 0)
  assert.deepEqual(pixelAt(destination, 2, 1), [1, 0, 0, 1])
  assert.deepEqual(pixelAt(destination, 5, 1), [0, 0, 0, 0], 'the un-flipped row location must stay untouched')
})

test('billboard deposit applies a non-zero rotationVar rotation, changing square coverage like a diamond', () => {
  // End-to-end regression net for the per-particle quad rotation (previously verified only
  // analytically/symbolically). v=0, seed=42, rotationVar=100 (fraction=1):
  // the SAME `hash()` the adapter itself calls determines the rotation, computed here too so the
  // expectation is derived from the ported forward-transform math, not copied from the adapter's
  // own output.
  const rotationNoise = hash(0 + 1234.5, 42) // hash(particleID + 1234.5, seed) - deposit.vert's rotationNoise
  const TAU_APPROX_LOCAL = 6.283185 // matches billboard-deposit.js's TAU_APPROX literal exactly
  const rotation = 1.0 * rotationNoise * TAU_APPROX_LOCAL // rotationVar=100 -> fraction=1
  const cosR = Math.cos(rotation)
  const sinR = Math.sin(rotation) // rotation ~= 325.22 deg (~-34.8 deg), well clear of any 90 deg multiple

  // Center-aligned agent (as in the other billboard tests): clipCenter=(-0.125,-0.125).
  // pointSize=4 (halfSize=2, sizeClip=2*(2/8)=0.5 on both axes, which covers roughly 3-5px).
  const clipCenterX = 0.4375 * 2 - 1
  const clipCenterY = 0.4375 * 2 - 1
  const sizeClipX = 0.5
  const sizeClipY = 0.5
  const destWidth = 8
  const destHeight = 8

  // Forward-transform derivation for destination pixel (storageRow=4, col=1) - directly WEST of
  // center by exactly halfSize: dx=-0.5, dy=0 -> a=-1, b=0. Inverting the rotation (adapter's own
  // `offsetX = a*cosR + b*sinR; offsetY = -a*sinR + b*cosR`) gives a UNIT-length offset
  // (|offsetX|,|offsetY| always sums-of-squares to 1 here, since (a,b) is already a unit vector),
  // so it is provably still inside the quad's [-1,1] bound regardless of the rotation angle.
  function offsetAt(storageRow, col) {
    const glRow = destHeight - 1 - storageRow
    const sampleClipX = ((col + 0.5) / destWidth) * 2 - 1
    const sampleClipY = ((glRow + 0.5) / destHeight) * 2 - 1
    const dx = sampleClipX - clipCenterX
    const dy = sampleClipY - clipCenterY
    const a = dx / sizeClipX
    const b = dy / sizeClipY
    return { offsetX: a * cosR + b * sinR, offsetY: -a * sinR + b * cosR }
  }
  const west = offsetAt(4, 1)
  const north = offsetAt(2, 3)
  const westAlpha = billboardShapeAlpha(3, west.offsetX * 0.5 + 0.5, west.offsetY * 0.5 + 0.5)
  const northAlpha = billboardShapeAlpha(3, north.offsetX * 0.5 + 0.5, north.offsetY * 0.5 + 0.5)
  // Both reduce to the same max(|offsetX|,|offsetY|) (the two offsets are 90deg rotations of each
  // other and the square SDF's max(|x|,|y|) is invariant under axis swap), so both pixels must
  // get the SAME fragColor - a real, checkable prediction from the rotation math, not a guess.
  closeTo(westAlpha, northAlpha, 1e-12, 'west/north tips are symmetric under this rotation')

  const xyzTex = makeAgentSurface(1, 1)
  const rgbaTex = makeAgentSurface(1, 1)
  pokeAgent(xyzTex, 0, 0, [0.4375, 0.4375, 0, 1])
  pokeAgent(rgbaTex, 0, 0, [1, 0, 0, 1])
  const inputs = { xyzTex, rgbaTex, spriteTex: new Surface(1, 1) }
  const uniformsBase = { ...BILLBOARD_BASE_UNIFORMS, sizeVariation: 0, seed: 42, pointSize: 4, shapeMode: 3, depositOpacity: 100 }

  // WITH rotation: the two "diamond tip" pixels (west/north of the axis-aligned square's own
  // footprint) become covered with the exact derived alpha - the float32-storage rounding vs. the
  // pure-float64 hand derivation is a few ULPs (`Math.fround` of the derived value matches the
  // stored value exactly; verified separately), hence the tight-but-not-exact epsilon.
  const rotated = new Surface(8, 8)
  const rotatedResult = pointsBillboardRenderDepositAdapter({
    pass: ADDITIVE_PASS, uniforms: { ...uniformsBase, rotationVar: 100 }, inputs, destination: rotated,
  })
  assert.ok(rotatedResult.pixels > 0)
  const expectedWest = [1 * westAlpha, 0, 0, westAlpha]
  const expectedNorth = [1 * northAlpha, 0, 0, northAlpha]
  const westPixel = pixelAt(rotated, 4, 1)
  const northPixel = pixelAt(rotated, 2, 3)
  for (let channel = 0; channel < 4; channel += 1) {
    closeTo(westPixel[channel], expectedWest[channel], 1e-6, `rotated west-tip channel ${channel}`)
    closeTo(northPixel[channel], expectedNorth[channel], 1e-6, `rotated north-tip channel ${channel}`)
  }
  // The quad's own center is rotation-invariant (offset=(0,0) maps to itself under any rotation).
  assert.deepEqual(pixelAt(rotated, 4, 3), [1, 0, 0, 1])

  // WITHOUT rotation (rotationVar=0), the SAME two tip pixels must be uncovered: this is the
  // control that proves the rotation - not something else - is what changes the footprint.
  const unrotated = new Surface(8, 8)
  pointsBillboardRenderDepositAdapter({ pass: ADDITIVE_PASS, uniforms: { ...uniformsBase, rotationVar: 0 }, inputs, destination: unrotated })
  assert.deepEqual(pixelAt(unrotated, 4, 1), [0, 0, 0, 0], 'axis-aligned square must not reach this tip')
  assert.deepEqual(pixelAt(unrotated, 2, 3), [0, 0, 0, 0], 'axis-aligned square must not reach this tip')
  assert.deepEqual(pixelAt(unrotated, 4, 3), [1, 0, 0, 1], 'the center stays covered either way')
})

// Shared by both sprite-sampling tests below: 2x2 sprite, four distinct texels, storage
// (row0,col0)=red, (row0,col1)=green, (row1,col0)=blue, (row1,col1)=yellow.
function makeFourColorSprite() {
  const sprite = new Surface(2, 2)
  const setTexel = (row, col, rgba) => sprite.data.set(rgba, (row * 2 + col) * 4)
  setTexel(0, 0, [1, 0, 0, 1])
  setTexel(0, 1, [0, 1, 0, 1])
  setTexel(1, 0, [0, 0, 1, 1])
  setTexel(1, 1, [1, 1, 0, 1])
  return sprite
}

test('billboard deposit shapeMode 0 samples spriteTex with NEAREST filtering by default (plain Surface, no .filter)', () => {
  // `tex`/`spriteTex` is a `type:"surface"` param, not `definition.
  // externalTexture` (null for this effect) - `buildBindings`'s surface branch never sets
  // `.filter`, so there is no blanket "sprites are linear" rule. Canonical convention (README):
  // nearest unless the bound Surface is explicitly `filter: 'linear'`.
  // Center-aligned agent -> offset=(0,0) -> u=v=0.5 (dead center). `sampleNearestBottomLeft` at
  // u=v=0.5 on a 2x2 texture: x=clamp(floor(0.5*2),0,1)=1; shaderY=clamp(floor(0.5*2),0,1)=1,
  // y=2-1-1=0 -> storage (row=0,col=1) = green, exactly (no averaging).
  const xyzTex = makeAgentSurface(1, 1)
  const rgbaTex = makeAgentSurface(1, 1)
  pokeAgent(xyzTex, 0, 0, [0.4375, 0.4375, 0, 1])
  pokeAgent(rgbaTex, 0, 0, [1, 1, 1, 1])
  const sprite = makeFourColorSprite() // no .filter set - the default path

  const destination = new Surface(8, 8)
  const uniforms = { ...BILLBOARD_BASE_UNIFORMS, pointSize: 4, shapeMode: 0, depositOpacity: 100 }
  const inputs = { xyzTex, rgbaTex, spriteTex: sprite }
  const result = pointsBillboardRenderDepositAdapter({ pass: ADDITIVE_PASS, uniforms, inputs, destination })

  assert.ok(result.pixels > 0)
  assert.deepEqual(pixelAt(destination, 4, 3), [0, 1, 0, 1], 'nearest picks the exact green texel, no blend with neighbors')
  assert.deepEqual(pixelAt(destination, 7, 0), [0, 0, 0, 0])
})

test('billboard deposit shapeMode 0 samples spriteTex BILINEARLY when the bound Surface has filter==="linear"', () => {
  // Same fixture, but the sprite carries filter:'linear' (how an external/image-sourced surface
  // would be routed in) - bilinear sampling at u=v=0.5 on this 2x2 texture is an equal 4-way
  // average: ((1,0,0,1)+(0,1,0,1)+(0,0,1,1)+(1,1,0,1))/4 = (0.5,0.5,0.25,1).
  const xyzTex = makeAgentSurface(1, 1)
  const rgbaTex = makeAgentSurface(1, 1)
  pokeAgent(xyzTex, 0, 0, [0.4375, 0.4375, 0, 1])
  pokeAgent(rgbaTex, 0, 0, [1, 1, 1, 1])
  const sprite = makeFourColorSprite()
  sprite.filter = 'linear'

  const destination = new Surface(8, 8)
  const uniforms = { ...BILLBOARD_BASE_UNIFORMS, pointSize: 4, shapeMode: 0, depositOpacity: 100 }
  const inputs = { xyzTex, rgbaTex, spriteTex: sprite }
  const result = pointsBillboardRenderDepositAdapter({ pass: ADDITIVE_PASS, uniforms, inputs, destination })

  assert.ok(result.pixels > 0)
  assert.deepEqual(pixelAt(destination, 4, 3), [0.5, 0.5, 0.25, 1])
  assert.deepEqual(pixelAt(destination, 7, 0), [0, 0, 0, 0])
})

test('billboard deposit skips a quad entirely when density-culled or dead (no destination pixel touched)', () => {
  const xyzTex = makeAgentSurface(2, 1)
  const rgbaTex = makeAgentSurface(2, 1)
  pokeAgent(xyzTex, 0, 0, [0.5, 0.5, 0, 0]) // dead
  pokeAgent(xyzTex, 1, 0, [0.5, 0.5, 0, 1]) // alive, but fract(1*GOLDEN)=0.618 > cullThreshold(0.5)
  pokeAgent(rgbaTex, 0, 0, [1, 1, 1, 1])
  pokeAgent(rgbaTex, 1, 0, [1, 1, 1, 1])

  const destination = new Surface(4, 4)
  const seed = [0.125, 0.25, 0.375, 0.5]
  destination.clear(seed)
  const uniforms = { ...BILLBOARD_BASE_UNIFORMS, density: 50, pointSize: 8, shapeMode: 1, depositOpacity: 100 }
  const inputs = { xyzTex, rgbaTex, spriteTex: new Surface(1, 1) }
  const result = pointsBillboardRenderDepositAdapter({ pass: ADDITIVE_PASS, uniforms, inputs, destination })

  assert.equal(result.pixels, 0)
  assert.ok(destination.data.every((value, index) => value === seed[index % 4]))
})

test('billboard hash() is deterministic and matches the PCG-style deposit.vert derivation', () => {
  // Computed directly from the ported algorithm (floatBitsToUint(fround(n+seed)) fed through the
  // PCG hash, divided by 2^32-1).
  closeTo(hash(0, 42), 0.07695067745562426, 1e-12, 'hash(0,42)')
  closeTo(hash(1234.5, 42), 0.9033963931499507, 1e-12, 'hash(1234.5,42)')
  assert.equal(hash(5, 1), hash(5, 1), 'hash must be a pure function of (n, seed)')
  assert.notEqual(hash(0, 42), hash(1, 42), 'distinct particle indices must (almost certainly) hash differently')
})

test('billboardShapeAlpha: circle/ring/square/diamond/triangle/star/soft all evaluate finite alpha in [0,1]', () => {
  assert.equal(billboardShapeAlpha(1, 0.5, 0.5), 1, 'circle center is fully inside')
  closeTo(billboardShapeAlpha(1, 0.95, 0.5), 0.5, 1e-9, 'circle sdf==0 boundary is the smoothstep midpoint')
  assert.equal(billboardShapeAlpha(3, 0.9, 0.5), 0.5, 'square sdf==0 boundary is exactly the smoothstep midpoint')
  assert.equal(billboardShapeAlpha(2, 0.85, 0.5), 1, 'ring at its own radius is fully inside the band')
  assert.equal(billboardShapeAlpha(4, 0.5, 0.5), 1, 'diamond center is fully inside')
  assert.equal(billboardShapeAlpha(5, 0.5, 0.5), 1, 'triangle center is fully inside')
  assert.equal(billboardShapeAlpha(6, 0.5, 0.5), 1, 'star center is fully inside')
  assert.equal(billboardShapeAlpha(7, 0.5, 0.5), 1, 'soft gaussian peaks at 1 in the center')
  closeTo(billboardShapeAlpha(7, 0.75, 0.5), 0.6065306597126334, 1e-12, 'soft gaussian at p=(0.25,0) is exp(-0.5)')
  // Upstream's own fallthrough: any shapeMode outside 1..6 that reaches the shape branch (i.e.
  // is not 0) renders as "soft", not just the literal value 7.
  closeTo(billboardShapeAlpha(99, 0.75, 0.5), 0.6065306597126334, 1e-12, 'out-of-domain shapeMode falls through to soft')
  for (const mode of [1, 2, 3, 4, 5, 6, 7]) {
    const alpha = billboardShapeAlpha(mode, 0.5, 0.5)
    assert.ok(Number.isFinite(alpha) && alpha >= 0 && alpha <= 1, `shapeMode ${mode} alpha must be finite in [0,1]`)
  }
})

test('evaluateBillboardFragment texture mode multiplies sampled sprite by agent color and opacity', () => {
  // Power-of-two texel values so `sampleBilinear`'s internal `Math.fround` (applied even when
  // tx=ty=0 for a 1x1 texture) is a lossless no-op, keeping the expected products exact.
  const sprite = new Surface(1, 1, new Float32Array([0.5, 0.25, 0.125, 1.0]))
  const out = evaluateBillboardFragment(0, sprite, 0.5, 0.5, [1, 0.5, 1, 1], 0.5)
  // A 1x1 texture returns the same texel for any UV; fragColor = (spr.rgb*col.rgb, spr.a*col.a)*opacity
  assert.deepEqual(out, [0.5 * 1 * 0.5, 0.25 * 0.5 * 0.5, 0.125 * 1 * 0.5, 1.0 * 1 * 0.5])
})

// =========================================================================================
// Registry wiring
// =========================================================================================

test('all five deposit adapters are registered under their exact catalog keys', () => {
  assert.equal(resolveScatterAdapter('points/dla:depositGrid'), dlaDepositGridAdapter)
  assert.equal(resolveScatterAdapter('points/lenia:deposit'), leniaDepositAdapter)
  assert.equal(resolveScatterAdapter('points/physarum:deposit'), physarumDepositAdapter)
  assert.equal(resolveScatterAdapter('render/pointsRender:deposit'), pointsRenderDepositAdapter)
  assert.equal(resolveScatterAdapter('render/pointsBillboardRender:deposit'), pointsBillboardRenderDepositAdapter)
  for (const key of [
    'points/dla:depositGrid',
    'points/lenia:deposit',
    'points/physarum:deposit',
    'render/pointsRender:deposit',
    'render/pointsBillboardRender:deposit',
  ]) {
    assert.ok(scatterAdapterKeys().includes(key))
  }
})

test('registerScatterAdapter still rejects malformed registrations (registry contract unchanged)', () => {
  assert.throws(() => registerScatterAdapter('', dlaDepositGridAdapter), TypeError)
  assert.throws(() => registerScatterAdapter('x/y:z', null), TypeError)
})
