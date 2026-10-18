search points, synth, render

polygon(
  radius: 0.7,
  fgAlpha: 0.1,
  bgAlpha: 0
)
  .write(o0)

perlin(seed: 0, ridges: true)
  .pointsEmit(seed: 0, stateSize: x64)
  .physical()
  .pointsBillboardRender(seed: 42, density: 0.1, 
    tex: read(o0),
    pointSize: 4,
    sizeVariation: 50,
    rotationVar: 50
  )
  .write(o1)

render(o1)
