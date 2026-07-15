// The production path is generated JavaScript. This intentionally tiny oracle
// compiles without using the shared cache so tests can compare independent runs.
import { compileCsl, clearCslCache } from './compiler.js'

export function evaluateCsl(source, context, out = new Float32Array(4), options = {}) {
  clearCslCache()
  return compileCsl(source, options).runPixel(context, out)
}
