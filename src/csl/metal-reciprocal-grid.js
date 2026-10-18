// Where the exact reciprocal of a float32 mantissa falls on the float32 grid.
// 2^47 / (2^23 + m) is the reciprocal of 1 + m / 2^23 in units of 2^-24.
// Float64 division rounds it correctly, so every host gets the same position.
export function reciprocalGridPosition(mantissa) {
  const scaled = 140737488355328 / (8388608 + mantissa)
  return scaled - Math.floor(scaled)
}

// The Metal reciprocal can deviate from the correctly rounded value only for
// mantissas whose position lies in the measured band (see metal-division.js).
export function inReciprocalBand(mantissa, band) {
  if (mantissa === 0) return false
  const position = reciprocalGridPosition(mantissa)
  return position >= band.bandLow && position <= band.bandHigh
}
