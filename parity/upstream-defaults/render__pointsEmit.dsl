search points, synth, render

perlin(seed: 0)
  .pointsEmit(seed: 0)
  .physical()
  .pointsRender()
  .write(o0)

render(o0)
