search synth3d, filter3d, render

noise3d(seed: 0, volumeSize: x64)
  .palette3d()
  .render3d()
  .write(o0)

render(o0)
