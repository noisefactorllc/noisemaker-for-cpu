import { compileDsl } from '../dsl/compiler.js'
import { bindCanonicalKernel } from '../csl/glsl-kernel.js'
import { BufferPool } from './buffer-pool.js'
import { runPass, runPassAsync } from './pass-runner.js'
import { RenderResult } from './render-result.js'
import { Surface } from './surface.js'
import { quantizeTexture } from './texture-format.js'
import { renderCanonicalWormOverlay } from '../effects/cpu/worm-overlay.js'
import { resolveScatterAdapter } from '../effects/cpu/scatter-registry.js'
import { paletteData } from '../effects/generated/canonical-adapter-data.js'
import { computeIterationGroups, isParticleStateName, wrap01, ITERATION_DELTA_TIME } from './iteration.js'

// Fallback size/format for a group-scoped particle-state texture (`global_xyz`/`global_vel`/
// `global_rgba`/`global_life_data`/`global_*_trail`) that nobody in its iteration group declares
// in `definition.textures` (e.g. a `points/*` effect used without a `pointsEmit` ahead of it).
// Sized from the REFERENCING step's own `stateSize` param when it has one (never the screen-size
// fallback — an undeclared particle buffer is agent-count-shaped, not image-shaped) and 256
// otherwise, matching every declared `{param:'stateSize', default:256}` spec in the real catalog.
const PARTICLE_STATE_FALLBACK_SIZE = 256
const PARTICLE_STATE_FALLBACK_FORMATS = {
  global_xyz: 'rgba32f',
  global_vel: 'rgba32f',
  global_rgba: 'rgba8',
  global_life_data: 'rgba16f',
}

function particleStateFallbackFormat(name) {
  return PARTICLE_STATE_FALLBACK_FORMATS[name] ?? 'rgba16f'
}

// The value every JOINING step in a group must inherit for its own `stateSize` (both for sizing
// any group-scoped particle texture it declares and for its own `stateSize` uniform binding) —
// `undefined` for an ungrouped/single-step group (nothing to inherit from) or when the owner
// itself declares no `stateSize` param. See `initializeGroupStepState`'s doc comment for why
// this must be unconditional (matches upstream marking a joining effect's `stateSize` control
// hidden/non-user-facing) and why it has to reach both the texture-sizing and uniform-binding
// paths, not just one.
function groupOwnerStateSize(group) {
  if (group.steps.length <= 1) return undefined
  const owner = group.steps[0]
  return Object.hasOwn(owner.params, 'stateSize') ? owner.params.stateSize : undefined
}

// Shared by `canonicalMrtDestinations` (non-iterated fast path) and `groupMrtDestinations`
// (iterated groups): every destination an MRT pass writes in one shared pixel loop must resolve
// to identical dimensions, or whichever destination is smaller would silently get scrambled by
// the larger loop's scatter stride.
function assertMrtDestinationsShareDimensions(definitionId, passName, destinations) {
  const [{ surface: first }] = destinations
  const mismatched = destinations.some(({ surface }) => surface.width !== first.width || surface.height !== first.height)
  if (mismatched) {
    const sizes = destinations.map(({ name, surface }) => `${name} (${surface.width}x${surface.height})`).join(', ')
    throw new Error(`${definitionId} pass "${passName}" MRT destinations must share dimensions: ${sizes}`)
  }
}

// Shared by `runGroupStepIterationSync`/`Async`'s end-of-iteration `selfTex`/`feedback` memcpy:
// `state.selfTexSurface` is allocated once (see `initializeGroupStepState`) from the step's own
// declared `outputTex` texture spec, and the group's real per-iteration `result` must resolve to
// that same size for the plain `Float32Array#set` copy that follows to be meaningful. Unreachable
// in the shipped catalog — `filter/convolutionFeedback` (the only selfTex reader) has its
// `outputTex` and `selfTex` placeholder resolve from that same texture spec, so they always
// match — but silently skipping the copy on a hypothetical future mismatch would leave selfTex
// permanently zero with no signal. Loud-failure convention (cf.
// `assertMrtDestinationsShareDimensions` above): name the effect and both sizes instead.
function assertSelfTexMatchesOutput(definitionId, result, selfTexSurface) {
  if (result.data.length === selfTexSurface.data.length) return
  throw new Error(`${definitionId} selfTex (${selfTexSurface.width}x${selfTexSurface.height}) must match the step's output (${result.width}x${result.height})`)
}

function assertRenderOptions(options) {
  const width = options.width ?? 512
  const height = options.height ?? 512
  if (!Number.isInteger(width) || width <= 0) throw new RangeError('width must be a positive integer')
  if (!Number.isInteger(height) || height <= 0) throw new RangeError('height must be a positive integer')
  const time = options.time ?? 0
  const seed = options.seed ?? 1
  if (!Number.isFinite(time)) throw new TypeError('time must be finite')
  if (!Number.isInteger(seed)) throw new TypeError('seed must be an integer')
  const oneShot = options.oneShot ?? 'ready'
  if (!['ready', 'initial'].includes(oneShot)) throw new TypeError('oneShot must be "ready" or "initial"')
  return {
    width,
    height,
    time,
    frame: options.frame ?? 0,
    seed,
    externalTextures: options.externalTextures ?? {},
    seedSurfaces: options.seedSurfaces ?? null,
    oneShot,
  }
}

// `axis` selects which of `ctx.width`/`ctx.height` is this dimension's own screen-relative
// fallback; `ctx.params` are the invocation's normalized effect params (used by the
// `{ param }`/`{ screenDivide }` object forms below).
function textureDimension(spec, axis, ctx) {
  const fallback = ctx[axis]
  if (spec === undefined || spec === 'input' || spec === 'screen' || spec === '100%') return fallback
  if (typeof spec === 'number') return Math.max(1, Math.round(spec))
  if (typeof spec === 'string') {
    const percent = spec.match(/^(\d+(?:\.\d+)?)%$/)
    if (percent) return Math.max(1, Math.round(fallback * Number(percent[1]) / 100))
    throw new TypeError(`Unsupported canonical texture dimension ${JSON.stringify(spec)}`)
  }
  if (spec && typeof spec === 'object') {
    if ('param' in spec) {
      const value = ctx.params?.[spec.param] ?? spec.paramDefault ?? spec.default
      return Math.max(1, Math.round(value))
    }
    if ('screenDivide' in spec) {
      const divisor = Math.max(1, ctx.params?.[spec.screenDivide] ?? spec.default)
      return Math.max(1, Math.ceil(fallback / divisor))
    }
  }
  throw new TypeError(`Unsupported canonical texture dimension ${JSON.stringify(spec)}`)
}

// Numeric `pass.repeat` is used as-is (default 1, unchanged from the original behavior).
// String `pass.repeat` names a uniform (already resolved onto the step's bound uniforms by
// `buildBindings`/param `uniform:` wiring) holding the iteration count for this invocation.
function resolveRepeatCount(pass, uniforms) {
  if (typeof pass.repeat === 'string') return Math.max(0, Math.trunc(uniforms[pass.repeat] ?? 1))
  return pass.repeat ?? 1
}

// `pass.conditions.runIf`/`skipIf` gate whether a pass runs at all this invocation, evaluated
// against the step's bound uniforms (numeric comparison after `Number(...)` coercion so
// boolean- or string-valued uniforms compare sanely against a literal `equals`).
function passIsActive(pass, uniforms) {
  const conditions = pass.conditions
  if (!conditions) return true
  for (const entry of conditions.runIf ?? []) {
    if (Number(uniforms[entry.uniform]) !== Number(entry.equals)) return false
  }
  for (const entry of conditions.skipIf ?? []) {
    if (Number(uniforms[entry.uniform]) === Number(entry.equals)) return false
  }
  return true
}

function remapUniformData(uniforms, width, height) {
  const data = Array.from({ length: 267 }, () => new Float32Array(4))
  const bg = uniforms.bgColor ?? [0, 0, 0]
  data[0].set([bg[0], bg[1], bg[2], uniforms.bgAlpha ?? 1])
  data[1].set([uniforms.zoneCount ?? 0, uniforms.smoothEdge ?? 0.04, 0, uniforms.time ?? 0])
  for (let zone = 0; zone < 8; zone += 1) {
    data[2 + zone].set([
      uniforms[`zone${zone}_count`] ?? 0,
      uniforms[`zone${zone}_active`] ?? 0,
      0,
      uniforms[`zone${zone}_alpha`] ?? 1,
    ])
    for (let pair = 0; pair < 32; pair += 1) {
      data[10 + zone * 32 + pair].set(uniforms[`zone${zone}_v${pair}`] ?? [0, 0, 0, 0])
    }
  }
  data[266][0] = width
  data[266][1] = height
  return data
}

export class CpuRenderer {
  constructor(options = {}) {
    if (!options.registry) throw new TypeError('CpuRenderer requires an EffectRegistry')
    this.registry = options.registry
    this.kernels = options.kernels instanceof Map ? options.kernels : new Map(Object.entries(options.kernels ?? {}))
    this.kernelFactories = options.kernelFactories instanceof Map ? options.kernelFactories : new Map(Object.entries(options.kernelFactories ?? {}))
    this.tileRows = options.tileRows ?? 32
    this.pool = options.pool ?? new BufferPool()
    this.emptySurface = options.emptySurface ?? new Surface(1, 1)
    this.cpuTextureCacheByteLimit = options.cpuTextureCacheByteLimit ?? 64 * 1024 * 1024
    if (!Number.isSafeInteger(this.cpuTextureCacheByteLimit) || this.cpuTextureCacheByteLimit < 0) {
      throw new RangeError('cpuTextureCacheByteLimit must be a non-negative safe integer')
    }
    this.cpuTextureCache = new Map()
    this.cpuTextureCacheBytes = 0
  }

  resolveKernel(key) {
    const compiled = typeof key === 'function' ? key : this.kernels.get(key)
    const kernel = typeof compiled === 'function' ? compiled : compiled?.runPixel
    if (typeof kernel !== 'function') throw new Error(`Missing compiled CSL kernel "${key}"`)
    return kernel
  }

  buildBindings(definition, params, explicitParams, current, surfaces, renderOptions) {
    const uniforms = {}
    const textures = {}
    if (current) textures.inputTex = current
    for (const name of definition.paramNames) {
      const param = definition.params[name]
      const value = params[name]
      if (param.type === 'surface') {
        let surface
        if (value === null) surface = this.emptySurface
        else if (value.kind === 'input') surface = current
        else {
          surface = surfaces.get(value.name)
          if (!surface) throw new Error(`Surface ${value.name} has not been written`)
        }
        if (!surface) throw new Error(`${definition.id} parameter "${name}" requires an input surface`)
        textures[param.texture ?? name] = surface
        if (param.colorModeUniform) uniforms[param.colorModeUniform] = value === null ? 0 : 1
      } else {
        if (param.define) uniforms[param.define] = value
        else uniforms[param.uniform ?? name] = value
      }
    }
    if (definition.namespace === 'classicNoisedeck') {
      const paletteName = definition.paramNames.find((name) => definition.params[name].type === 'palette')
      const paletteIndex = paletteName ? params[paletteName] : 0
      const entry = Number.isInteger(paletteIndex) && paletteIndex > 0 ? paletteData[paletteIndex - 1] : null
      if (entry) {
        uniforms.paletteAmp = entry.slice(0, 3)
        uniforms.paletteFreq = entry.slice(4, 7)
        uniforms.paletteOffset = entry.slice(8, 11)
        uniforms.palettePhase = entry.slice(12, 15)
        uniforms.paletteMode = entry[3] === 0 ? 3 : entry[3]
      }
    }
    if (definition.externalTexture) {
      const external = renderOptions.externalTextures[definition.externalTexture]
      if (!external?.data) throw new Error(`${definition.id} requires external texture "${definition.externalTexture}"`)
      textures[definition.externalTexture] = {
        width: external.width,
        height: external.height,
        data: external.data,
        filter: 'linear',
      }
    }
    if (definition.id === 'synth/remap') uniforms.data = remapUniformData(uniforms, renderOptions.width, renderOptions.height)
    return { uniforms, textures }
  }

  effectParams(step, renderOptions) {
    if (!Object.hasOwn(step.params, 'seed') || step.explicitParams.includes('seed')) return step.params
    return { ...step.params, seed: renderOptions.seed }
  }

  cachedCpuTexture(key) {
    const surface = this.cpuTextureCache.get(key)
    if (!surface) return null
    this.cpuTextureCache.delete(key)
    this.cpuTextureCache.set(key, surface)
    return surface
  }

  cacheCpuTexture(key, surface) {
    const bytes = surface.data.byteLength
    if (bytes > this.cpuTextureCacheByteLimit) return
    const previous = this.cpuTextureCache.get(key)
    if (previous) {
      this.cpuTextureCacheBytes -= previous.data.byteLength
      this.cpuTextureCache.delete(key)
    }
    this.cpuTextureCache.set(key, surface)
    this.cpuTextureCacheBytes += bytes
    while (this.cpuTextureCacheBytes > this.cpuTextureCacheByteLimit) {
      const oldestKey = this.cpuTextureCache.keys().next().value
      const oldest = this.cpuTextureCache.get(oldestKey)
      this.cpuTextureCache.delete(oldestKey)
      this.cpuTextureCacheBytes -= oldest.data.byteLength
    }
  }

  clearCpuTextureCache() {
    this.cpuTextureCache.clear()
    this.cpuTextureCacheBytes = 0
  }

  cpuTextureCacheStats() {
    return { entries: this.cpuTextureCache.size, bytes: this.cpuTextureCacheBytes, byteLimit: this.cpuTextureCacheByteLimit }
  }

  dispose() {
    this.clearCpuTextureCache()
  }

  resolveCanonicalFactory(definition, pass) {
    const key = `${definition.id}:${pass.program}`
    const factory = this.kernelFactories.get(key)
    if (typeof factory !== 'function') throw new Error(`Missing canonical CPU kernel "${key}" for pass "${pass.name}"`)
    return factory
  }

  passUniforms(pass, params, baseUniforms) {
    const uniforms = { ...baseUniforms }
    for (const [uniformName, source] of Object.entries(pass.uniforms ?? {})) {
      if (typeof source === 'string' && source in params) uniforms[uniformName] = params[source]
      else if (typeof source === 'string' && source in baseUniforms) uniforms[uniformName] = baseUniforms[source]
      else if (!(typeof source === 'string' && source === uniformName && uniformName in uniforms)) uniforms[uniformName] = source
    }
    return uniforms
  }

  canonicalDestination(definition, outputName, params, renderOptions) {
    const texture = definition.textures[outputName] ?? {}
    const ctx = { params, width: renderOptions.width, height: renderOptions.height }
    const width = textureDimension(texture.width, 'width', ctx)
    const height = textureDimension(texture.height, 'height', ctx)
    const surface = this.pool.acquire(width, height)
    surface.format = texture.format ?? 'rgba16f'
    return surface
  }

  canonicalTextures(definition, pass, resources) {
    const textures = {}
    for (const [uniformName, resourceName] of Object.entries(pass.inputs ?? {})) {
      let surface = resources.get(resourceName)
      // `selfTex`/`feedback` are reserved tokens (never a declared texture, never a pass
      // output) meaning "this same step's previous-iteration final outputTex". Outside an
      // iterated group (or on its first iteration) there is no prior output, so it resolves to
      // a permanently-zeroed placeholder — matching upstream's first-frame behavior. This is a
      // no-op for every one of the 167 pre-existing effects: none of them reference either name
      // (confirmed against the full snapshot), so this branch is structurally unreachable for
      // them and adds no allocation, no Map entry, and no extra pass to the fast path.
      if (!surface?.data && (resourceName === 'selfTex' || resourceName === 'feedback')) surface = this.emptySurface
      if (!surface?.data) throw new Error(`${definition.id} pass "${pass.name}" requires texture "${resourceName}"`)
      textures[uniformName] = surface
    }
    return textures
  }

  initializeCanonicalResources(definition, params, resources, renderOptions, owned) {
    const produced = new Set(definition.passes.flatMap((pass) => Object.values(pass.outputs ?? {})))
    for (const name of Object.keys(definition.textures)) {
      if (resources.has(name) || produced.has(name)) continue
      if (name === 'overlayTex' && ['filter/fibers', 'filter/scratches', 'filter/strayHair'].includes(definition.id)) {
        if (renderOptions.oneShot === 'initial') {
          const surface = this.canonicalDestination(definition, name, params, renderOptions)
          surface.clear()
          owned.add(surface)
          resources.set(name, surface)
          continue
        }
        const key = `${definition.id}:${renderOptions.width}x${renderOptions.height}:${params.seed}:${params.density}`
        let surface = this.cachedCpuTexture(key)
        if (!surface) {
          surface = renderCanonicalWormOverlay(definition.id, renderOptions.width, renderOptions.height, params)
          this.cacheCpuTexture(key, surface)
        }
        resources.set(name, surface)
        continue
      }
      const surface = this.canonicalDestination(definition, name, params, renderOptions)
      surface.clear()
      owned.add(surface)
      resources.set(name, surface)
    }
  }

  replaceCanonicalResource(name, destination, resources, surfaces, owned) {
    const previous = resources.get(name)
    resources.set(name, destination)
    if (previous && previous !== destination && owned.has(previous)) {
      let referenced = false
      for (const surface of resources.values()) if (surface === previous) referenced = true
      if (!referenced) this.releaseTransient(previous, surfaces, owned)
    }
  }

  // MRT (`drawBuffers >= 2`) pixel loop: runs `kernel` once per pixel with a single
  // `4 * destinations.length` scratch buffer (pooled for the whole pass run, not per pixel)
  // and scatters each 4-float chunk into the destination Surface at the same list index.
  runCanonicalMrtPass({ kernel, destinations, uniforms = {}, textures = {}, time = 0, seed = 1, tileRows = 32 }) {
    const start = performance.now()
    const width = destinations[0].width
    const height = destinations[0].height
    const inverseWidth = 1 / width
    const inverseHeight = 1 / height
    const uv = new Float32Array(2)
    const fragCoord = new Float32Array(2)
    const resolution = new Float32Array([width, height])
    const out = new Float32Array(4 * destinations.length)
    const context = { uv, fragCoord, resolution, time: Math.fround(time), seed: Math.fround(seed), uniforms, textures }
    let tiles = 0

    for (let yStart = 0; yStart < height; yStart += tileRows) {
      const yEnd = Math.min(yStart + tileRows, height)
      tiles += 1
      for (let y = yStart; y < yEnd; y += 1) {
        const fy = height - y - 0.5
        fragCoord[1] = fy
        uv[1] = fy * inverseHeight
        let destinationIndex = (y * width) * 4
        for (let x = 0; x < width; x += 1) {
          const fx = x + 0.5
          fragCoord[0] = fx
          uv[0] = fx * inverseWidth
          kernel(context, out)
          for (let chunk = 0; chunk < destinations.length; chunk += 1) {
            const data = destinations[chunk].data
            const base = chunk * 4
            data[destinationIndex] = out[base]
            data[destinationIndex + 1] = out[base + 1]
            data[destinationIndex + 2] = out[base + 2]
            data[destinationIndex + 3] = out[base + 3]
          }
          destinationIndex += 4
        }
      }
    }

    return { pixels: width * height, tiles, elapsedMs: performance.now() - start }
  }

  async runCanonicalMrtPassAsync({ kernel, destinations, uniforms = {}, textures = {}, time = 0, seed = 1, tileRows = 32, scheduler }) {
    const start = performance.now()
    const width = destinations[0].width
    const height = destinations[0].height
    const inverseWidth = 1 / width
    const inverseHeight = 1 / height
    const uv = new Float32Array(2)
    const fragCoord = new Float32Array(2)
    const resolution = new Float32Array([width, height])
    const out = new Float32Array(4 * destinations.length)
    const context = { uv, fragCoord, resolution, time: Math.fround(time), seed: Math.fround(seed), uniforms, textures }
    let tiles = 0

    for (let yStart = 0; yStart < height; yStart += tileRows) {
      const yEnd = Math.min(yStart + tileRows, height)
      tiles += 1
      for (let y = yStart; y < yEnd; y += 1) {
        const fy = height - y - 0.5
        fragCoord[1] = fy
        uv[1] = fy * inverseHeight
        let destinationIndex = (y * width) * 4
        for (let x = 0; x < width; x += 1) {
          const fx = x + 0.5
          fragCoord[0] = fx
          uv[0] = fx * inverseWidth
          kernel(context, out)
          for (let chunk = 0; chunk < destinations.length; chunk += 1) {
            const data = destinations[chunk].data
            const base = chunk * 4
            data[destinationIndex] = out[base]
            data[destinationIndex + 1] = out[base + 1]
            data[destinationIndex + 2] = out[base + 2]
            data[destinationIndex + 3] = out[base + 3]
          }
          destinationIndex += 4
        }
      }
      await scheduler()
    }

    return { pixels: width * height, tiles, elapsedMs: performance.now() - start }
  }

  // Allocates one destination per MRT output name (location-ascending, per `factory.outputNames`).
  // Each destination is independently formatted (quantized on its own after the pass runs), but
  // all of one MRT pass's destinations are written by a single shared pixel loop (one `uv`/
  // `fragCoord`/`resolution`, one scatter stride derived from destination 0 — see
  // `runCanonicalMrtPass`/`Async`), so they MUST share identical width/height. Enforced here with
  // a descriptive throw naming every output's resolved size, rather than letting a mismatched
  // record silently scramble whichever destination is smaller. Shared by the sync/async pass loops.
  canonicalMrtDestinations(definition, pass, factory, params, renderOptions, owned) {
    const destinations = factory.outputNames.map((outputVariable) => {
      const destinationName = pass.outputs?.[outputVariable]
      if (!destinationName) {
        throw new Error(`${definition.id} pass "${pass.name}" has no destination for output "${outputVariable}"`)
      }
      const surface = this.canonicalDestination(definition, destinationName, params, renderOptions)
      owned.add(surface)
      return { name: destinationName, surface }
    })
    assertMrtDestinationsShareDimensions(definition.id, pass.name, destinations)
    return destinations
  }

  // ---------------------------------------------------------------------------------------
  // Iteration groups
  //
  // `computeIterationGroups` (src/runtime/iteration.js) partitions one chain's steps into
  // groups; `render`/`renderAsync` run each group through `runIterationGroupSync`/`Async`
  // below. A non-iterated group (`group.iterated === false`, always exactly one step — see
  // `iteration.js`) takes the IDENTICAL path every step always took: a single call
  // to `runEffectSync`/`Async`, no schedule, no persistent per-iteration bookkeeping — this is
  // the zero-overhead fast path required for the 167 pre-existing effects.
  //
  // An iterated group (`group.iterated === true`) runs its ENTIRE pass graph — every step, in
  // order — `N` times in place, where `N` is the group's first step's normalized
  // `params.iterationCount` (defaulting to 60 only as a defensive fallback; every real iterated
  // record's `iterationCount` param always carries an explicit default). Per Global Constraints:
  // iteration `i` of `N` binds `frame = i`, `deltaTime = 1/600`,
  // `time = wrap01(T - (N-1-i)/600)` where `T` is the render-level `time` option.
  // ---------------------------------------------------------------------------------------

  runIterationGroupSync(group, groupInput, surfaces, owned, renderOptions, stats) {
    if (!group.iterated) {
      let current = groupInput
      for (const step of group.steps) current = this.runEffectSync(step, current, surfaces, owned, renderOptions, stats)
      return current
    }
    return this.runIteratedGroupSync(group, groupInput, surfaces, owned, renderOptions, stats)
  }

  async runIterationGroupAsync(group, groupInput, surfaces, owned, renderOptions, stats, scheduler) {
    if (!group.iterated) {
      let current = groupInput
      for (const step of group.steps) current = await this.runEffectAsync(step, current, surfaces, owned, renderOptions, stats, scheduler)
      return current
    }
    return this.runIteratedGroupAsync(group, groupInput, surfaces, owned, renderOptions, stats, scheduler)
  }

  // `iterationCount: 0` → group output is a clone of the group's input surface, or (when the
  // group starts the chain, i.e. has no input — a `kind: 'generator'` owning step) a zeroed
  // screen-sized surface. No pass runs; nothing is mutated. Shared by sync/async (no pixel loop).
  zeroIterationGroupOutput(groupInput, renderOptions, owned) {
    if (groupInput) {
      const surface = this.pool.acquire(groupInput.width, groupInput.height)
      surface.format = groupInput.format
      surface.data.set(groupInput.data)
      owned.add(surface)
      return surface
    }
    const surface = this.pool.acquire(renderOptions.width, renderOptions.height)
    surface.format = 'rgba16f'
    surface.clear()
    owned.add(surface)
    return surface
  }

  // One-time (per group run) per-step setup: normalized params — with the seed default applied
  // (same as the non-iterated path) and, for a step that JOINED a group owner (`ownerStateSize`
  // passed by the caller, `undefined` for the owner itself and for ungrouped/single-step groups),
  // its own `stateSize` forcibly overridden to the owner's normalized value whenever this step
  // declares a `stateSize` param at all.
  //
  // This mirrors upstream exactly: a joining points effect's own `stateSize` control is marked
  // `control:false` there (hidden — only the emitter's is a real, user-facing control), so
  // unconditional inheritance (no explicit-vs-default argument tracking) is the faithful
  // behavior, not a simplification. It has to apply here, before `params` is finalized, because
  // `params.stateSize` feeds BOTH this step's own uniform binding (`buildBindings`, via each
  // param's `uniform:` key — so a joining step's kernel-side agent-indexing math agrees with
  // whatever size its texture actually resolved to) AND — via the returned `params` object, read
  // back out by `groupTextureSpec` below — the size of any group-scoped texture this step itself
  // declares (e.g. `points/life`'s `global_life_data`). A size-only fix (patching
  // `groupTextureSpec` alone) would leave those two silently disagreeing behind a now-passing
  // dimension check.
  //
  // Also builds, if this step's pass graph ever reads the reserved `selfTex`/`feedback` token, a
  // dedicated persistent surface seeded to zero. That surface is never itself stored under its
  // pass-output name in `resources` (so it can never be recycled/released mid-run by
  // `replaceCanonicalResource`) — its contents are copied (memcpy, not reference swap) from each
  // iteration's real result at the end of that iteration, so a later pass within the SAME
  // iteration that also reads selfTex can never observe a pool-recycled buffer.
  initializeGroupStepState(step, ownerStateSize, renderOptions, owned) {
    const definition = step.definition
    const inheritsStateSize = ownerStateSize !== undefined && Object.hasOwn(step.params, 'stateSize')
    const sourceStep = inheritsStateSize ? { params: { ...step.params, stateSize: ownerStateSize }, explicitParams: step.explicitParams } : step
    const params = this.effectParams(sourceStep, renderOptions)
    const usesSelfTex = (definition.passes ?? []).some((pass) =>
      Object.values(pass.inputs ?? {}).some((value) => value === 'selfTex' || value === 'feedback'))
    const resources = new Map()
    let selfTexSurface = null
    if (usesSelfTex) {
      selfTexSurface = this.canonicalDestination(definition, 'outputTex', params, renderOptions)
      selfTexSurface.clear()
      owned.add(selfTexSurface)
      resources.set('selfTex', selfTexSurface)
      resources.set('feedback', selfTexSurface)
    }
    return { step, definition, params, resources, selfTexSurface }
  }

  // Resolves the `{definition, params}` pair whose OWN `textures[name]` spec (and own, already
  // stateSize-inherited — see `initializeGroupStepState` — params) should size a group-scoped
  // particle-state texture: the first step (by its precomputed `stepStates` entry, in group
  // order) that declares it (e.g. `render/pointsEmit` for `global_xyz`/`global_vel`/
  // `global_rgba`, `points/life` for `global_life_data`, `render/pointsRender` for
  // `global_points_trail`), or — when nobody in the group declares it (a `points/*`/
  // `render/points*` effect used without an emitter) — a synthetic `{param:'stateSize',
  // default:256}` spec resolved against the REFERENCING step's own (also inherited) params.
  // Never the screen-size fallback.
  groupTextureSpec(name, stepStates, referencingState) {
    for (const candidateState of stepStates) {
      if (Object.prototype.hasOwnProperty.call(candidateState.definition.textures ?? {}, name)) {
        return { definition: candidateState.definition, params: candidateState.params }
      }
    }
    const fallbackDefinition = {
      textures: {
        [name]: {
          width: { param: 'stateSize', default: PARTICLE_STATE_FALLBACK_SIZE },
          height: { param: 'stateSize', default: PARTICLE_STATE_FALLBACK_SIZE },
          format: particleStateFallbackFormat(name),
        },
      },
    }
    return { definition: fallbackDefinition, params: referencingState.params }
  }

  // Lazily creates (zeroed, on first reference) a group-scoped `global_*` particle-state
  // texture. `groupResources` is shared by every step in the group and lives for the whole
  // group run (across all `N` iterations) — this is the mechanism that lets a particle chain
  // segment interleave respawn/move/deposit every tick instead of running each step to
  // completion in isolation.
  resolveGroupParticleTexture(name, stepStates, referencingState, groupResources, renderOptions, owned) {
    let surface = groupResources.get(name)
    if (surface) return surface
    const { definition, params } = this.groupTextureSpec(name, stepStates, referencingState)
    surface = this.canonicalDestination(definition, name, params, renderOptions)
    surface.clear()
    owned.add(surface)
    groupResources.set(name, surface)
    return surface
  }

  // Per-pass input resolution for the iterated-group pass loop: particle-state names route
  // through the shared `groupResources`; everything else (inputTex, `_`-prefixed/named scratch,
  // surface params, and the pre-seeded selfTex/feedback placeholder) comes from the step's own
  // persistent `state.resources`, exactly like the non-iterated path's `canonicalTextures`.
  groupInputTextures(definition, pass, state, stepStates, groupResources, renderOptions, owned) {
    const textures = {}
    for (const [uniformName, resourceName] of Object.entries(pass.inputs ?? {})) {
      if (isParticleStateName(resourceName)) {
        textures[uniformName] = this.resolveGroupParticleTexture(resourceName, stepStates, state, groupResources, renderOptions, owned)
        continue
      }
      let surface = state.resources.get(resourceName)
      if (!surface?.data && (resourceName === 'selfTex' || resourceName === 'feedback')) surface = this.emptySurface
      if (!surface?.data) throw new Error(`${definition.id} pass "${pass.name}" requires texture "${resourceName}"`)
      textures[uniformName] = surface
    }
    return textures
  }

  // Allocates a fresh destination for a pass output name: particle-state names are sized via
  // `groupTextureSpec`; everything else via the step's own declared texture spec, exactly like
  // the non-iterated path's `canonicalDestination`. Always a brand-new pool surface (never
  // reused in place) — the old value under this name is released by `storeGroupOutput` below,
  // same lifecycle as every other canonical pass output.
  groupOutputDestination(name, state, stepStates, renderOptions, owned) {
    if (isParticleStateName(name)) {
      const { definition, params } = this.groupTextureSpec(name, stepStates, state)
      const surface = this.canonicalDestination(definition, name, params, renderOptions)
      owned.add(surface)
      return surface
    }
    const surface = this.canonicalDestination(state.definition, name, state.params, renderOptions)
    owned.add(surface)
    return surface
  }

  storeGroupOutput(name, surface, state, groupResources, surfaces, owned) {
    if (isParticleStateName(name)) this.replaceCanonicalResource(name, surface, groupResources, surfaces, owned)
    else this.replaceCanonicalResource(name, surface, state.resources, surfaces, owned)
  }

  // Zero-fills (once; a harmless no-op every iteration after) every texture this step declares
  // that isn't a particle-state name and isn't already present in `resources` — dropping the
  // non-iterated path's "skip if some pass produces it" optimization, because that optimization
  // is unsafe for a self-referencing state texture (e.g. `synth/cellularAutomata`'s `update`
  // pass both reads AND writes `global_ca_state` in the same pass: on iteration 0 it must exist,
  // zeroed, before that first read). Ambiguity resolution: "create once, zero-filled, at
  // iteration 0" — satisfied whether the zero-fill happens once at setup or, as here, every
  // iteration (idempotent after the first, since `resources.has(name)` is then always true).
  ensureGroupScratchResources(definition, params, resources, renderOptions, owned) {
    for (const name of Object.keys(definition.textures ?? {})) {
      if (isParticleStateName(name) || resources.has(name)) continue
      const surface = this.canonicalDestination(definition, name, params, renderOptions)
      surface.clear()
      owned.add(surface)
      resources.set(name, surface)
    }
  }

  groupMrtDestinations(definition, pass, factory, state, stepStates, renderOptions, owned) {
    const destinations = factory.outputNames.map((outputVariable) => {
      const destinationName = pass.outputs?.[outputVariable]
      if (!destinationName) throw new Error(`${definition.id} pass "${pass.name}" has no destination for output "${outputVariable}"`)
      return { name: destinationName, surface: this.groupOutputDestination(destinationName, state, stepStates, renderOptions, owned) }
    })
    assertMrtDestinationsShareDimensions(definition.id, pass.name, destinations)
    return destinations
  }

  // Lightweight scalar context for hand-written scatter adapters (see scatter-registry.js) —
  // deliberately NOT the full `createCanonicalBindings` shape, which carries a lot of
  // GLSL-kernel-only scaffolding (renderScale/motion/tileOffset/...) an adapter has no use for.
  buildScatterBindings(destination, renderOptions) {
    return {
      time: Math.fround(renderOptions.time),
      frame: renderOptions.frame,
      deltaTime: renderOptions.deltaTime ?? 0,
      seed: Math.fround(renderOptions.seed),
      width: destination.width,
      height: destination.height,
      resolution: [destination.width, destination.height],
      fullResolution: [renderOptions.width, renderOptions.height],
    }
  }

  // Releases every surface owned by the group's per-step resource maps and its shared
  // `groupResources`, except the surface being returned as the group's final output. Mirrors
  // the non-iterated path's own end-of-invocation cleanup loop, just applied across every step's
  // map (plus `groupResources`) instead of one. `groupResources` is ALWAYS fully released here
  // (never retained past one render() call) — particle state never survives beyond the group run
  // that owns it, matching the determinism/statelessness constraint.
  finishGroupResources(stepStates, groupResources, result, surfaces, owned) {
    for (const state of stepStates) {
      for (const resource of new Set(state.resources.values())) {
        if (resource !== result) this.releaseTransient(resource, surfaces, owned)
      }
    }
    for (const resource of new Set(groupResources.values())) {
      if (resource !== result) this.releaseTransient(resource, surfaces, owned)
    }
  }

  runIteratedGroupSync(group, groupInput, surfaces, owned, renderOptions, stats) {
    const iterationCount = group.steps[0].params.iterationCount
    const N = Number.isFinite(iterationCount) ? iterationCount : 60
    if (!(N > 0)) return this.zeroIterationGroupOutput(groupInput, renderOptions, owned)

    const groupResources = new Map()
    const ownerStateSize = groupOwnerStateSize(group)
    const stepStates = group.steps.map((step, index) =>
      this.initializeGroupStepState(step, index === 0 ? undefined : ownerStateSize, renderOptions, owned))

    let lastGroupOutput = null
    for (let i = 0; i < N; i += 1) {
      const iterationOptions = {
        ...renderOptions,
        frame: i,
        deltaTime: ITERATION_DELTA_TIME,
        time: wrap01(renderOptions.time - (N - 1 - i) * ITERATION_DELTA_TIME),
      }
      let stepInput = groupInput
      for (const state of stepStates) {
        stepInput = this.runGroupStepIterationSync(state, stepInput, stepStates, groupResources, surfaces, owned, iterationOptions, stats)
      }
      lastGroupOutput = stepInput
    }

    this.finishGroupResources(stepStates, groupResources, lastGroupOutput, surfaces, owned)
    if (groupInput && groupInput !== lastGroupOutput) this.releaseTransient(groupInput, surfaces, owned)
    return lastGroupOutput
  }

  async runIteratedGroupAsync(group, groupInput, surfaces, owned, renderOptions, stats, scheduler) {
    const iterationCount = group.steps[0].params.iterationCount
    const N = Number.isFinite(iterationCount) ? iterationCount : 60
    if (!(N > 0)) return this.zeroIterationGroupOutput(groupInput, renderOptions, owned)

    const groupResources = new Map()
    const ownerStateSize = groupOwnerStateSize(group)
    const stepStates = group.steps.map((step, index) =>
      this.initializeGroupStepState(step, index === 0 ? undefined : ownerStateSize, renderOptions, owned))

    let lastGroupOutput = null
    for (let i = 0; i < N; i += 1) {
      const iterationOptions = {
        ...renderOptions,
        frame: i,
        deltaTime: ITERATION_DELTA_TIME,
        time: wrap01(renderOptions.time - (N - 1 - i) * ITERATION_DELTA_TIME),
      }
      let stepInput = groupInput
      for (const state of stepStates) {
        stepInput = await this.runGroupStepIterationAsync(state, stepInput, stepStates, groupResources, surfaces, owned, iterationOptions, stats, scheduler)
      }
      lastGroupOutput = stepInput
    }

    this.finishGroupResources(stepStates, groupResources, lastGroupOutput, surfaces, owned)
    if (groupInput && groupInput !== lastGroupOutput) this.releaseTransient(groupInput, surfaces, owned)
    return lastGroupOutput
  }

  // Runs one step's full pass graph for a single iteration, reusing `state.resources` across
  // calls (never recreated) so `_`-prefixed/named scratch persists across iterations, and
  // routing particle-state names through the group-shared `groupResources`. Structurally mirrors
  // `runCanonicalEffectSync` (same three pass shapes: scatter/MRT/single-output); the divergences
  // are exactly the persistent-resources, group-routing, and selfTex bookkeeping described above.
  runGroupStepIterationSync(state, iterationInput, stepStates, groupResources, surfaces, owned, iterationOptions, stats) {
    const definition = state.definition
    const bindings = this.buildBindings(definition, state.params, state.step.explicitParams, iterationInput, surfaces, iterationOptions)
    for (const [name, surface] of Object.entries(bindings.textures)) state.resources.set(name, surface)
    this.ensureGroupScratchResources(definition, state.params, state.resources, iterationOptions, owned)
    let lastOutput = null

    for (const pass of definition.passes) {
      if (!passIsActive(pass, bindings.uniforms)) continue
      const repeat = resolveRepeatCount(pass, bindings.uniforms)
      if (!(repeat > 0)) continue

      if (pass.drawMode === 'points' || pass.drawMode === 'billboards') {
        const outputName = Object.values(pass.outputs ?? {})[0]
        if (!outputName) throw new Error(`${definition.id} pass "${pass.name}" has no fragment output`)
        const scatterKey = `${definition.id}:${pass.program}`
        const adapter = resolveScatterAdapter(scatterKey)
        if (typeof adapter !== 'function') throw new Error(`Missing CPU scatter adapter "${scatterKey}"`)
        for (let iteration = 0; iteration < repeat; iteration += 1) {
          const destination = this.groupOutputDestination(outputName, state, stepStates, iterationOptions, owned)
          const inputs = this.groupInputTextures(definition, pass, state, stepStates, groupResources, iterationOptions, owned)
          const previous = isParticleStateName(outputName) ? groupResources.get(outputName) : state.resources.get(outputName)
          if (previous?.data && previous.data.length === destination.data.length) destination.data.set(previous.data)
          else destination.clear()
          const passUniformValues = this.passUniforms(pass, state.params, bindings.uniforms)
          const scatterBindings = this.buildScatterBindings(destination, iterationOptions)
          const passStats = adapter({ pass, uniforms: passUniformValues, bindings: scatterBindings, inputs, destination, params: state.params })
          quantizeTexture(destination, destination.format)
          stats.passes += 1
          stats.pixels += passStats.pixels
          this.storeGroupOutput(outputName, destination, state, groupResources, surfaces, owned)
          lastOutput = destination
        }
        continue
      }

      const factory = this.resolveCanonicalFactory(definition, pass)
      if (pass.drawBuffers >= 2 && Array.isArray(factory.outputNames)) {
        for (let iteration = 0; iteration < repeat; iteration += 1) {
          const inputs = this.groupInputTextures(definition, pass, state, stepStates, groupResources, iterationOptions, owned)
          const passUniformValues = this.passUniforms(pass, state.params, bindings.uniforms)
          const destinations = this.groupMrtDestinations(definition, pass, factory, state, stepStates, iterationOptions, owned)
          const surfaceList = destinations.map((entry) => entry.surface)
          const kernel = bindCanonicalKernel(factory, {
            width: surfaceList[0].width,
            height: surfaceList[0].height,
            time: iterationOptions.time,
            frame: iterationOptions.frame,
            deltaTime: iterationOptions.deltaTime,
            seed: iterationOptions.seed,
            uniforms: passUniformValues,
            textures: inputs,
            fullResolution: new Float32Array([iterationOptions.width, iterationOptions.height]),
          })
          const passStats = this.runCanonicalMrtPass({
            kernel,
            destinations: surfaceList,
            uniforms: passUniformValues,
            textures: inputs,
            time: iterationOptions.time,
            seed: iterationOptions.seed,
            tileRows: this.tileRows,
          })
          for (const { name, surface } of destinations) {
            quantizeTexture(surface, surface.format)
            this.storeGroupOutput(name, surface, state, groupResources, surfaces, owned)
          }
          stats.passes += 1
          stats.pixels += passStats.pixels
          lastOutput = surfaceList[surfaceList.length - 1]
        }
        continue
      }

      const outputName = Object.values(pass.outputs ?? {})[0]
      if (!outputName) throw new Error(`${definition.id} pass "${pass.name}" has no fragment output`)
      for (let iteration = 0; iteration < repeat; iteration += 1) {
        const destination = this.groupOutputDestination(outputName, state, stepStates, iterationOptions, owned)
        const inputs = this.groupInputTextures(definition, pass, state, stepStates, groupResources, iterationOptions, owned)
        const kernel = bindCanonicalKernel(factory, {
          width: destination.width,
          height: destination.height,
          time: iterationOptions.time,
          frame: iterationOptions.frame,
          deltaTime: iterationOptions.deltaTime,
          seed: iterationOptions.seed,
          uniforms: this.passUniforms(pass, state.params, bindings.uniforms),
          textures: inputs,
          fullResolution: new Float32Array([iterationOptions.width, iterationOptions.height]),
        })
        const passStats = runPass({ kernel, destination, time: iterationOptions.time, seed: iterationOptions.seed, tileRows: this.tileRows })
        quantizeTexture(destination, destination.format)
        stats.passes += 1
        stats.pixels += passStats.pixels
        this.storeGroupOutput(outputName, destination, state, groupResources, surfaces, owned)
        lastOutput = destination
      }
    }

    const result = state.resources.get('outputTex') ?? lastOutput
    if (!result) throw new Error(`${definition.id} did not produce outputTex`)
    if (state.selfTexSurface) {
      assertSelfTexMatchesOutput(definition.id, result, state.selfTexSurface)
      state.selfTexSurface.data.set(result.data)
    }
    return result
  }

  async runGroupStepIterationAsync(state, iterationInput, stepStates, groupResources, surfaces, owned, iterationOptions, stats, scheduler) {
    const definition = state.definition
    const bindings = this.buildBindings(definition, state.params, state.step.explicitParams, iterationInput, surfaces, iterationOptions)
    for (const [name, surface] of Object.entries(bindings.textures)) state.resources.set(name, surface)
    this.ensureGroupScratchResources(definition, state.params, state.resources, iterationOptions, owned)
    let lastOutput = null

    for (const pass of definition.passes) {
      if (!passIsActive(pass, bindings.uniforms)) continue
      const repeat = resolveRepeatCount(pass, bindings.uniforms)
      if (!(repeat > 0)) continue

      if (pass.drawMode === 'points' || pass.drawMode === 'billboards') {
        const outputName = Object.values(pass.outputs ?? {})[0]
        if (!outputName) throw new Error(`${definition.id} pass "${pass.name}" has no fragment output`)
        const scatterKey = `${definition.id}:${pass.program}`
        const adapter = resolveScatterAdapter(scatterKey)
        if (typeof adapter !== 'function') throw new Error(`Missing CPU scatter adapter "${scatterKey}"`)
        for (let iteration = 0; iteration < repeat; iteration += 1) {
          const destination = this.groupOutputDestination(outputName, state, stepStates, iterationOptions, owned)
          const inputs = this.groupInputTextures(definition, pass, state, stepStates, groupResources, iterationOptions, owned)
          const previous = isParticleStateName(outputName) ? groupResources.get(outputName) : state.resources.get(outputName)
          if (previous?.data && previous.data.length === destination.data.length) destination.data.set(previous.data)
          else destination.clear()
          const passUniformValues = this.passUniforms(pass, state.params, bindings.uniforms)
          const scatterBindings = this.buildScatterBindings(destination, iterationOptions)
          const passStats = adapter({ pass, uniforms: passUniformValues, bindings: scatterBindings, inputs, destination, params: state.params })
          quantizeTexture(destination, destination.format)
          stats.passes += 1
          stats.pixels += passStats.pixels
          this.storeGroupOutput(outputName, destination, state, groupResources, surfaces, owned)
          lastOutput = destination
        }
        continue
      }

      const factory = this.resolveCanonicalFactory(definition, pass)
      if (pass.drawBuffers >= 2 && Array.isArray(factory.outputNames)) {
        for (let iteration = 0; iteration < repeat; iteration += 1) {
          const inputs = this.groupInputTextures(definition, pass, state, stepStates, groupResources, iterationOptions, owned)
          const passUniformValues = this.passUniforms(pass, state.params, bindings.uniforms)
          const destinations = this.groupMrtDestinations(definition, pass, factory, state, stepStates, iterationOptions, owned)
          const surfaceList = destinations.map((entry) => entry.surface)
          const kernel = bindCanonicalKernel(factory, {
            width: surfaceList[0].width,
            height: surfaceList[0].height,
            time: iterationOptions.time,
            frame: iterationOptions.frame,
            deltaTime: iterationOptions.deltaTime,
            seed: iterationOptions.seed,
            uniforms: passUniformValues,
            textures: inputs,
            fullResolution: new Float32Array([iterationOptions.width, iterationOptions.height]),
          })
          const passStats = await this.runCanonicalMrtPassAsync({
            kernel,
            destinations: surfaceList,
            uniforms: passUniformValues,
            textures: inputs,
            time: iterationOptions.time,
            seed: iterationOptions.seed,
            tileRows: this.tileRows,
            scheduler,
          })
          for (const { name, surface } of destinations) {
            quantizeTexture(surface, surface.format)
            this.storeGroupOutput(name, surface, state, groupResources, surfaces, owned)
          }
          stats.passes += 1
          stats.pixels += passStats.pixels
          lastOutput = surfaceList[surfaceList.length - 1]
        }
        continue
      }

      const outputName = Object.values(pass.outputs ?? {})[0]
      if (!outputName) throw new Error(`${definition.id} pass "${pass.name}" has no fragment output`)
      for (let iteration = 0; iteration < repeat; iteration += 1) {
        const destination = this.groupOutputDestination(outputName, state, stepStates, iterationOptions, owned)
        const inputs = this.groupInputTextures(definition, pass, state, stepStates, groupResources, iterationOptions, owned)
        const kernel = bindCanonicalKernel(factory, {
          width: destination.width,
          height: destination.height,
          time: iterationOptions.time,
          frame: iterationOptions.frame,
          deltaTime: iterationOptions.deltaTime,
          seed: iterationOptions.seed,
          uniforms: this.passUniforms(pass, state.params, bindings.uniforms),
          textures: inputs,
          fullResolution: new Float32Array([iterationOptions.width, iterationOptions.height]),
        })
        const passStats = await runPassAsync({ kernel, destination, time: iterationOptions.time, seed: iterationOptions.seed, tileRows: this.tileRows, scheduler })
        quantizeTexture(destination, destination.format)
        stats.passes += 1
        stats.pixels += passStats.pixels
        this.storeGroupOutput(outputName, destination, state, groupResources, surfaces, owned)
        lastOutput = destination
      }
    }

    const result = state.resources.get('outputTex') ?? lastOutput
    if (!result) throw new Error(`${definition.id} did not produce outputTex`)
    if (state.selfTexSurface) {
      assertSelfTexMatchesOutput(definition.id, result, state.selfTexSurface)
      state.selfTexSurface.data.set(result.data)
    }
    return result
  }

  runCanonicalEffectSync(step, current, surfaces, owned, renderOptions, stats) {
    const params = this.effectParams(step, renderOptions)
    const bindings = this.buildBindings(step.definition, params, step.explicitParams, current, surfaces, renderOptions)
    const resources = new Map(Object.entries(bindings.textures))
    if (current) resources.set('inputTex', current)
    this.initializeCanonicalResources(step.definition, params, resources, renderOptions, owned)
    let lastOutput = null

    for (const pass of step.definition.passes) {
      if (!passIsActive(pass, bindings.uniforms)) continue
      const repeat = resolveRepeatCount(pass, bindings.uniforms)
      if (!(repeat > 0)) continue

      if (pass.drawMode === 'points' || pass.drawMode === 'billboards') {
        const outputName = Object.values(pass.outputs ?? {})[0]
        if (!outputName) throw new Error(`${step.definition.id} pass "${pass.name}" has no fragment output`)
        const scatterKey = `${step.definition.id}:${pass.program}`
        const adapter = resolveScatterAdapter(scatterKey)
        if (typeof adapter !== 'function') throw new Error(`Missing CPU scatter adapter "${scatterKey}"`)
        for (let iteration = 0; iteration < repeat; iteration += 1) {
          const destination = this.canonicalDestination(step.definition, outputName, params, renderOptions)
          owned.add(destination)
          const textures = this.canonicalTextures(step.definition, pass, resources)
          const previous = resources.get(outputName)
          if (previous?.data && previous.data.length === destination.data.length) destination.data.set(previous.data)
          else destination.clear()
          const passUniformValues = this.passUniforms(pass, params, bindings.uniforms)
          const scatterBindings = this.buildScatterBindings(destination, renderOptions)
          const passStats = adapter({ pass, uniforms: passUniformValues, bindings: scatterBindings, inputs: textures, destination, params })
          quantizeTexture(destination, destination.format)
          stats.passes += 1
          stats.pixels += passStats.pixels
          this.replaceCanonicalResource(outputName, destination, resources, surfaces, owned)
          lastOutput = destination
        }
        continue
      }

      const factory = this.resolveCanonicalFactory(step.definition, pass)
      if (pass.drawBuffers >= 2 && Array.isArray(factory.outputNames)) {
        for (let iteration = 0; iteration < repeat; iteration += 1) {
          const textures = this.canonicalTextures(step.definition, pass, resources)
          const passUniformValues = this.passUniforms(pass, params, bindings.uniforms)
          const destinations = this.canonicalMrtDestinations(step.definition, pass, factory, params, renderOptions, owned)
          const surfaceList = destinations.map((entry) => entry.surface)
          const kernel = bindCanonicalKernel(factory, {
            width: surfaceList[0].width,
            height: surfaceList[0].height,
            time: renderOptions.time,
            frame: renderOptions.frame,
            seed: renderOptions.seed,
            uniforms: passUniformValues,
            textures,
            fullResolution: new Float32Array([renderOptions.width, renderOptions.height]),
          })
          const passStats = this.runCanonicalMrtPass({
            kernel,
            destinations: surfaceList,
            uniforms: passUniformValues,
            textures,
            time: renderOptions.time,
            seed: renderOptions.seed,
            tileRows: this.tileRows,
          })
          for (const { name, surface } of destinations) {
            quantizeTexture(surface, surface.format)
            this.replaceCanonicalResource(name, surface, resources, surfaces, owned)
          }
          stats.passes += 1
          stats.pixels += passStats.pixels
          lastOutput = surfaceList[surfaceList.length - 1]
        }
        continue
      }

      const outputName = Object.values(pass.outputs ?? {})[0]
      if (!outputName) throw new Error(`${step.definition.id} pass "${pass.name}" has no fragment output`)
      for (let iteration = 0; iteration < repeat; iteration += 1) {
        const destination = this.canonicalDestination(step.definition, outputName, params, renderOptions)
        owned.add(destination)
        const textures = this.canonicalTextures(step.definition, pass, resources)
        const kernel = bindCanonicalKernel(factory, {
          width: destination.width,
          height: destination.height,
          time: renderOptions.time,
          frame: renderOptions.frame,
          seed: renderOptions.seed,
          uniforms: this.passUniforms(pass, params, bindings.uniforms),
          textures,
          fullResolution: new Float32Array([renderOptions.width, renderOptions.height]),
        })
        const passStats = runPass({ kernel, destination, time: renderOptions.time, seed: renderOptions.seed, tileRows: this.tileRows })
        quantizeTexture(destination, destination.format)
        stats.passes += 1
        stats.pixels += passStats.pixels
        this.replaceCanonicalResource(outputName, destination, resources, surfaces, owned)
        lastOutput = destination
      }
    }

    const result = resources.get('outputTex') ?? lastOutput
    if (!result) throw new Error(`${step.definition.id} did not produce outputTex`)
    for (const resource of new Set(resources.values())) {
      if (resource !== result && resource !== current) this.releaseTransient(resource, surfaces, owned)
    }
    if (current && current !== result) this.releaseTransient(current, surfaces, owned)
    return result
  }

  async runCanonicalEffectAsync(step, current, surfaces, owned, renderOptions, stats, scheduler) {
    const params = this.effectParams(step, renderOptions)
    const bindings = this.buildBindings(step.definition, params, step.explicitParams, current, surfaces, renderOptions)
    const resources = new Map(Object.entries(bindings.textures))
    if (current) resources.set('inputTex', current)
    this.initializeCanonicalResources(step.definition, params, resources, renderOptions, owned)
    let lastOutput = null

    for (const pass of step.definition.passes) {
      if (!passIsActive(pass, bindings.uniforms)) continue
      const repeat = resolveRepeatCount(pass, bindings.uniforms)
      if (!(repeat > 0)) continue

      if (pass.drawMode === 'points' || pass.drawMode === 'billboards') {
        const outputName = Object.values(pass.outputs ?? {})[0]
        if (!outputName) throw new Error(`${step.definition.id} pass "${pass.name}" has no fragment output`)
        const scatterKey = `${step.definition.id}:${pass.program}`
        const adapter = resolveScatterAdapter(scatterKey)
        if (typeof adapter !== 'function') throw new Error(`Missing CPU scatter adapter "${scatterKey}"`)
        for (let iteration = 0; iteration < repeat; iteration += 1) {
          const destination = this.canonicalDestination(step.definition, outputName, params, renderOptions)
          owned.add(destination)
          const textures = this.canonicalTextures(step.definition, pass, resources)
          const previous = resources.get(outputName)
          if (previous?.data && previous.data.length === destination.data.length) destination.data.set(previous.data)
          else destination.clear()
          const passUniformValues = this.passUniforms(pass, params, bindings.uniforms)
          const scatterBindings = this.buildScatterBindings(destination, renderOptions)
          const passStats = adapter({ pass, uniforms: passUniformValues, bindings: scatterBindings, inputs: textures, destination, params })
          quantizeTexture(destination, destination.format)
          stats.passes += 1
          stats.pixels += passStats.pixels
          this.replaceCanonicalResource(outputName, destination, resources, surfaces, owned)
          lastOutput = destination
        }
        continue
      }

      const factory = this.resolveCanonicalFactory(step.definition, pass)
      if (pass.drawBuffers >= 2 && Array.isArray(factory.outputNames)) {
        for (let iteration = 0; iteration < repeat; iteration += 1) {
          const textures = this.canonicalTextures(step.definition, pass, resources)
          const passUniformValues = this.passUniforms(pass, params, bindings.uniforms)
          const destinations = this.canonicalMrtDestinations(step.definition, pass, factory, params, renderOptions, owned)
          const surfaceList = destinations.map((entry) => entry.surface)
          const kernel = bindCanonicalKernel(factory, {
            width: surfaceList[0].width,
            height: surfaceList[0].height,
            time: renderOptions.time,
            frame: renderOptions.frame,
            seed: renderOptions.seed,
            uniforms: passUniformValues,
            textures,
            fullResolution: new Float32Array([renderOptions.width, renderOptions.height]),
          })
          const passStats = await this.runCanonicalMrtPassAsync({
            kernel,
            destinations: surfaceList,
            uniforms: passUniformValues,
            textures,
            time: renderOptions.time,
            seed: renderOptions.seed,
            tileRows: this.tileRows,
            scheduler,
          })
          for (const { name, surface } of destinations) {
            quantizeTexture(surface, surface.format)
            this.replaceCanonicalResource(name, surface, resources, surfaces, owned)
          }
          stats.passes += 1
          stats.pixels += passStats.pixels
          lastOutput = surfaceList[surfaceList.length - 1]
        }
        continue
      }

      const outputName = Object.values(pass.outputs ?? {})[0]
      if (!outputName) throw new Error(`${step.definition.id} pass "${pass.name}" has no fragment output`)
      for (let iteration = 0; iteration < repeat; iteration += 1) {
        const destination = this.canonicalDestination(step.definition, outputName, params, renderOptions)
        owned.add(destination)
        const textures = this.canonicalTextures(step.definition, pass, resources)
        const kernel = bindCanonicalKernel(factory, {
          width: destination.width,
          height: destination.height,
          time: renderOptions.time,
          frame: renderOptions.frame,
          seed: renderOptions.seed,
          uniforms: this.passUniforms(pass, params, bindings.uniforms),
          textures,
          fullResolution: new Float32Array([renderOptions.width, renderOptions.height]),
        })
        const passStats = await runPassAsync({ kernel, destination, time: renderOptions.time, seed: renderOptions.seed, tileRows: this.tileRows, scheduler })
        quantizeTexture(destination, destination.format)
        stats.passes += 1
        stats.pixels += passStats.pixels
        this.replaceCanonicalResource(outputName, destination, resources, surfaces, owned)
        lastOutput = destination
      }
    }

    const result = resources.get('outputTex') ?? lastOutput
    if (!result) throw new Error(`${step.definition.id} did not produce outputTex`)
    for (const resource of new Set(resources.values())) {
      if (resource !== result && resource !== current) this.releaseTransient(resource, surfaces, owned)
    }
    if (current && current !== result) this.releaseTransient(current, surfaces, owned)
    return result
  }

  isRetained(surface, surfaces) {
    for (const retained of surfaces.values()) if (retained === surface) return true
    return false
  }

  releaseTransient(surface, surfaces, owned) {
    if (!surface || !owned.has(surface) || this.isRetained(surface, surfaces)) return
    this.pool.release(surface)
    owned.delete(surface)
  }

  writeSurface(name, current, surfaces, owned) {
    const previous = surfaces.get(name)
    surfaces.set(name, current)
    if (previous && previous !== current && !this.isRetained(previous, surfaces) && owned.has(previous)) {
      this.pool.release(previous)
      owned.delete(previous)
    }
  }

  runEffectSync(step, current, surfaces, owned, renderOptions, stats) {
    if (step.definition.passes[0].program) return this.runCanonicalEffectSync(step, current, surfaces, owned, renderOptions, stats)
    const params = this.effectParams(step, renderOptions)
    const bindings = this.buildBindings(step.definition, params, step.explicitParams, current, surfaces, renderOptions)
    let passInput = current
    for (const pass of step.definition.passes) {
      const destination = this.pool.acquire(renderOptions.width, renderOptions.height)
      owned.add(destination)
      const textures = { ...bindings.textures }
      if (passInput) textures.inputTex = passInput
      for (const [textureName, source] of Object.entries(pass.inputs ?? {})) {
        if (source === 'input') textures[textureName] = passInput
        else if (params[source]?.kind === 'surface') textures[textureName] = surfaces.get(params[source].name)
      }
      const passStats = runPass({
        kernel: this.resolveKernel(pass.kernel),
        destination,
        uniforms: { ...bindings.uniforms, ...(pass.uniforms ?? {}) },
        textures,
        time: renderOptions.time,
        seed: renderOptions.seed,
        tileRows: this.tileRows,
      })
      stats.passes += 1
      stats.pixels += passStats.pixels
      if (passInput !== current) this.releaseTransient(passInput, surfaces, owned)
      passInput = destination
    }
    if (current && current !== passInput) this.releaseTransient(current, surfaces, owned)
    return passInput
  }

  async runEffectAsync(step, current, surfaces, owned, renderOptions, stats, scheduler) {
    if (step.definition.passes[0].program) return this.runCanonicalEffectAsync(step, current, surfaces, owned, renderOptions, stats, scheduler)
    const params = this.effectParams(step, renderOptions)
    const bindings = this.buildBindings(step.definition, params, step.explicitParams, current, surfaces, renderOptions)
    let passInput = current
    for (const pass of step.definition.passes) {
      const destination = this.pool.acquire(renderOptions.width, renderOptions.height)
      owned.add(destination)
      const textures = { ...bindings.textures }
      if (passInput) textures.inputTex = passInput
      for (const [textureName, source] of Object.entries(pass.inputs ?? {})) {
        if (source === 'input') textures[textureName] = passInput
        else if (params[source]?.kind === 'surface') textures[textureName] = surfaces.get(params[source].name)
      }
      const passStats = await runPassAsync({
        kernel: this.resolveKernel(pass.kernel),
        destination,
        uniforms: { ...bindings.uniforms, ...(pass.uniforms ?? {}) },
        textures,
        time: renderOptions.time,
        seed: renderOptions.seed,
        tileRows: this.tileRows,
        scheduler,
      })
      stats.passes += 1
      stats.pixels += passStats.pixels
      if (passInput !== current) this.releaseTransient(passInput, surfaces, owned)
      passInput = destination
    }
    if (current && current !== passInput) this.releaseTransient(current, surfaces, owned)
    return passInput
  }

  finish(plan, surfaces, owned, renderOptions, stats, startedAt) {
    const rendered = surfaces.get(plan.renderSurface)
    if (!rendered) throw new Error(`Surface ${plan.renderSurface} has not been written`)
    const resultSurface = rendered.clone()
    for (const surface of [...owned]) {
      this.pool.release(surface)
      owned.delete(surface)
    }
    stats.pool = this.pool.stats()
    return new RenderResult(resultSurface, {
      elapsedMs: performance.now() - startedAt,
      seed: renderOptions.seed,
      time: renderOptions.time,
      stats,
    })
  }

  cleanup(owned) {
    for (const surface of [...owned]) {
      if (this.pool.inUse.has(surface)) this.pool.release(surface)
      owned.delete(surface)
    }
  }

  render(source, options = {}) {
    const startedAt = performance.now()
    const renderOptions = assertRenderOptions(options)
    const plan = compileDsl(source, this.registry, options)
    const surfaces = new Map(renderOptions.seedSurfaces ? Object.entries(renderOptions.seedSurfaces) : [])
    const owned = new Set()
    const stats = { passes: 0, pixels: 0 }
    try {
      for (const chain of plan.chains) {
        let current = null
        for (const group of computeIterationGroups(chain.steps)) {
          const only = group.steps.length === 1 ? group.steps[0] : null
          if (only?.kind === 'read') {
            current = surfaces.get(only.surface)
            if (!current) throw new Error(`Surface ${only.surface} has not been written`)
          } else if (only?.kind === 'write') {
            this.writeSurface(only.surface, current, surfaces, owned)
          } else {
            current = this.runIterationGroupSync(group, current, surfaces, owned, renderOptions, stats)
          }
        }
      }
      return this.finish(plan, surfaces, owned, renderOptions, stats, startedAt)
    } finally {
      this.cleanup(owned)
    }
  }

  async renderAsync(source, options = {}) {
    const startedAt = performance.now()
    const renderOptions = assertRenderOptions(options)
    const plan = compileDsl(source, this.registry, options)
    const surfaces = new Map(renderOptions.seedSurfaces ? Object.entries(renderOptions.seedSurfaces) : [])
    const owned = new Set()
    const stats = { passes: 0, pixels: 0 }
    const scheduler = options.scheduler ?? (() => new Promise((resolve) => setTimeout(resolve, 0)))
    try {
      for (const chain of plan.chains) {
        let current = null
        for (const group of computeIterationGroups(chain.steps)) {
          const only = group.steps.length === 1 ? group.steps[0] : null
          if (only?.kind === 'read') {
            current = surfaces.get(only.surface)
            if (!current) throw new Error(`Surface ${only.surface} has not been written`)
          } else if (only?.kind === 'write') {
            this.writeSurface(only.surface, current, surfaces, owned)
          } else {
            current = await this.runIterationGroupAsync(group, current, surfaces, owned, renderOptions, stats, scheduler)
          }
        }
      }
      return this.finish(plan, surfaces, owned, renderOptions, stats, startedAt)
    } finally {
      this.cleanup(owned)
    }
  }
}
