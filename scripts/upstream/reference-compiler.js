// Reference DSL compiler for differential tests: loads the pinned upstream tree
// (a Noisemaker checkout, usually NM_REFERENCE_ROOT) and registers every effect
// definition the way upstream's CanvasRenderer does (registerEffectWithRuntime,
// the choice enums it returns, and the starter ops from isStarterEffect). The
// returned `compile` mirrors stage 1 of upstream's runtime/compiler.js
// compileGraph: lex, parse and validate, then reject the program when any
// diagnostic has severity "error". Warnings do not reject a program. The
// returned `unparse` writes a compiled program back to DSL text with upstream's
// unparser, as a host that saves the program does.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const cache = new Map()

async function load(root) {
  const importTree = (path) => import(pathToFileURL(join(root, path)).href)
  const canvas = await importTree('shaders/src/renderer/canvas.js')
  const lang = await importTree('shaders/src/lang/index.js')
  const enums = await importTree('shaders/src/lang/enums.js')
  const stdEnums = await importTree('shaders/src/lang/std_enums.js')
  const validator = await importTree('shaders/src/lang/validator.js')
  const effects = await importTree('shaders/src/runtime/registry.js')
  await enums.mergeIntoEnums(stdEnums.stdEnums)

  const effectsRoot = join(root, 'shaders', 'effects')
  const starterNames = []
  const effectIds = []
  for (const namespace of readdirSync(effectsRoot, { withFileTypes: true })) {
    if (!namespace.isDirectory()) continue
    for (const entry of readdirSync(join(effectsRoot, namespace.name), { withFileTypes: true })) {
      const definitionPath = join(effectsRoot, namespace.name, entry.name, 'definition.js')
      if (!entry.isDirectory() || !existsSync(definitionPath)) continue
      // A definition exports an Effect instance or an Effect subclass, which
      // upstream's loader instantiates (CanvasRenderer.loadEffectDefinition).
      const exported = (await import(pathToFileURL(definitionPath).href)).default
      const instance = typeof exported === 'function' ? new exported() : exported
      const effect = { namespace: namespace.name, name: entry.name, instance }
      const choices = canvas.CanvasRenderer.prototype.registerEffectWithRuntime.call({}, effect)
      if (choices) await enums.mergeIntoEnums(choices)
      if (canvas.isStarterEffect(effect)) {
        const func = instance.func || entry.name
        starterNames.push(func, `${namespace.name}.${func}`)
      }
      effectIds.push(`${namespace.name}/${entry.name}`)
    }
  }
  validator.registerStarterOps(starterNames)

  function compile(source) {
    try {
      const result = lang.compile(source)
      const errors = (result.diagnostics ?? []).filter((diagnostic) => diagnostic.severity === 'error')
      return { accepted: errors.length === 0, errors: errors.map((error) => error.message), result }
    } catch (error) {
      return { accepted: false, errors: [error?.message ?? String(error)], result: null }
    }
  }

  function unparse(source) {
    const outcome = compile(source)
    if (!outcome.accepted) throw new Error(`reference compiler rejected the program: ${outcome.errors.join('; ')}`)
    return lang.unparse(outcome.result, {}, { getEffectDef: (op) => effects.getEffect(op) })
  }

  return { effectIds, compile, unparse }
}

export function loadReferenceCompiler(root) {
  if (!cache.has(root)) cache.set(root, load(root))
  return cache.get(root)
}
