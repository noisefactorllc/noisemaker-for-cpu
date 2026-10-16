// Direct CPU translation of the pinned canonical fractal.glsl Julia, Newton,
// Mandelbrot, and color-mapping paths. This explicit compatibility adapter is
// an implementation route for the same effect, not a different algorithm.
const F32 = Math.fround
const PI = 3.14159265359
const TAU = 6.28318530718
// Metal rounds the shader's `#define PI 3.14159265359` to the float32 one
// step above the nearest value (measured on the M4 authority).
const PI_METAL = 3.1415929794311523

function map(value, inMin, inMax, outMin, outMax) {
  return outMin + (outMax - outMin) * (value - inMin) / (inMax - inMin)
}

// GLSL executes the Julia path in float32; every operation below rounds to
// float32 so the CPU iteration matches the canonical kernels bit for bit.
// Probes against the M4/Metal authority established its exact evaluation:
// map()'s division lowers to a float32 reciprocal whose product stays exact
// into the following multiply-add, which rounds once at the end.
function mapF32(value, inMin, inMax, outMin, outMax) {
  return F32(outMin + F32(outMax - outMin) * ((value - inMin) * F32(1 / F32(inMax - inMin))))
}

function mixF32(a, b, amount) {
  return F32(F32(a * F32(1 - amount)) + F32(b * amount))
}

function rotateF32(x, y, rotation, aspect) {
  // The shader's PI literal rounds to the float32 above the nearest value on
  // Metal; the angle multiply rounds once against that constant.
  const angle = F32(mapF32(rotation, 0, 360, 0, 2) * F32(PI_METAL))
  const halfAspect = F32(0.5 * aspect)
  const px = F32(x - halfAspect)
  const py = F32(y - 0.5)
  const cs = F32(Math.cos(angle))
  const sn = F32(Math.sin(angle))
  // Metal lowers the mat2 multiply as one rounded product fused into the
  // other product per component (measured on the M4 authority).
  const rotatedX = F32(sn * py + F32(cs * px))
  const rotatedY = F32(cs * py + F32(-sn * px))
  // rotate2D's trailing `st += vec2(0.5 * aspectRatio, 0.5)` cancels exactly
  // against julia's `st -= vec2(0.5 * aspectRatio, 0.5)`, so no shift here.
  return [rotatedX, rotatedY]
}

function lengthF32(x, y) {
  return F32(Math.sqrt(F32(x * x + y * y)))
}

function fractF32(value) {
  return F32(value - Math.floor(value))
}

function modF32(value, divisor) {
  const base = F32(value)
  return F32(base - F32(divisor * Math.floor(F32(base / divisor))))
}

function hsvToRgbF32(h, s, v, out) {
  h = fractF32(h)
  const c = F32(v * s)
  const x = F32(c * F32(1 - Math.abs(modF32(F32(h * 6), 2) - 1)))
  const m = F32(v - c)
  if (h < 1 / 6) out.set([F32(c + m), F32(x + m), F32(m)])
  else if (h < 2 / 6) out.set([F32(x + m), F32(c + m), F32(m)])
  else if (h < 3 / 6) out.set([F32(m), F32(c + m), F32(x + m)])
  else if (h < 4 / 6) out.set([F32(m), F32(x + m), F32(c + m)])
  else if (h < 5 / 6) out.set([F32(x + m), F32(m), F32(c + m)])
  else out.set([F32(c + m), F32(m), F32(x + m)])
}

function linearToSrgb(value) {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055
}

// The palette cos terms follow the fused-multiply-add chain the GPU forms for
// `a + b * cos(6.28318 * (c * t + d))`: each accumulated add rounds once while
// the products stay exact float64 intermediates of float32 values.
function paletteF32(t, bindings, out) {
  for (let channel = 0; channel < 3; channel += 1) {
    const inner = F32(bindings.paletteFreq[channel] * t + bindings.palettePhase[channel])
    const cos = F32(Math.cos(F32(inner * F32(6.28318))))
    out[channel] = F32(bindings.paletteAmp[channel] * cos + bindings.paletteOffset[channel])
  }
  if (bindings.paletteMode === 1) {
    hsvToRgbF32(out[0], out[1], out[2], out)
  } else if (bindings.paletteMode === 2) {
    palette(t, bindings, out)
  }
}

function mod(value, divisor) {
  return value - divisor * Math.floor(value / divisor)
}

function mix(a, b, amount) {
  return a * (1 - amount) + b * amount
}

function rotate(x, y, rotation, aspect) {
  const angle = map(rotation, 0, 360, 0, 2) * PI
  const px = x - 0.5 * aspect
  const py = y - 0.5
  const cs = Math.cos(angle)
  const sn = Math.sin(angle)
  return [cs * px + sn * py + 0.5 * aspect, -sn * px + cs * py + 0.5]
}

function hsvToRgb(h, s, v, out) {
  h = fract(h)
  const c = v * s
  const x = c * (1 - Math.abs(mod(h * 6, 2) - 1))
  const m = v - c
  if (h < 1 / 6) out.set([c + m, x + m, m])
  else if (h < 2 / 6) out.set([x + m, c + m, m])
  else if (h < 3 / 6) out.set([m, c + m, x + m])
  else if (h < 4 / 6) out.set([m, x + m, c + m])
  else if (h < 5 / 6) out.set([x + m, m, c + m])
  else out.set([c + m, m, x + m])
}

function palette(t, bindings, out) {
  for (let channel = 0; channel < 3; channel += 1) {
    out[channel] = bindings.paletteOffset[channel] + bindings.paletteAmp[channel] * Math.cos(
      6.28318 * (bindings.paletteFreq[channel] * t + bindings.palettePhase[channel]),
    )
  }
  if (bindings.paletteMode === 1) {
    hsvToRgb(out[0], out[1], out[2], out)
  } else if (bindings.paletteMode === 2) {
    const L = out[0]
    const a = out[1] * -0.509 + 0.276
    const b = out[2] * -0.509 + 0.198
    const l1 = L + 0.3963377774 * a + 0.2158037573 * b
    const m1 = L - 0.1055613458 * a - 0.0638541728 * b
    const s1 = L - 0.0894841775 * a - 1.291485548 * b
    const l = l1 * l1 * l1
    const m = m1 * m1 * m1
    const s = s1 * s1 * s1
    out[0] = linearToSrgb(4.0767245293 * l - 3.3072168827 * m + 0.2307590544 * s)
    out[1] = linearToSrgb(-1.2681437731 * l + 2.6093323231 * m - 0.341134429 * s)
    out[2] = linearToSrgb(-0.0041119885 * l - 0.7034763098 * m + 1.7068625689 * s)
  }
}

function julia(x, y, b, aspect) {
  x = F32(x)
  y = F32(y)
  aspect = F32(aspect)
  const time = F32(b.time)
  const zoom = mapF32(b.zoomAmt, 0, 100, 2, 0.5)
  const speedy = mapF32(b.speed, 0, 100, 0, 1)
  const speed = mixF32(F32(speedy * 0.05), F32(speedy * 0.125), speedy)
  const cx = F32(Math.sin(F32(F32(time) * F32(TAU))) * speed + mapF32(b.offsetX, -100, 100, -0.5, 0.5))
  const cy = F32(Math.cos(F32(F32(time) * F32(TAU))) * speed + mapF32(b.offsetY, -100, 100, -1, 1))
  ;[x, y] = rotateF32(x, y, F32(b.rotation), aspect)
  // Metal contracts the zoom multiply with the center add into one fma; the
  // separate rounding is invisible at zoom 2 (the multiply is exact there)
  // and surfaces at other zooms.
  x = F32(x * zoom + mapF32(b.centerX, -100, 100, 1, -1))
  y = F32(y * zoom + mapF32(b.centerY, -100, 100, 1, -1))
  const count = b.iterations * 2
  let iteration = 0
  for (let index = 0; index < count; index += 1) {
    iteration = index
    // Metal contracts the x update as fma(x, x, c.x) rounded once, then the
    // y-square subtraction rounds separately; the y update keeps both products
    // exact and rounds the whole sum once.
    const nextX = F32(F32(x * x + cx) - y * y)
    const nextY = F32(y * x + x * y + cy)
    if (F32(nextX * nextX + nextY * nextY) > 4) break
    x = nextX
    y = nextY
  }
  if (count - iteration < (b.cutoff | 0)) return 1
  return b.mode === 0 ? F32(iteration / count) : lengthF32(x, y)
}

function newton(x, y, b, aspect) {
  ;[x, y] = rotate(x, y, b.rotation + 90, aspect)
  x = (x - 0.5 * aspect) * map(b.zoomAmt, 0, 130, 1, 0.01) + b.centerY * 0.01
  y = (y - 0.5) * map(b.zoomAmt, 0, 130, 1, 0.01) + b.centerX * 0.01
  const speed = map(b.speed, 0, 100, 0, 1)
  const offsetX = map(b.offsetX, -100, 100, -0.25, 0.25)
  const offsetY = map(b.offsetY, -100, 100, -0.25, 0.25)
  let iteration = 0
  for (let index = 0; index < b.iterations; index += 1) {
    const fx = x * x * x - 3 * x * y * y - 1
    const fy = 3 * x * x * y - y * y * y
    const fpx = 3 * x * x - 3 * y * y
    const fpy = 6 * x * y
    const denominator = fpx * fpx + fpy * fpy
    let tx = (fx * fpx + fy * fpy) / denominator
    let ty = (fy * fpx - fx * fpy) / denominator
    tx += Math.sin(b.time * TAU) * 0.1 * speed + offsetX
    ty += Math.cos(b.time * TAU) * 0.1 * speed + offsetY
    if (Math.hypot(tx, ty) < 0.001) break
    x -= tx
    y -= ty
    iteration += 1
  }
  return b.mode === 0 ? iteration / b.iterations : Math.hypot(x, y)
}

function mandelbrot(x, y, b, aspect) {
  const zoom = map(b.zoomAmt, 0, 100, 2, 0.5)
  const speedy = map(b.speed, 0, 100, 0, 1)
  const speed = mix(speedy * 0.05, speedy * 0.125, speedy)
  ;[x, y] = rotate(x, y, b.rotation, aspect)
  y = y * 2 - 1
  x = x * 2 - aspect
  const cx = zoom * x - (b.centerX + 50) * 0.01
  const cy = zoom * y - b.centerY * 0.01
  x = Math.sin(b.time * TAU) * speed
  y = Math.cos(b.time * TAU) * speed
  let iteration = 0
  for (; iteration < b.iterations; iteration += 1) {
    const nextX = x * x - y * y + cx
    const nextY = 2 * x * y + cy
    x = nextX
    y = nextY
    if (x * x + y * y > 16) break
  }
  if (iteration === b.iterations) return 1
  return b.mode === 0 ? iteration / b.iterations : Math.hypot(x, y) / b.iterations
}

export function fractalFactory($bindings, $runtime) {
  const color = new Float32Array(3)
  const aspect = $bindings.fullResolution[0] / $bindings.fullResolution[1]
  return function fractalKernel(context, out) {
    $runtime.beginPixel(context)
    const globalX = context.fragCoord[0] + $bindings.tileOffset[0]
    const globalY = context.fragCoord[1] + $bindings.tileOffset[1]
    const x = globalX / $bindings.fullResolution[1]
    const y = globalY / $bindings.fullResolution[1]
    let distance
    if ($bindings.type === 0) distance = julia(x, y, $bindings, aspect)
    else if ($bindings.type === 1) distance = newton(x, y, $bindings, aspect)
    else distance = mandelbrot(x, y, $bindings, aspect)
    if (distance === 1) {
      out[0] = $bindings.bgColor[0]
      out[1] = $bindings.bgColor[1]
      out[2] = $bindings.bgColor[2]
      out[3] = F32(F32($bindings.bgAlpha) * F32(0.01))
      return
    }
    // The color-mapping path runs in float32 as written, following the same
    // evaluation order and fused-multiply-add chain as the canonical shader.
    if ($bindings.cyclePalette === -1) distance = F32(distance - $bindings.time)
    else if ($bindings.cyclePalette === 1) distance = F32(distance + $bindings.time)
    distance = fractF32(F32(distance * F32($bindings.repeatPalette) +
      F32(F32($bindings.rotatePalette) * F32(0.01))))
    if ($bindings.levels > 0) {
      const levels = F32(F32($bindings.levels) + 1)
      distance = F32(Math.floor(F32(distance * levels)) / levels)
    }
    if ($bindings.colorMode === 0) color.fill(fractF32(distance))
    else if ($bindings.colorMode === 4) paletteF32(distance, $bindings, color)
    else if ($bindings.colorMode === 6) hsvToRgbF32(F32(distance * F32(F32($bindings.hueRange) * F32(0.01))), 1, 1, color)
    else color.set([0, 0, 1])
    out[0] = Math.fround(color[0])
    out[1] = Math.fround(color[1])
    out[2] = Math.fround(color[2])
    out[3] = 1
  }
}
