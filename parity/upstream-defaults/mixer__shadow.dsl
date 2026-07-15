search mixer, synth

noise(seed: 1, scaleX: 100, scaleY: 100)
.write(o0)

noise(seed: 1, ridges: true, colorMode: mono)
.shadow(tex: read(o0))
.write(o1)
