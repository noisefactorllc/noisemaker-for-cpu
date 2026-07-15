search points, synth, render

perlin(seed: 0)
  .pointsEmit()
  .attractor()
  .pointsRender(viewMode: 1)
  .write(o0)

render(o0)
