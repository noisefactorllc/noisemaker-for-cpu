search synth3d, filter3d, render

noise3d(seed: 0, volumeSize: x64)
  .renderCubemapSurface()
  .write(o0)

render(o0)
