search mixer, synth

cell(seed: 1)
.write(o0)

noise(seed: 1, ridges: true)
.distortion(tex: read(o0))
.write(o1)
