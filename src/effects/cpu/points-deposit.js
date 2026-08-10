// Hand-ported CPU scatter adapters for the four 1-px "GL_POINTS" deposit vertex/fragment pairs:
//   points/dla:depositGrid          <- shaders/effects/points/dla/glsl/depositGrid.{vert,frag}
//   points/lenia:deposit            <- shaders/effects/points/lenia/glsl/deposit.{vert,frag}
//   points/physarum:deposit         <- shaders/effects/points/physarum/glsl/deposit.{vert,frag}
//   render/pointsRender:deposit     <- shaders/effects/render/pointsRender/glsl/deposit.{vert,frag}
// (pinned upstream clone; read-only reference, never modified by this repo)
//
// Each shader draws one point per agent (`gl_PointSize = 1.0`), so every surviving agent touches
// AT MOST one destination pixel. Adapter signature:
//   ({ pass, uniforms, bindings, inputs, destination, params }) => { pixels }
//
// Row addressing mirrors `src/effects/cpu/wormhole.js` and the established GLSL-kernel runtime
// convention (`src/csl/glsl-runtime.js#texelFetch`/`#texture`): CPU `Surface` storage is top-down
// (row 0 = image top); GLSL's `gl_VertexID`/`texelFetch` integer coordinates and NDC-derived
// viewport pixels are bottom-up (row 0 = image bottom). Converting either kind of "GL row" to a
// storage row is the same flip: `storageRow = height - 1 - glRow`. See `texelFetchAgent` and
// `scatterPointPixel` below, both centered on that one flip.
//
// Agent count: every adapter below loops `v` from 0 to `count = width * height` (the agent-state
// texture's own dimensions). Upstream itself assumes a square state texture almost everywhere:
// pointsRender's, pointsBillboardRender's, and physarum's deposit.vert compute
// `totalAgents = stateSize.x * stateSize.x`, and lenia's decodes `x = id % stateSize.x`,
// `y = id / stateSize.x` the same way; only dla's depositGrid.vert is dimension-general
// (`totalAgents = dims.x * dims.y`). `width * height` is exactly dla's own formula and is
// equivalent to the other four's only because every particle-state texture in the current catalog
// is square (`stateSize` sizes both dimensions the same) - it would diverge from upstream's own
// indexing for a hypothetical non-square state texture.

// `fract(float(gl_VertexID) * GOLDEN_RATIO_CONJUGATE)` is the golden-ratio low-discrepancy
// sequence upstream uses for density-based culling (`render/pointsRender`'s and
// `render/pointsBillboardRender`'s deposit.vert, byte-identical literal in both). Exported so
// `billboard-deposit.js` uses the exact same constant, never a re-typed copy that could drift.
export const GOLDEN_RATIO_CONJUGATE = 0.618033988749895

export function fract(value) {
  return value - Math.floor(value)
}

// `texelFetch(sampler, ivec2(x, y), 0)` on an agent-state texture (`xyzTex`/`velTex`/`rgbaTex`).
// Matches `GlslCpuRuntime#texelFetch` exactly (src/csl/glsl-runtime.js): clamp to bounds, then
// flip the GL (bottom-up) row into our top-down storage row. Real callers never go out of bounds
// (the scatter loop below only ever passes `sx = v % w`, `sy = floor(v / w)` for `v < w*h`), but
// the clamp is kept for parity with the runtime it mirrors.
export function texelFetchAgent(surface, sx, sy) {
  const width = surface.width
  const height = surface.height
  const x = sx < 0 ? 0 : sx >= width ? width - 1 : sx
  const shaderY = sy < 0 ? 0 : sy >= height ? height - 1 : sy
  const y = height - 1 - shaderY
  const offset = (y * width + x) * 4
  const data = surface.data
  return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]]
}

// GPU point rasterization equivalence (must hold exactly for every 1-px point):
// clip-space `p` -> NDC = p.xy / p.w -> pixel = floor((ndc * 0.5 + 0.5) * extent); discard when
// outside [0, extent) or w <= 0. `extent` is the DEPOSIT DESTINATION's own width/height (the
// framebuffer this point is actually rasterized into), not the agent-state texture's size.
// Returns the destination.data float offset for the touched pixel, or `null` when discarded.
//
// None of the five ported shaders ever varies `gl_Position.w` (always the literal `1.0`, for both
// kept and sentinel-culled points), so the `clipW <= 0` branch is unreachable through any of the
// adapters below; it is still implemented (not shortcut) because the rule is general, not specific
// to these five shaders' current authored values. See `test/scatter-adapters.test.js` for a direct
// unit check of both discard branches in isolation.
//
// NaN safety: a non-finite clip position (e.g. an agent whose
// state went NaN upstream) makes `glCol`/`glRow` NaN too, and every relational comparison against
// NaN is false — so the naive `<0 || >=extent` bounds check silently does NOT fire, and this would
// return a NaN offset instead of discarding. Every one of the four call sites only ever guards
// with `=== null`, so a NaN offset would flow straight into `data[NaN] += ...` (a typed-array
// no-op on write, but not an explicit, intentional discard). Checked explicitly, before the bounds
// check, so a non-finite position discards exactly like an out-of-range one.
export function scatterPointPixel(clipX, clipY, clipW, destWidth, destHeight) {
  if (!(clipW > 0)) return null
  const ndcX = clipX / clipW
  const ndcY = clipY / clipW
  const glCol = Math.floor((ndcX * 0.5 + 0.5) * destWidth)
  const glRow = Math.floor((ndcY * 0.5 + 0.5) * destHeight)
  if (!Number.isFinite(glCol) || !Number.isFinite(glRow)) return null
  if (glCol < 0 || glCol >= destWidth || glRow < 0 || glRow >= destHeight) return null
  const storageRow = destHeight - 1 - glRow
  return (storageRow * destWidth + glCol) * 4
}

// Shared clip-space CENTER computation, byte-identical between `render/pointsRender/glsl/
// deposit.vert` and `render/pointsBillboardRender/glsl/deposit.vert` (the two sources carry this
// exact block verbatim). `x`/`y`/`z` is the agent's raw `xyz.xyz` (pre-transform); returns
// `[clipX, clipY]` (clip.w is always 1 for both shaders, so NDC === clip here).
//
// Note: `deposit.vert` never converts degrees to radians — `rotateX`/`rotateY`/`rotateZ` feed
// `cos()`/`sin()` directly, and both effects' own param specs already range them
// `[0, 6.283185]` (~[0, 2*PI]), i.e. authored in radians already. Ported literally: no conversion.
export function computeClipCenter(x, y, z, uniforms) {
  if ((uniforms.viewMode | 0) === 0) {
    // Flat / 2D: positions are normalized [0,1].
    return [x * 2 - 1, y * 2 - 1]
  }

  // Ortho / 3D. `is2DSystem` auto-detects a 2D agent system (z near 0, x/y in [0,1]) versus a 3D
  // attractor (coords roughly +/-40) purely from the position values, exactly as upstream does.
  const is2DSystem = Math.abs(z) < 1.0 && x >= 0.0 && x <= 1.0 && y >= 0.0 && y <= 1.0
  let px = x
  let py = y
  let pz = z
  if (is2DSystem) {
    px = x - 0.5
    py = y - 0.5
    pz = 0.0
  }

  // Rotate X, then Y, then Z, each applied to the result of the previous step (sequential
  // reassignment in the GLSL source, not a single composed matrix multiply).
  const cosX = Math.cos(uniforms.rotateX)
  const sinX = Math.sin(uniforms.rotateX)
  const x1 = px
  const y1 = py * cosX - pz * sinX
  const z1 = py * sinX + pz * cosX

  const cosY = Math.cos(uniforms.rotateY)
  const sinY = Math.sin(uniforms.rotateY)
  const x2 = x1 * cosY + z1 * sinY
  const y2 = y1
  // z2 (= -x1*sinY + z1*cosY) is carried in the source but never read again after Z-rotation
  // (Z-rotation passes p.z through unchanged, and only p.xy is read from then on) - not computed.

  const cosZ = Math.cos(uniforms.rotateZ)
  const sinZ = Math.sin(uniforms.rotateZ)
  let fx = x2 * cosZ - y2 * sinZ
  let fy = x2 * sinZ + y2 * cosZ

  fx += uniforms.posX
  fy += uniforms.posY

  if (is2DSystem) return [fx * 3.5 * uniforms.viewScale, fy * 3.5 * uniforms.viewScale]
  return [(fx / 40.0) * uniforms.viewScale, (fy / 40.0) * uniforms.viewScale]
}

// `points/dla:depositGrid` <- depositGrid.vert + depositGrid.frag.
// Only agents that "just stuck" this step (vel.y == 1.0) deposit; everything else (including the
// vertex shader's own `gl_VertexID >= totalAgents` guard, structurally unreachable here since the
// loop below never iterates past `count`) is a no-op skip. Blend: `['one','one']` additive.
export function dlaDepositGridAdapter({ uniforms, inputs, destination }) {
  const xyzTex = inputs.xyzTex
  const velTex = inputs.velTex
  const rgbaTex = inputs.rgbaTex
  const width = xyzTex.width
  const height = xyzTex.height
  const count = width * height
  const destWidth = destination.width
  const destHeight = destination.height
  const data = destination.data
  // energy: deposit range [0.5, 20] maps to energy [0.05, 2.0], per depositGrid.frag's comment.
  const energy = uniforms.deposit * 0.1
  let pixels = 0

  for (let v = 0; v < count; v += 1) {
    const sx = v % width
    const sy = Math.floor(v / width)
    // Read vel first (cheap early-exit): texelFetch has no side effects, so reordering the three
    // reads relative to the GLSL source (which reads xyz/vel/rgba unconditionally, then gates)
    // changes nothing observable - only skips the xyz/rgba reads when they'd be discarded anyway.
    const vel = texelFetchAgent(velTex, sx, sy)
    const justStuck = vel[1] // vel.y
    if (justStuck < 0.5) continue

    const xyz = texelFetchAgent(xyzTex, sx, sy)
    const clipX = xyz[0] * 2 - 1
    const clipY = xyz[1] * 2 - 1
    const offset = scatterPointPixel(clipX, clipY, 1, destWidth, destHeight)
    if (offset === null) continue

    const rgba = texelFetchAgent(rgbaTex, sx, sy)
    // fragColor = vec4(v_color * energy, energy) -- alpha is `energy` alone, NOT rgba.a * energy.
    data[offset] += rgba[0] * energy
    data[offset + 1] += rgba[1] * energy
    data[offset + 2] += rgba[2] * energy
    data[offset + 3] += energy
    pixels += 1
  }

  return { pixels }
}

// `points/lenia:deposit` <- deposit.vert + deposit.frag.
// Every alive agent deposits the SAME constant `(depositAmount, 0, 0, 1)` regardless of its own
// color (lenia's deposit.vert has no `rgbaTex` input at all, and deposit.frag ignores agent state
// entirely). Blend: `true` additive.
//
// `uniform vec2 resolution` is declared in deposit.vert but never referenced in the shader body,
// and (like pointsRender's, see below) is never bound by the pass's own `uniforms` map either -
// unbound and dead either way.
export function leniaDepositAdapter({ uniforms, inputs, destination }) {
  const xyzTex = inputs.xyzTex
  const width = xyzTex.width
  const height = xyzTex.height
  const count = width * height
  const destWidth = destination.width
  const destHeight = destination.height
  const data = destination.data
  const depositAmount = uniforms.depositAmount
  let pixels = 0

  for (let v = 0; v < count; v += 1) {
    const sx = v % width
    const sy = Math.floor(v / width)
    const xyz = texelFetchAgent(xyzTex, sx, sy)
    if (xyz[3] < 0.5) continue // alive = xyz.w

    const clipX = xyz[0] * 2 - 1
    const clipY = xyz[1] * 2 - 1
    const offset = scatterPointPixel(clipX, clipY, 1, destWidth, destHeight)
    if (offset === null) continue

    data[offset] += depositAmount
    data[offset + 1] += 0
    data[offset + 2] += 0
    data[offset + 3] += 1
    pixels += 1
  }

  return { pixels }
}

// `points/physarum:deposit` <- deposit.vert + deposit.frag.
// Every alive agent deposits its own color scaled by the `deposit` uniform. Blend: `true` additive.
//
// `uniform vec2 resolution` is declared in deposit.vert but never referenced in the shader body
// and never bound by the pass's own `uniforms` map - unbound and dead. Same situation as
// lenia's and pointsRender's copy of this exact declaration (see their comments).
export function physarumDepositAdapter({ uniforms, inputs, destination }) {
  const xyzTex = inputs.xyzTex
  const rgbaTex = inputs.rgbaTex
  const width = xyzTex.width
  const height = xyzTex.height
  const count = width * height
  const destWidth = destination.width
  const destHeight = destination.height
  const data = destination.data
  const deposit = uniforms.deposit
  let pixels = 0

  for (let v = 0; v < count; v += 1) {
    const sx = v % width
    const sy = Math.floor(v / width)
    const pos = texelFetchAgent(xyzTex, sx, sy)
    if (pos[3] < 0.5) continue // alive = pos.w

    const clipX = pos[0] * 2 - 1
    const clipY = pos[1] * 2 - 1
    const offset = scatterPointPixel(clipX, clipY, 1, destWidth, destHeight)
    if (offset === null) continue

    const col = texelFetchAgent(rgbaTex, sx, sy)
    data[offset] += col[0] * deposit
    data[offset + 1] += col[1] * deposit
    data[offset + 2] += col[2] * deposit
    data[offset + 3] += col[3] * deposit
    pixels += 1
  }

  return { pixels }
}

// `render/pointsRender:deposit` <- deposit.vert + deposit.frag.
// Golden-ratio density cull (evaluated BEFORE reading agent state, same order as upstream), then
// alive check, then the shared flat/ortho clip-center transform. Agent color is deposited
// unscaled (`vColor = vec4(col.rgb, col.a)`; pointsRender has no `deposit` uniform). Blend: `true`
// additive.
//
// `uniform vec2 resolution` is declared in deposit.vert but never referenced in the shader body,
// and the pass's own `uniforms` map never binds it (see `render/pointsRender`'s catalog record) -
// an unbound uniform, defaulting to 0 per `createCanonicalBindings` convention, but dead code
// either way since nothing reads it.
export function pointsRenderDepositAdapter({ uniforms, inputs, destination }) {
  const xyzTex = inputs.xyzTex
  const rgbaTex = inputs.rgbaTex
  const width = xyzTex.width
  const height = xyzTex.height
  const count = width * height
  const destWidth = destination.width
  const destHeight = destination.height
  const data = destination.data
  const cullThreshold = uniforms.density / 100.0
  let pixels = 0

  for (let v = 0; v < count; v += 1) {
    const particleRandom = fract(v * GOLDEN_RATIO_CONJUGATE)
    if (particleRandom > cullThreshold) continue // ported literally: cull on `>`, keep on `<=`

    const sx = v % width
    const sy = Math.floor(v / width)
    const pos = texelFetchAgent(xyzTex, sx, sy)
    if (pos[3] < 0.5) continue // alive = pos.w

    const [clipX, clipY] = computeClipCenter(pos[0], pos[1], pos[2], uniforms)
    const offset = scatterPointPixel(clipX, clipY, 1, destWidth, destHeight)
    if (offset === null) continue

    const col = texelFetchAgent(rgbaTex, sx, sy)
    data[offset] += col[0]
    data[offset + 1] += col[1]
    data[offset + 2] += col[2]
    data[offset + 3] += col[3]
    pixels += 1
  }

  return { pixels }
}

