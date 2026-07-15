search mixer, synth, filter

noise(seed: 1, ridges: true, colorMode: mono)
.write(o0)

perlin(seed: 0, colorMode: mono)
.write(o1)

gradient(seed: 1, type: linear)
.write(o2)

channelCombine(rTex: read(o0), gTex: read(o1), bTex: read(o2))
.write(o3)
