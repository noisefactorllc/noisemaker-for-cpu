import { historicPaletteData, paletteData } from '../generated/canonical-adapter-data.js'

const TAU = 6.283185307179586

function clamp(value, low = 0, high = 1) {
  return Math.min(Math.max(value, low), high)
}

function fract(value) {
  return value - Math.floor(value)
}

function mix(a, b, amount) {
  return a * (1 - amount) + b * amount
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1
  const amount = clamp((value - edge0) / (edge1 - edge0))
  return amount * amount * (3 - 2 * amount)
}

function hsvToRgb(h, s, v, out) {
  const c = v * s
  const hp = h * 6
  const x = c * (1 - Math.abs((hp - 2 * Math.floor(hp / 2)) - 1))
  const m = v - c
  if (hp < 1) out.set([c + m, x + m, m])
  else if (hp < 2) out.set([x + m, c + m, m])
  else if (hp < 3) out.set([m, c + m, x + m])
  else if (hp < 4) out.set([m, x + m, c + m])
  else if (hp < 5) out.set([x + m, m, c + m])
  else out.set([c + m, m, x + m])
}

function linearToSrgb(value) {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055
}

function oklabToRgb(labL, labA, labB, out) {
  const L = labL
  const a = labA * -0.509 + 0.276
  const b = labB * -0.509 + 0.198
  const l1 = L + 0.3963377774 * a + 0.2158037573 * b
  const m1 = L - 0.1055613458 * a - 0.0638541728 * b
  const s1 = L - 0.0894841775 * a - 1.291485548 * b
  const l = l1 * l1 * l1
  const m = m1 * m1 * m1
  const s = s1 * s1 * s1
  out[0] = clamp(linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s))
  out[1] = clamp(linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s))
  out[2] = clamp(linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s))
}

export function paletteFactory($bindings, $runtime) {
  const color = new Float32Array(3)
  return function paletteKernel(context, out) {
    $runtime.beginPixel(context)
    const input = $runtime.stdlib.texture($bindings.inputTex, [
      context.fragCoord[0] / $bindings.inputTex.width,
      context.fragCoord[1] / $bindings.inputTex.height,
    ])
    const paletteIndex = $bindings.paletteIndex | 0
    if (paletteIndex <= 0 || paletteIndex > paletteData.length) {
      $runtime.writeColor(input, out)
      return
    }
    const entry = paletteData[paletteIndex - 1]
    const lum = input[0] * 0.299 + input[1] * 0.587 + input[2] * 0.114
    let t = lum * $bindings.repeat + $bindings.offset * 0.01
    if ($bindings.rotation === -1) t += $bindings.time
    else if ($bindings.rotation === 1) t -= $bindings.time
    for (let channel = 0; channel < 3; channel += 1) {
      color[channel] = clamp(entry[8 + channel] + entry[channel] * Math.cos(TAU * (entry[4 + channel] * t + entry[12 + channel])))
    }
    const mode = entry[3] | 0
    if (mode === 1) hsvToRgb(color[0], color[1], color[2], color)
    else if (mode === 2) oklabToRgb(color[0], color[1], color[2], color)
    const alpha = $bindings.alpha
    out[0] = Math.fround(mix(input[0], color[0], alpha))
    out[1] = Math.fround(mix(input[1], color[1], alpha))
    out[2] = Math.fround(mix(input[2], color[2], alpha))
    out[3] = input[3]
  }
}

function sampleHistoric(entry, lum, smoothness, out) {
  const blendWidth = smoothness * 0.1
  const blends = [
    smoothstep(0.2 - blendWidth, 0.2 + blendWidth, lum),
    smoothstep(0.4 - blendWidth, 0.4 + blendWidth, lum),
    smoothstep(0.6 - blendWidth, 0.6 + blendWidth, lum),
    smoothstep(0.8 - blendWidth, 0.8 + blendWidth, lum),
  ]
  out[0] = entry[0]
  out[1] = entry[1]
  out[2] = entry[2]
  for (let colorIndex = 1; colorIndex < 5; colorIndex += 1) {
    const amount = blends[colorIndex - 1]
    const base = colorIndex * 3
    out[0] = mix(out[0], entry[base], amount)
    out[1] = mix(out[1], entry[base + 1], amount)
    out[2] = mix(out[2], entry[base + 2], amount)
  }
  if (blendWidth > 0) {
    const distance = lum > 0.5 ? lum - 1 : lum
    const wrapFactor = smoothstep(-blendWidth, blendWidth, distance)
    const wrapMask = 1 - smoothstep(0, blendWidth, Math.abs(distance))
    for (let channel = 0; channel < 3; channel += 1) {
      const wrapColor = mix(entry[12 + channel], entry[channel], wrapFactor)
      out[channel] = mix(out[channel], wrapColor, wrapMask)
    }
  }
}

export function historicPaletteFactory($bindings, $runtime) {
  const color = new Float32Array(3)
  return function historicPaletteKernel(context, out) {
    $runtime.beginPixel(context)
    const input = $runtime.stdlib.texture($bindings.inputTex, [
      context.fragCoord[0] / $bindings.inputTex.width,
      context.fragCoord[1] / $bindings.inputTex.height,
    ])
    const index = Math.min(Math.max($bindings.paletteIndex | 0, 0), historicPaletteData.length - 1)
    const lum = input[0] * 0.299 + input[1] * 0.587 + input[2] * 0.114
    let t = lum * (1 - 1e-4) * $bindings.repeat + $bindings.offset * 0.01
    if ($bindings.rotation === -1) t += $bindings.time
    else if ($bindings.rotation === 1) t -= $bindings.time
    sampleHistoric(historicPaletteData[index], fract(t), $bindings.smoothness, color)
    const alpha = $bindings.alpha
    out[0] = Math.fround(mix(input[0], color[0], alpha))
    out[1] = Math.fround(mix(input[1], color[1], alpha))
    out[2] = Math.fround(mix(input[2], color[2], alpha))
    out[3] = input[3]
  }
}
