search points, synth, render

perlin(seed: 0)
  .pointsEmit(seed: 0, stateSize: 512)
  .buddhabrot()
  .pointsRender(intensity: 99)
  .write(o0)

render(o0)
