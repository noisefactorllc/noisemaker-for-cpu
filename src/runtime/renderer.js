import { compileDsl } from '../dsl/compiler.js'
import { bindCanonicalKernel } from '../csl/glsl-kernel.js'
import { BufferPool } from './buffer-pool.js'
import { runPass, runPassAsync } from './pass-runner.js'
import { RenderResult } from './render-result.js'
import { Surface } from './surface.js'
import { quantizeTexture } from './texture-format.js'
import { renderCanonicalWormOverlay } from '../effects/cpu/worm-overlay.js'
import { runWormholeDeposit } from '../effects/cpu/wormhole.js'
import { paletteData } from '../effects/generated/canonical-adapter-data.js'

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
    seed,
    externalTextures: options.externalTextures ?? {},
    seedSurfaces: options.seedSurfaces ?? null,
    oneShot,
  }
}

function textureDimension(value, fallback) {
  if (value === undefined || value === 'input' || value === 'screen' || value === '100%') return fallback
  if (typeof value === 'number') return Math.max(1, Math.round(value))
  const percent = typeof value === 'string' ? value.match(/^(\d+(?:\.\d+)?)%$/) : null
  if (percent) return Math.max(1, Math.round(fallback * Number(percent[1]) / 100))
  throw new TypeError(`Unsupported canonical texture dimension ${JSON.stringify(value)}`)
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

  canonicalDestination(definition, outputName, renderOptions) {
    const texture = definition.textures[outputName] ?? {}
    const width = textureDimension(texture.width, renderOptions.width)
    const height = textureDimension(texture.height, renderOptions.height)
    const surface = this.pool.acquire(width, height)
    surface.format = texture.format ?? 'rgba16f'
    return surface
  }

  canonicalTextures(definition, pass, resources) {
    const textures = {}
    for (const [uniformName, resourceName] of Object.entries(pass.inputs ?? {})) {
      const surface = resources.get(resourceName)
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
          const surface = this.canonicalDestination(definition, name, renderOptions)
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
      const surface = this.canonicalDestination(definition, name, renderOptions)
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

  runCanonicalEffectSync(step, current, surfaces, owned, renderOptions, stats) {
    const params = this.effectParams(step, renderOptions)
    const bindings = this.buildBindings(step.definition, params, step.explicitParams, current, surfaces, renderOptions)
    const resources = new Map(Object.entries(bindings.textures))
    if (current) resources.set('inputTex', current)
    this.initializeCanonicalResources(step.definition, params, resources, renderOptions, owned)
    let lastOutput = null

    for (const pass of step.definition.passes) {
      const outputName = Object.values(pass.outputs ?? {})[0]
      if (!outputName) throw new Error(`${step.definition.id} pass "${pass.name}" has no fragment output`)
      const repeat = pass.repeat ?? 1
      for (let iteration = 0; iteration < repeat; iteration += 1) {
        const destination = this.canonicalDestination(step.definition, outputName, renderOptions)
        owned.add(destination)
        const textures = this.canonicalTextures(step.definition, pass, resources)
        if (pass.drawMode === 'points') {
          const previous = resources.get(outputName)
          if (previous?.data && previous.data.length === destination.data.length) destination.data.set(previous.data)
          else destination.clear()
          const passStats = runWormholeDeposit(textures.inputTex, destination, this.passUniforms(pass, params, bindings.uniforms))
          quantizeTexture(destination, destination.format)
          stats.passes += 1
          stats.pixels += passStats.pixels
          this.replaceCanonicalResource(outputName, destination, resources, surfaces, owned)
          lastOutput = destination
          continue
        }
        const kernel = bindCanonicalKernel(this.resolveCanonicalFactory(step.definition, pass), {
          width: destination.width,
          height: destination.height,
          time: renderOptions.time,
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
      const outputName = Object.values(pass.outputs ?? {})[0]
      if (!outputName) throw new Error(`${step.definition.id} pass "${pass.name}" has no fragment output`)
      const repeat = pass.repeat ?? 1
      for (let iteration = 0; iteration < repeat; iteration += 1) {
        const destination = this.canonicalDestination(step.definition, outputName, renderOptions)
        owned.add(destination)
        const textures = this.canonicalTextures(step.definition, pass, resources)
        if (pass.drawMode === 'points') {
          const previous = resources.get(outputName)
          if (previous?.data && previous.data.length === destination.data.length) destination.data.set(previous.data)
          else destination.clear()
          const passStats = runWormholeDeposit(textures.inputTex, destination, this.passUniforms(pass, params, bindings.uniforms))
          quantizeTexture(destination, destination.format)
          stats.passes += 1
          stats.pixels += passStats.pixels
          this.replaceCanonicalResource(outputName, destination, resources, surfaces, owned)
          lastOutput = destination
          continue
        }
        const kernel = bindCanonicalKernel(this.resolveCanonicalFactory(step.definition, pass), {
          width: destination.width,
          height: destination.height,
          time: renderOptions.time,
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
        for (const step of chain.steps) {
          if (step.kind === 'read') {
            current = surfaces.get(step.surface)
            if (!current) throw new Error(`Surface ${step.surface} has not been written`)
          } else if (step.kind === 'write') {
            this.writeSurface(step.surface, current, surfaces, owned)
          } else {
            current = this.runEffectSync(step, current, surfaces, owned, renderOptions, stats)
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
        for (const step of chain.steps) {
          if (step.kind === 'read') {
            current = surfaces.get(step.surface)
            if (!current) throw new Error(`Surface ${step.surface} has not been written`)
          } else if (step.kind === 'write') {
            this.writeSurface(step.surface, current, surfaces, owned)
          } else {
            current = await this.runEffectAsync(step, current, surfaces, owned, renderOptions, stats, scheduler)
          }
        }
      }
      return this.finish(plan, surfaces, owned, renderOptions, stats, startedAt)
    } finally {
      this.cleanup(owned)
    }
  }
}
