search mixer, synth

noise(seed: 1, ridges: true, colorMode: mono)
.write(o0)

perlin(seed: 0)
.blendMode(tex: read(o0), mode: phoenix)
.write(o1)
