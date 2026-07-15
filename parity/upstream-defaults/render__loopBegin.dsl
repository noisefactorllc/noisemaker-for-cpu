search synth, filter, render

noise(seed: 1, ridges: true)
  .loopBegin(alpha: 95, intensity: 95)
  .warp(seed: 1)
  .loopEnd()
  .write(o0)

render(o0)
