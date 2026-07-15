search mixer, synth

pattern()
.write(o0)

noise(seed: 1, ridges: true)
.uvRemap(tex: read(o0), scale: 25)
.write(o1)
