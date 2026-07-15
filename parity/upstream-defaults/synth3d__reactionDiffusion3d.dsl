search synth3d, filter3d, render

noise3d(volumeSize: x32)
  .write3d(vol0, geo0)

reactionDiffusion3d(source: read3d(vol0), geoSource: read3d(geo0))
  .render3d()
  .write(o0)

render(o0)
