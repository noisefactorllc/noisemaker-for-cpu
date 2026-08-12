# {{NM_PROGRAM_NAME}}

Your program, exported from Noisedeck as a package that renders it **on the CPU**. No GPU, no
WebGL, no native addon, and no `npm install`: `engine/` is the whole engine, and Node executes what
would normally be shader code as ordinary JavaScript, one pixel at a time. It fetches nothing at
runtime.

That makes this the export that runs anywhere Node runs — a server, a container, a CI job, a machine
with no display at all — and the slowest one. A GPU draws a frame in milliseconds because it colors
thousands of pixels at once; this walks them.

## Run it

You need **Node 22 or newer**. Nothing else. Unzip this folder, open a terminal in it, and start
small:

```sh
node engine/bin/noisemaker-cpu.js render program.dsl --width 64 --height 64 --output out.png
```

That writes a 64×64 `out.png` beside your program, which is enough to prove the export works. Then
scale up:

```sh
node engine/bin/noisemaker-cpu.js render program.dsl --width 512 --height 512 --output art.png
```

Time grows with the pixel count, and how far it grows depends entirely on what your program does, so
raise the size in steps rather than jumping to a poster.

Useful options: `--seed N` picks the deterministic seed, `--time N` the normalized time (some
effects animate), and `--input file.png` binds an image for programs that sample one.
`node engine/bin/noisemaker-cpu.js --help` lists the rest.

## What's inside

| Path | What it is |
| --- | --- |
| `program.dsl` | Your program's source, exactly as Noisedeck had it. |
| `engine/bin/noisemaker-cpu.js` | The port's command line renderer. This is the file you run. |
| `engine/src/` | The engine: DSL parser, effect catalog, and the pixel kernels. |
| `noisedeck-export.json` | What was exported, when, against which engine build. |
| `LICENSES/` | Licenses for everything shipped here. |

`engine/bin/noisemaker-cpu.js` resolves `engine/src/` relative to itself, so the pair moves together:
copy `engine/` somewhere else and the same command works from there.

## The engine

The port ships inside this export, so it runs offline as it stands. It is also a normal package —
`import { CpuRenderer } from './engine/src/index.js'` gives you the same renderer from your own code,
in Node or in a browser, and <https://github.com/noisefactorllc/noisemaker-for-cpu> documents that
API.

Noisedeck exported this program against Noisemaker `{{NM_ENGINE_VERSION}}`. The CPU port is a second
implementation of that engine rather than the same code, so expect small differences from what the
app showed you.

## Editing it

Replace `program.dsl` with anything the Noisemaker language accepts, as long as its effects are in
the supported set below, and run the same command again. To render several variations, call
`CpuRenderer` in a loop of your own rather than paying process startup each time.

## Effects used by this program

{{NM_EFFECT_LIST}}

## What this port cannot render

Five effects from the upstream catalog: `synth/roll`, `synth/scope` and `synth/spectrum`, which react
to live audio, and `render/meshLoader` and `render/meshRender`, which need a mesh pipeline. Everything
else in the catalog renders here, and `node engine/bin/noisemaker-cpu.js effects` lists exactly what
the engine in this folder carries.

To check an edited `program.dsl` against a different build of this port, put it back into Noisedeck
and open the export dialog with JavaScript selected: it marks any effect the port cannot render
before you export again.

## License

The Noisemaker engine and the CPU port are MIT licensed; see `LICENSES/`. Your program and the
imagery it renders are yours.
