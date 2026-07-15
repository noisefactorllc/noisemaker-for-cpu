search mixer, synth

noise(seed: 1, ridges: true, colorMode: mono)
.write(o0)

noise(seed: 1, ridges: true)
.patternMix(tex: read(o0))
.write(o1)
