search synth3d, filter3d, render

noise3d(seed: 0, volumeSize: x64)
  .renderCubemap3d()
  .write(o0)

render(o0)
