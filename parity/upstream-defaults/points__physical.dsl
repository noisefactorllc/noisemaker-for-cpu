search points, synth, render

perlin(seed: 0)
  .pointsEmit()
  .physical()
  .pointsRender()
  .write(o0)

render(o0)
