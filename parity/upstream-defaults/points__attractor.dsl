search points, synth, render

perlin(seed: 0)
  .pointsEmit(seed: 0)
  .attractor()
  .pointsRender(viewMode: 1)
  .write(o0)

render(o0)
