import { bindGlslKernel } from './glsl-runtime.js'

export const GLSL_STDLIB_NAMES = Object.freeze([
  'bool', 'int', 'uint', 'float', 'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4',
  'radians', 'degrees', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'pow', 'exp', 'log', 'log2', 'exp2', 'sqrt', 'inversesqrt', 'abs',
  'sign', 'floor', 'ceil', 'round', 'fract', 'tanh', 'isnan', 'mod', 'min', 'max',
  'clamp', 'mix', 'step', 'smoothstep', 'length', 'distance', 'dot', 'cross',
  'normalize', 'reflect', 'refract', 'lessThan', 'lessThanEqual',
  'greaterThan', 'greaterThanEqual', 'equal', 'notEqual', 'any', 'all',
  'add', 'subtract', 'multiply', 'divide', 'matrixMult', 'texture',
  'textureLod', 'textureSize', 'texelFetch', 'dFdx', 'dFdy', 'fwidth',
  'floatBitsToUint', 'uintBitsToFloat', 'packHalf2x16', 'unpackHalf2x16',
])

function f32(value) {
  return Math.fround(value)
}

export function createCanonicalBindings(options) {
  const {
    width,
    height,
    time = 0,
    frame = 0,
    deltaTime = 0,
    seed = 1,
    uniforms = {},
    textures = {},
    tileOffset = null,
    fullResolution = null,
  } = options
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError('canonical GLSL bindings require positive integer width and height')
  }

  const resolution = new Float32Array([width, height])
  const completeResolution = fullResolution ?? resolution
  // Upstream's Pipeline computes these scalar reciprocals on the CPU and
  // uploads them as uniforms instead of dividing in-shader (relaxed-math
  // backends lower a division to an approximate reciprocal multiply). The
  // transpiled kernels read them as plain bindings, so build them the same
  // way: tiling uses the full image's aspect and dimensions, otherwise the
  // render's own.
  const aspectValue = completeResolution[0] / completeResolution[1]
  return Object.freeze({
    renderScale: 1,
    speed: 0,
    seed: f32(seed),
    centerLoX: 0,
    centerLoY: 0,
    // Unbound GLSL uniforms are zero-initialized by WebGL. Effects that expose
    // their own scalar `size` parameter override this entry via `uniforms`.
    size: new Float32Array(4),
    motion: new Float32Array(4),
    ...uniforms,
    ...textures,
    resolution,
    fullResolution: completeResolution,
    tileOffset: tileOffset ?? new Float32Array(2),
    aspectRatio: f32(aspectValue),
    aspect: f32(aspectValue),
    aspectInv: f32(1 / aspectValue),
    invFullResolution: new Float32Array([
      f32(1 / completeResolution[0]),
      f32(1 / completeResolution[1]),
    ]),
    time: f32(time),
    globalTime: f32(time),
    deltaTime: f32(deltaTime),
    frame,
  })
}

export function bindCanonicalKernel(factory, options) {
  return bindGlslKernel(factory, createCanonicalBindings(options))
}
