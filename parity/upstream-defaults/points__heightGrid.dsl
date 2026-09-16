search synth, points, render

perlin(seed: 0, scale: 35, colorMode: rgb)
  .write(o1)

perlin(seed: 0, scale: 22, octaves: 4, colorMode: mono)
  .write(o2)

solid()
  .pointsEmit(seed: 0, stateSize: x64)
  .heightGrid(heightTex: read(o2), diffuseTex: read(o1), heightScale: 25)
  .pointsBillboardRender(seed: 42, viewMode: perspective, rotateX: 0.55, posY: -12, posZ: 22, pointSize: 2, density: 100, intensity: 0, inputIntensity: 0, depositOpacity: 65)
  .write(o0)

render(o0)
