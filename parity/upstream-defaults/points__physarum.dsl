search points, synth, render

perlin(seed: 0)
  .pointsEmit(seed: 0, stateSize: x64)
  .physarum()
  .pointsRender(density: 1)
  .write(o0)

render(o0)
