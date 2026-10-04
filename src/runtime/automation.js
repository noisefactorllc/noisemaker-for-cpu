// CPU port of upstream Noisemaker automation evaluation
// (shaders/src/runtime/pipeline.js): oscillator-driven parameter values written as
// `osc(...)` in the Polymorphic DSL. Upstream resolves these per frame inside
// Pipeline.resolveUniformValue with a normalized 0..1 loop time; the port resolves
// them per render in CpuRenderer.effectParams with renderOptions.time, which is the
// same normalized time the canonical kernels receive as their `time` uniform.
//
// The upstream Midi/Audio automation nodes are not compiled by this port's DSL
// (value-position calls other than osc() are rejected at compile time), so only the
// Oscillator branch of upstream's evaluateAutomation is reachable here. The math
// below is a verbatim port of the upstream oscillator evaluation, including the
// noise2d two-stage periodic noise introduced upstream at eabb537e/5e68552a (speed
// applied once, after the first periodic wrap, matching the osc2d shader).

const TAU = Math.PI * 2

function oscSine(t) {
  // Smooth continuous sine: 0->1->0 over t=0..1, no discontinuity at wrap
  return (1.0 - Math.cos(t * TAU)) * 0.5
}

function oscTri(t) {
  // Triangle wave: 0->1->0 over t=0..1
  const tf = t - Math.floor(t)
  return 1.0 - Math.abs(tf * 2.0 - 1.0)
}

function oscSaw(t) {
  // Sawtooth: 0->1 over t=0..1
  return t - Math.floor(t)
}

function oscSawInv(t) {
  // Inverted sawtooth: 1->0 over t=0..1
  return 1.0 - (t - Math.floor(t))
}

function oscSquare(t) {
  // Square wave: 0 or 1
  return (t - Math.floor(t)) >= 0.5 ? 1.0 : 0.0
}

// Simple hash for noise
function hash21(px, py, s) {
  let x = (px * 234.34 + s) % 1
  let y = (py * 435.345 + s) % 1
  if (x < 0) x += 1
  if (y < 0) y += 1
  const p = x + y + (x + y) * 34.23
  return (x * y * p) % 1
}

// Value noise 2D
function noise2D(px, py, s) {
  const ix = Math.floor(px)
  const iy = Math.floor(py)
  let fx = px - ix
  let fy = py - iy
  fx = fx * fx * (3 - 2 * fx)
  fy = fy * fy * (3 - 2 * fy)

  const a = hash21(ix, iy, s)
  const b = hash21(ix + 1, iy, s)
  const c = hash21(ix, iy + 1, s)
  const d = hash21(ix + 1, iy + 1, s)

  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy
}

// Looping noise - samples on a circle for seamless temporal loops
function oscNoise(t, seed) {
  const temporal = t % 1
  const angle = temporal * TAU
  const radius = 2
  const loopX = Math.cos(angle) * radius
  const loopY = Math.sin(angle) * radius
  const n1 = noise2D(loopX + seed, loopY + seed, seed)
  const n2 = noise2D(loopX + seed * 2, loopY + seed * 2, seed)
  return (n1 + n2) / 2
}

// Two-stage periodic noise (noise2d, kind 6) - mirrors the osc2d effect:
//   scaledTime = periodicValue(time, timeNoise) * speed
//   value      = periodicValue(scaledTime, valueNoise)
// `time` is the normalized loop time plus the phase offset; speed is applied
// once, after the first periodic wrap, exactly as in the osc2d shader.
// osc() has no spatial position, so both noise stages are sampled at a fixed
// position derived from the seed (the osc2d shader salts the second stage with
// +12345). periodicValue() has period 1 in time, so whole-number speeds loop
// seamlessly.
function oscNoise2d(time, speed, seed) {
  const periodicValue = (x, v) => (Math.sin((x - v) * TAU) + 1) * 0.5
  const px = (Math.abs(seed % 16) + 0.5) / 16
  const py = (Math.abs(Math.floor(seed / 16) % 16) + 0.5) / 16
  const timeNoise = noise2D(px, py, seed + 12345)
  const valueNoise = noise2D(px, py, seed)
  const scaledTime = periodicValue(time, timeNoise) * speed
  return periodicValue(scaledTime, valueNoise)
}

const AUTOMATION_FIELD_RANGES = {
  unit: { min: 0, max: 1 },
  oscillatorSpeed: { min: -20, max: 20 },
  oscillatorOffset: { min: -1, max: 1 },
  oscillatorSeed: { min: 1, max: 9999 },
}

const MAX_AUTOMATION_DEPTH = 8

// 16-point Gauss-Legendre nodes and weights on [-1, 1]. Fixed quadrature keeps
// noise and deeply nested rate modulation deterministic and seekable.
const INTEGRATION_NODES = [
  -0.9894009349916499, -0.9445750230732326, -0.8656312023878318, -0.755404408355003,
  -0.6178762444026438, -0.4580167776572274, -0.2816035507792589, -0.0950125098376374,
  0.0950125098376374, 0.2816035507792589, 0.4580167776572274, 0.6178762444026438,
  0.755404408355003, 0.8656312023878318, 0.9445750230732326, 0.9894009349916499,
]
const INTEGRATION_WEIGHTS = [
  0.0271524594117541, 0.0622535239386479, 0.0951585116824928, 0.1246289712555339,
  0.1495959888165767, 0.1691565193950025, 0.1826034150449236, 0.1894506104550685,
  0.1894506104550685, 0.1826034150449236, 0.1691565193950025, 0.1495959888165767,
  0.1246289712555339, 0.0951585116824928, 0.0622535239386479, 0.0271524594117541,
]
const INTEGRATION_RULES = [
  { nodes: INTEGRATION_NODES, weights: INTEGRATION_WEIGHTS },
  {
    nodes: [
      -0.9602898564975363, -0.7966664774136267, -0.525532409916329,
      -0.1834346424956498, 0.1834346424956498, 0.525532409916329,
      0.7966664774136267, 0.9602898564975363,
    ],
    weights: [
      0.1012285362903763, 0.2223810344533745, 0.3137066458778873,
      0.362683783378362, 0.362683783378362, 0.3137066458778873,
      0.2223810344533745, 0.1012285362903763,
    ],
  },
  {
    nodes: [-0.8611363115940526, -0.3399810435848563, 0.3399810435848563, 0.8611363115940526],
    weights: [0.3478548451374538, 0.6521451548625461, 0.6521451548625461, 0.3478548451374538],
  },
  {
    nodes: [-0.5773502691896257, 0.5773502691896257],
    weights: [1, 1],
  },
]

export function isAutomationValue(value) {
  return !!value && typeof value === 'object' && value.type === 'Oscillator'
}

function scaleAutomationValue(value, range) {
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) return value
  return range.min + value * (range.max - range.min)
}

function resolveAutomationField(value, normalizedTime, range, depth, stack, fallback) {
  if (isAutomationValue(value)) {
    return evaluateAutomation(value, normalizedTime, range, depth + 1, stack)
  }
  return Number.isFinite(value) ? value : fallback
}

function canIntegrateOscillatorExactly(config) {
  return config.oscType >= 0 && config.oscType <= 4 &&
    [config.min, config.max, config.speed, config.offset, config.seed].every(Number.isFinite)
}

function oscPrimitive(type, x) {
  const whole = Math.floor(x)
  const fraction = x - whole
  switch (type) {
    case 0:
      return x * 0.5 - Math.sin(x * TAU) / (2 * TAU)
    case 1: {
      const partial = fraction < 0.5
        ? fraction * fraction
        : 2 * fraction - fraction * fraction - 0.5
      return whole * 0.5 + partial
    }
    case 2:
      return whole * 0.5 + fraction * fraction * 0.5
    case 3:
      return x - (whole * 0.5 + fraction * fraction * 0.5)
    case 4:
      return whole * 0.5 + Math.max(0, fraction - 0.5)
    default:
      return null
  }
}

function integrateSimpleOscillator(config, normalizedTime) {
  const { oscType, min, max, speed, offset } = config
  if (speed === 0) {
    return evaluateOscillator(config, 0, 0, new Set()) * normalizedTime
  }
  const start = oscPrimitive(oscType, offset)
  const end = oscPrimitive(oscType, offset + speed * normalizedTime)
  const rawIntegral = (end - start) / speed
  return min * normalizedTime + (max - min) * rawIntegral
}

function integrateAutomation(config, normalizedTime, range, depth, stack) {
  let integral
  if (canIntegrateOscillatorExactly(config)) {
    integral = integrateSimpleOscillator(config, normalizedTime)
  } else {
    // Decrease the quadrature order as rate modulators nest. This bounds an
    // eight-level graph to thousands, rather than millions, of evaluations
    // while retaining the highest precision at the user-visible output.
    const rule = INTEGRATION_RULES[Math.min(depth, INTEGRATION_RULES.length - 1)]
    const midpoint = normalizedTime * 0.5
    const halfWidth = normalizedTime * 0.5
    let sum = 0
    for (let i = 0; i < rule.nodes.length; i++) {
      const sampleTime = midpoint + halfWidth * rule.nodes[i]
      sum += rule.weights[i] * evaluateAutomation(config, sampleTime, null, depth + 1, stack)
    }
    integral = halfWidth * sum
  }

  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) return integral
  return range.min * normalizedTime + integral * (range.max - range.min)
}

function evaluateOscillator(osc, normalizedTime, depth, stack) {
  const { oscType } = osc
  const min = resolveAutomationField(osc.min, normalizedTime, AUTOMATION_FIELD_RANGES.unit, depth, stack, 0)
  const max = resolveAutomationField(osc.max, normalizedTime, AUTOMATION_FIELD_RANGES.unit, depth, stack, 1)
  const offset = resolveAutomationField(osc.offset, normalizedTime, AUTOMATION_FIELD_RANGES.oscillatorOffset, depth, stack, 0)
  const seed = resolveAutomationField(osc.seed, normalizedTime, AUTOMATION_FIELD_RANGES.oscillatorSeed, depth, stack, 1)

  // A modulated rate is frequency modulation, so phase is the integral of
  // rate. Literal rates keep the existing closed form exactly.
  const phase = isAutomationValue(osc.speed)
    ? integrateAutomation(osc.speed, normalizedTime, AUTOMATION_FIELD_RANGES.oscillatorSpeed, depth, stack)
    : normalizedTime * (Number.isFinite(osc.speed) ? osc.speed : 1)
  const t = phase + offset

  // Get raw oscillator value (0..1)
  let value
  switch (oscType) {
    case 0: value = oscSine(t); break
    case 1: value = oscTri(t); break
    case 2: value = oscSaw(t); break
    case 3: value = oscSawInv(t); break
    case 4: value = oscSquare(t); break
    case 5: value = oscNoise(t, seed); break
    case 6: {
      const speed = resolveAutomationField(
        osc.speed, normalizedTime, AUTOMATION_FIELD_RANGES.oscillatorSpeed, depth, stack, 1)
      value = oscNoise2d(normalizedTime + offset, Number.isFinite(speed) ? speed : 1, seed)
      break
    }
    default: value = 0
  }

  // Map to min..max range
  return min + value * (max - min)
}

export function evaluateAutomation(config, normalizedTime, range, depth = 0, stack = new Set()) {
  if (!isAutomationValue(config) || depth > MAX_AUTOMATION_DEPTH || stack.has(config)) {
    return scaleAutomationValue(0, range)
  }

  stack.add(config)
  let value
  try {
    value = evaluateOscillator(config, normalizedTime, depth, stack)
  } finally {
    stack.delete(config)
  }
  return scaleAutomationValue(value, range)
}

// Port of upstream Pipeline.resolveUniformValue: resolve an automation value for
// the current frame, scaled into the consumer parameter's declared range, with
// the upstream integer rounding for `type: 'int'` consumers. Non-automation
// values pass through unchanged.
export function resolveAutomationUniform(value, normalizedTime, spec) {
  if (!isAutomationValue(value)) return value
  const resolved = evaluateAutomation(value, normalizedTime, spec)
  return spec?.type === 'int' ? Math.round(resolved) : resolved
}
