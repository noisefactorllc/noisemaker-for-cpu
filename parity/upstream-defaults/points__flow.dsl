search points, synth, render

perlin(seed: 0)
  .pointsEmit()
  .flow()
  .pointsRender()
  .write(o0)

render(o0)
