search points, synth, render

perlin(seed: 0)
  .pointsEmit(seed: 0)
  .flow()
  .pointsRender()
  .write(o0)

render(o0)
