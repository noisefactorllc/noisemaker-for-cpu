search synth3d, filter3d, render

noise3d(seed: 0, volumeSize: x32)
  .reactionDiffusion3d(seed: 1, volumeSize: x32)
  .render3d(volumeSize: v32)
  .write(o0)

render(o0)
