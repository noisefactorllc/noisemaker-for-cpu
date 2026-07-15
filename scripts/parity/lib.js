export function compareRgba8(actual, expected, tolerance = 2) {
  if (actual.length !== expected.length) throw new TypeError('Parity images must have matching RGBA lengths')
  let maxError = 0
  let totalError = 0
  let differingChannels = 0
  let channelsOverTolerance = 0
  for (let index = 0; index < actual.length; index += 1) {
    const error = Math.abs(actual[index] - expected[index])
    if (error !== 0) differingChannels += 1
    if (error > tolerance) channelsOverTolerance += 1
    if (error > maxError) maxError = error
    totalError += error
  }
  return {
    exact: differingChannels === 0,
    pass: channelsOverTolerance === 0,
    maxError,
    meanError: totalError / actual.length,
    differingChannels,
    channelsOverTolerance,
  }
}
