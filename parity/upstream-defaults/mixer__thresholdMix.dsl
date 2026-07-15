search mixer, synth

noise(seed: 1)
.write(o0)

solid(color: #000000)
.thresholdMix(tex: read(o0))
.write(o1)
