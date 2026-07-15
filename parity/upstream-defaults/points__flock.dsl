search points, synth, render

perlin(seed: 0)
  .pointsEmit()
  .flock()
  .pointsRender()
  .write(o0)

render(o0)
