// Registry of hand-written CPU "scatter" adapters for vertex-stage (`drawMode: 'points'` /
// `'billboards'`) passes. The canonical pass executor cannot run these through the ordinary
// per-pixel fragment-kernel machinery (they rasterize a variable number of points/quads rather
// than filling every destination pixel exactly once), so each is a small hand-ported function
// keyed by `${effectId}:${pass.program}`, dispatched by `src/runtime/renderer.js`.
//
// Adapter signature: `({ pass, uniforms, bindings, inputs, destination, params }) => { pixels }`
//   - `pass`: the raw pass definition (name/program/inputs/outputs/uniforms/blend/count/...).
//   - `uniforms`: this pass's resolved uniforms (the same values a fragment kernel would get).
//   - `bindings`: a plain scalar context — `{ time, frame, deltaTime, seed, width, height,
//     resolution: [w, h], fullResolution: [w, h] }` — the hand-written equivalent of a kernel's
//     `$bindings` (deliberately not the full `createCanonicalBindings` shape, which carries a
//     lot of GLSL-kernel-only scaffolding an adapter has no use for). Part of the adapter contract
//     for whichever future adapter needs it; no shipped adapter currently reads `bindings` — every
//     one below destructures only `{ pass, uniforms, inputs, destination }` (plus `params` for
//     `pointsBillboardRenderDepositAdapter`'s callers). The renderer still builds it eagerly on
//     every scatter-pass call (`buildScatterBindings` in renderer.js) rather than lazily: the
//     allocation is two small arrays plus a plain object, which is negligible next to the rest of
//     a pass invocation, and keeping it eager preserves the plain-object contract above instead of
//     trading it for a lazy getter/thunk shape for no measured benefit.
//   - `inputs`: `{ uniformName: Surface }`, one entry per the pass's declared `inputs`.
//   - `destination`: the output Surface, pre-seeded by the renderer with the previous contents
//     of the named output texture (or cleared, if there were none) — the adapter blends into it
//     in place; the renderer quantizes/stores the result afterward like any other pass.
//   - `params`: the invoking step's normalized effect params.
import { runWormholeDeposit } from './wormhole.js'
import {
  dlaDepositGridAdapter,
  leniaDepositAdapter,
  physarumDepositAdapter,
  pointsRenderDepositAdapter,
} from './points-deposit.js'
import { pointsBillboardRenderDepositAdapter } from './billboard-deposit.js'
import { flow3dDepositAdapter } from './flow3d-deposit.js'

const adapters = new Map()

export function registerScatterAdapter(key, adapter) {
  if (typeof key !== 'string' || key.length === 0) throw new TypeError('registerScatterAdapter requires a non-empty string key')
  if (typeof adapter !== 'function') throw new TypeError('registerScatterAdapter requires a function adapter')
  adapters.set(key, adapter)
  return adapter
}

export function resolveScatterAdapter(key) {
  return adapters.get(key)
}

export function scatterAdapterKeys() {
  return [...adapters.keys()]
}

// Wormhole predates this registry (it was the sole hard-wired `drawMode: 'points'` consumer);
// migrating it in gives the renderer one dispatch mechanism for every scatter pass instead of a
// special case. `runWormholeDeposit`'s own signature (`input, destination, uniforms`) is
// untouched — this is purely an adapter-shaped wrapper around it.
function wormholeDepositAdapter({ inputs, destination, uniforms }) {
  return runWormholeDeposit(inputs.inputTex, destination, uniforms)
}

registerScatterAdapter('filter/wormhole:deposit', wormholeDepositAdapter)

// The six vertex-stage scatter programs carry `status: 'adapter'` coverage entries
// (glsl-coverage.js) so their `.frag` halves are never sent through the fragment-kernel
// transpiler. Hand-ported in `points-deposit.js` (the four 1-px `GL_POINTS` deposits) and
// `billboard-deposit.js` (the billboard quad deposit) — see those files for the port itself.
// `render/pointsBillboardRender`'s two pass records (`deposit`, `deposit_alpha`) share
// `program: "deposit"`, so both key to this same single registration; the adapter reads
// `pass.blend` per invocation to pick additive vs. premultiplied-over.
registerScatterAdapter('filter3d/flow3d:deposit', flow3dDepositAdapter)
registerScatterAdapter('points/dla:depositGrid', dlaDepositGridAdapter)
registerScatterAdapter('points/lenia:deposit', leniaDepositAdapter)
registerScatterAdapter('points/physarum:deposit', physarumDepositAdapter)
registerScatterAdapter('render/pointsRender:deposit', pointsRenderDepositAdapter)
registerScatterAdapter('render/pointsBillboardRender:deposit', pointsBillboardRenderDepositAdapter)
