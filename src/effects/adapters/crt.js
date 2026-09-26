import { canonicalKernelFactories } from '../generated/canonical-kernels.js'

const F32 = Math.fround
const TAU = F32(6.283185307179586)
const INV_TAU = F32(1 / 6.283185307179586)

function metalSine(value) {
  const turns = F32(value * INV_TAU)
  const phase = turns - Math.floor(turns)
  return F32(Math.sin(phase * TAU))
}

export function crtFactory($bindings, $runtime) {
  const runtime = Object.create($runtime)
  const sin = (value) => {
    if (!ArrayBuffer.isView(value) && !Array.isArray(value)) return metalSine(value)
    const out = $runtime.alloc(value.length)
    for (let index = 0; index < value.length; index += 1) out[index] = metalSine(value[index])
    return out
  }
  runtime.stdlib = Object.freeze({ ...$runtime.stdlib, sin })
  return canonicalKernelFactories['filter/crt:crt']($bindings, runtime)
}
