search points, synth, render

perlin(seed: 0)
  .pointsEmit(stateSize: 512)
  .buddhabrot()
  .pointsRender(intensity: 99)
  .write(o0)

render(o0)
