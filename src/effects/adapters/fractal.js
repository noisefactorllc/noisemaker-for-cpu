// Direct CPU translation of the pinned canonical fractal.glsl Julia, Newton,
// Mandelbrot, and color-mapping paths. This explicit compatibility adapter is
// an implementation route for the same effect, not a different algorithm.
const PI = 3.14159265359
const TAU = 6.28318530718

function map(value, inMin, inMax, outMin, outMax) {
  return outMin + (outMax - outMin) * (value - inMin) / (inMax - inMin)
}

function fract(value) {
  return value - Math.floor(value)
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

function linearToSrgb(value) {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055
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
  const zoom = map(b.zoomAmt, 0, 100, 2, 0.5)
  const speedy = map(b.speed, 0, 100, 0, 1)
  const speed = mix(speedy * 0.05, speedy * 0.125, speedy)
  const cx = Math.sin(b.time * TAU) * speed + map(b.offsetX, -100, 100, -0.5, 0.5)
  const cy = Math.cos(b.time * TAU) * speed + map(b.offsetY, -100, 100, -1, 1)
  ;[x, y] = rotate(x, y, b.rotation, aspect)
  x = (x - 0.5 * aspect) * zoom + map(b.centerX, -100, 100, 1, -1)
  y = (y - 0.5) * zoom + map(b.centerY, -100, 100, 1, -1)
  const count = b.iterations * 2
  let iteration = 0
  for (let index = 0; index < count; index += 1) {
    iteration = index
    const nextX = x * x - y * y + cx
    const nextY = y * x + x * y + cy
    if (nextX * nextX + nextY * nextY > 4) break
    x = nextX
    y = nextY
  }
  if (count - iteration < (b.cutoff | 0)) return 1
  return b.mode === 0 ? iteration / count : Math.hypot(x, y)
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
      out[3] = Math.fround($bindings.bgAlpha * 0.01)
      return
    }
    if ($bindings.cyclePalette === -1) distance -= $bindings.time
    else if ($bindings.cyclePalette === 1) distance += $bindings.time
    distance = fract(distance * $bindings.repeatPalette + $bindings.rotatePalette * 0.01)
    if ($bindings.levels > 0) {
      const levels = $bindings.levels + 1
      distance = Math.floor(distance * levels) / levels
    }
    if ($bindings.colorMode === 0) color.fill(fract(distance))
    else if ($bindings.colorMode === 4) palette(distance, $bindings, color)
    else if ($bindings.colorMode === 6) hsvToRgb(distance * $bindings.hueRange * 0.01, 1, 1, color)
    else color.set([0, 0, 1])
    out[0] = Math.fround(color[0])
    out[1] = Math.fround(color[1])
    out[2] = Math.fround(color[2])
    out[3] = 1
  }
}
