search mixer, synth

polygon(smooth: 0, bgAlpha: 0)
  .write(o0)

 noise(seed: 1, scaleX: 100, scaleY: 100)
  .alphaMask(tex: read(o0))
  .write(o1)
