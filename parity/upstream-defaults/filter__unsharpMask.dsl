search filter, synth

noise(seed: 1, ridges: true)
  .unsharpMask()
  .write(o0)

render(o0)
