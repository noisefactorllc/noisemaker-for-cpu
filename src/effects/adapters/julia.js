const F32 = Math.fround
const TAU = 6.28318530718
const LOG2 = 0.6931471805599453
const BAILOUT2 = 256 * 256

function clamp(value, low = 0, high = 1) {
  return Math.min(Math.max(value, low), high)
}

function mix(a, b, amount) {
  return a * (1 - amount) + b * amount
}

function poi(index, out) {
  const values = [
    [-0.123, 0.745], [-0.123, 0.745], [-0.3905, 0.5868], [0, 1], [-1, 0],
    [-0.7455, 0.113], [-0.0986, 0.6534], [-0.8, 0.156], [-0.75, 0],
    [-0.5792, 0.5385], [0.28, 0.008],
  ][index] ?? [-0.123, 0.745]
  out[0] = values[0]
  out[1] = values[1]
}

function resolveC(bindings, out) {
  if (bindings.poi > 0) {
    poi(bindings.poi, out)
    return
  }
  const theta = bindings.time * bindings.cSpeed * TAU
  if (bindings.cPath === 1) {
    out[0] = Math.cos(theta) * 0.5 - Math.cos(2 * theta) * 0.25
    out[1] = Math.sin(theta) * 0.5 - Math.sin(2 * theta) * 0.25
  } else if (bindings.cPath === 2) {
    out[0] = Math.cos(theta) * bindings.cRadius
    out[1] = Math.sin(theta) * bindings.cRadius
  } else if (bindings.cPath === 3) {
    out[0] = -1 + Math.cos(theta) * 0.25
    out[1] = Math.sin(theta) * 0.25
  } else {
    out[0] = bindings.cReal
    out[1] = bindings.cImag
  }
}

export function juliaFactory($bindings, $runtime) {
  let scratchHigh = 0
  let scratchLow = 0
  const coordinates = new Float64Array(4)
  const constant = new Float64Array(2)
  const result = {
    iteration: 0,
    zMagnitude2: 0,
    derivativeMagnitude2: 0,
    stripeSum: 0,
    stripeCount: 0,
    stripeLast: 0,
    trapMin: 0,
  }

  function dfAdd(aHigh, aLow, bHigh, bLow) {
    const sum = F32(aHigh + bHigh)
    const virtual = F32(sum - aHigh)
    const error = F32(F32(aHigh - F32(sum - virtual)) + F32(bHigh - virtual))
    scratchHigh = sum
    scratchLow = F32(error + F32(aLow + bLow))
  }

  function dfMultiply(aHigh, aLow, bHigh, bLow) {
    const product = F32(aHigh * bHigh)
    const aTemp = F32(4097 * aHigh)
    const aHi = F32(aTemp - F32(aTemp - aHigh))
    const aLo = F32(aHigh - aHi)
    const bTemp = F32(4097 * bHigh)
    const bHi = F32(bTemp - F32(bTemp - bHigh))
    const bLo = F32(bHigh - bHi)
    let error = F32(F32(aHi * bHi) - product)
    error = F32(error + F32(aHi * bLo))
    error = F32(error + F32(aLo * bHi))
    error = F32(error + F32(aLo * bLo))
    error = F32(error + F32(aHigh * bLow))
    error = F32(error + F32(aLow * bHigh))
    scratchHigh = product
    scratchLow = error
  }

  function transform(x, y, zoom) {
    let uvX = F32((x - 0.5 * $bindings.fullResolution[0]) / Math.min($bindings.fullResolution[0], $bindings.fullResolution[1]))
    let uvY = F32((y - 0.5 * $bindings.fullResolution[1]) / Math.min($bindings.fullResolution[0], $bindings.fullResolution[1]))
    const angle = F32(-$bindings.rotation * TAU / 360)
    const cosine = F32(Math.cos(angle))
    const sine = F32(Math.sin(angle))
    const rotatedX = F32(F32(cosine * uvX) + F32(sine * uvY))
    uvY = F32(F32(-sine * uvX) + F32(cosine * uvY))
    uvX = rotatedX
    const scale = F32(2.5 / zoom)
    dfMultiply(uvX, 0, scale, 0)
    dfAdd(scratchHigh, scratchLow, F32($bindings.centerX), 0)
    coordinates[0] = scratchHigh
    coordinates[1] = scratchLow
    dfMultiply(uvY, 0, scale, 0)
    dfAdd(scratchHigh, scratchLow, F32($bindings.centerY), 0)
    coordinates[2] = scratchHigh
    coordinates[3] = scratchLow
  }

  function iterate(cReal, cImag, maxIterations, frequency, trapShape) {
    let reHigh = coordinates[0]
    let reLow = coordinates[1]
    let imHigh = coordinates[2]
    let imLow = coordinates[3]
    let derivativeX = 1
    let derivativeY = 0
    let iteration = 0
    let stripeSum = 0
    let stripeLast = 0
    let stripeCount = 0
    let trapMin = 1e10
    let slowX = reHigh
    let slowY = imHigh
    let period = 0
    for (let index = 0; index < Math.min(maxIterations, 1000); index += 1) {
      const nextDerivativeX = F32(2 * F32(F32(reHigh * derivativeX) - F32(imHigh * derivativeY)))
      derivativeY = F32(2 * F32(F32(reHigh * derivativeY) + F32(imHigh * derivativeX)))
      derivativeX = nextDerivativeX

      dfMultiply(reHigh, reLow, reHigh, reLow)
      const re2High = scratchHigh
      const re2Low = scratchLow
      dfMultiply(imHigh, imLow, imHigh, imLow)
      const im2High = scratchHigh
      const im2Low = scratchLow
      dfMultiply(reHigh, reLow, imHigh, imLow)
      const productHigh = scratchHigh
      const productLow = scratchLow
      dfAdd(re2High, re2Low, -im2High, -im2Low)
      dfAdd(scratchHigh, scratchLow, F32(cReal), 0)
      const nextReHigh = scratchHigh
      const nextReLow = scratchLow
      dfMultiply(productHigh, productLow, 2, 0)
      dfAdd(scratchHigh, scratchLow, F32(cImag), 0)
      reHigh = nextReHigh
      reLow = nextReLow
      imHigh = scratchHigh
      imLow = scratchLow

      const magnitude2 = F32(F32(reHigh * reHigh) + F32(imHigh * imHigh))
      if (magnitude2 > BAILOUT2) break
      iteration = F32(iteration + 1)
      if (frequency > 0) {
        stripeLast = F32(F32(0.5 * Math.sin(F32(frequency * Math.atan2(imHigh, reHigh)))) + 0.5)
        stripeSum = F32(stripeSum + stripeLast)
        stripeCount = F32(stripeCount + 1)
      }
      let trapDistance
      if (trapShape === 0) trapDistance = Math.hypot(reHigh, imHigh)
      else if (trapShape === 1) trapDistance = Math.min(Math.abs(reHigh), Math.abs(imHigh))
      else trapDistance = Math.abs(Math.hypot(reHigh, imHigh) - 1)
      trapMin = Math.min(trapMin, trapDistance)
      period += 1
      if (period === 20) {
        period = 0
        slowX = reHigh
        slowY = imHigh
      } else if (Math.hypot(reHigh - slowX, imHigh - slowY) < 1e-10) {
        iteration = maxIterations
        break
      }
    }
    result.iteration = iteration
    result.zMagnitude2 = F32(F32(reHigh * reHigh) + F32(imHigh * imHigh))
    result.derivativeMagnitude2 = F32(F32(derivativeX * derivativeX) + F32(derivativeY * derivativeY))
    result.stripeSum = stripeSum
    result.stripeCount = stripeCount
    result.stripeLast = stripeLast
    result.trapMin = trapMin
    return result
  }

  function smoothIteration(iterationResult, maxIterations) {
    if (iterationResult.iteration >= maxIterations) return 0
    const logMagnitude = Math.log(iterationResult.zMagnitude2) * 0.5
    const nu = Math.log(logMagnitude / LOG2) / LOG2
    return clamp((iterationResult.iteration + 1 - nu) / maxIterations)
  }

  function iterateSmooth(x, y, cReal, cImag, maxIterations, zoom) {
    transform(x, y, zoom)
    const r = iterate(cReal, cImag, maxIterations, 0, 0)
    return smoothIteration(r, maxIterations)
  }

  return function juliaKernel(context, out) {
    $runtime.beginPixel(context)
    const globalX = context.fragCoord[0] + $bindings.tileOffset[0]
    const globalY = context.fragCoord[1] + $bindings.tileOffset[1]
    resolveC($bindings, constant)
    let zoom
    if ($bindings.zoomSpeed > 0) {
      const phase = 0.5 * (1 - Math.cos($bindings.time * $bindings.zoomSpeed * TAU))
      zoom = Math.pow(10, $bindings.zoomDepth * phase)
    } else zoom = Math.pow(10, $bindings.zoomDepth)
    let value
    if ($bindings.outputMode === 4) {
      const base = iterateSmooth(globalX, globalY, constant[0], constant[1], $bindings.iterations, zoom)
      const right = iterateSmooth(globalX + 1, globalY, constant[0], constant[1], $bindings.iterations, zoom)
      const up = iterateSmooth(globalX, globalY + 1, constant[0], constant[1], $bindings.iterations, zoom)
      let nx = right - base
      let ny = up - base
      let nz = 0.05
      let magnitude = Math.hypot(nx, ny, nz)
      nx /= magnitude
      ny /= magnitude
      nz /= magnitude
      const angle = $bindings.lightAngle * TAU / 360
      let lx = Math.cos(angle)
      let ly = Math.sin(angle)
      let lz = 0.7
      magnitude = Math.hypot(lx, ly, lz)
      lx /= magnitude
      ly /= magnitude
      lz /= magnitude
      value = clamp(Math.max(nx * lx + ny * ly + nz * lz, 0))
    } else {
      transform(globalX, globalY, zoom)
      const r = iterate(constant[0], constant[1], $bindings.iterations, $bindings.stripeFreq, $bindings.trapShape)
      if ($bindings.outputMode === 0) value = smoothIteration(r, $bindings.iterations)
      else if ($bindings.outputMode === 1) {
        if (r.iteration >= $bindings.iterations) value = 0
        else {
          const magnitude = Math.sqrt(r.zMagnitude2)
          const derivative = Math.sqrt(r.derivativeMagnitude2)
          value = derivative < 1e-10 ? 0 : clamp(Math.log(2 * magnitude * Math.log(magnitude) / derivative + 1) * 2)
        }
      } else if ($bindings.outputMode === 2) {
        if (r.iteration >= $bindings.iterations || r.stripeCount < 1) value = 0
        else {
          const average = r.stripeSum / r.stripeCount
          const previous = r.stripeCount > 1 ? (r.stripeSum - r.stripeLast) / (r.stripeCount - 1) : average
          const logMagnitude = Math.log(r.zMagnitude2) * 0.5
          const nu = Math.log(logMagnitude / LOG2) / LOG2
          value = clamp(mix(previous, average, clamp(1 - nu + Math.floor(nu))))
        }
      } else if ($bindings.outputMode === 3) {
        value = r.iteration >= $bindings.iterations ? 0 : clamp(1 - r.trapMin)
      } else value = smoothIteration(r, $bindings.iterations)
    }
    if ($bindings.invert) value = 1 - value
    value = Math.fround(value)
    out[0] = value
    out[1] = value
    out[2] = value
    out[3] = 1
  }
}
