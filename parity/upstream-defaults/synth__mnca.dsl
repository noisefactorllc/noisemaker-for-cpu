search synth

noise(seed: 1, ridges: true)
  .write(o0)

mnca(seed: 1, zoom: x4, tex: read(o0))
  .write(o1)

render(o1)
