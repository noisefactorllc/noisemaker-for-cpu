search points, synth, render

perlin(seed: 0)
  .pointsEmit(seed: 0)
  .life()
  .pointsRender(density: 0.1)
  .write(o0)

render(o0)
