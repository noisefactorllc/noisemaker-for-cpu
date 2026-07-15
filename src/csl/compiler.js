import { parseCsl } from './parser.js'
import { checkCsl } from './types.js'
import { generateKernelSource } from './codegen.js'
import { cslRuntime } from './runtime.js'

const cache = new Map()
const EMPTY = Object.freeze({})
const MAX_LOOP_LIMIT = 10_000_000

function normalizeOptions(options) {
  const maxLoopIterations = options.maxLoopIterations ?? 4096
  if (!Number.isSafeInteger(maxLoopIterations) || maxLoopIterations <= 0 || maxLoopIterations > MAX_LOOP_LIMIT) {
    throw new RangeError(`maxLoopIterations must be a positive safe integer no greater than ${MAX_LOOP_LIMIT}`)
  }
  return { ...options, maxLoopIterations }
}

function cacheKey(source, options) {
  return `${options.sourceName ?? '<csl>'}\u0000${options.maxLoopIterations ?? 4096}\u0000${source}`
}

export function compileCsl(source, options = {}) {
  options = normalizeOptions(options)
  const key = cacheKey(source, options)
  const cached = cache.get(key)
  if (cached) return cached

  const ast = checkCsl(parseCsl(source, options))
  const generatedSource = generateKernelSource(ast, options)
  const factory = new Function('$runtime', '$empty', `"use strict"; return (${generatedSource});`)
  const runPixel = factory(cslRuntime, EMPTY)
  const uniforms = Object.freeze(ast.uniforms.map((uniform) => Object.freeze({ name: uniform.name, type: uniform.type })))
  const compiled = Object.freeze({ ast, uniforms, sourceName: options.sourceName ?? '<csl>', generatedSource, runPixel })
  cache.set(key, compiled)
  return compiled
}

export function clearCslCache() {
  cache.clear()
}

export class CslCompiler {
  constructor(options = {}) {
    this.options = Object.freeze({ ...options })
  }

  compile(source, options = {}) {
    return compileCsl(source, { ...this.options, ...options })
  }

  clearCache() {
    clearCslCache()
  }
}
