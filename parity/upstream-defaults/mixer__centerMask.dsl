search mixer, synth

noise(seed: 1, ridges: true, colorMode: mono)
.write(o0)

noise(seed: 1, ridges: true)
.centerMask(tex: read(o0), mix: -75)
.write(o1)
