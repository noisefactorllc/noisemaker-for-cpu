search points, synth, render

perlin(seed: 0)
  .pointsEmit(seed: 0, stateSize: x64)
  .physical()
  .pointsRender(density: 5)
  .write(o0)

render(o0)
