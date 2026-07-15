export class EffectRegistry {
  constructor(definitions = []) {
    this.effects = new Map()
    for (const definition of definitions) this.register(definition)
  }

  register(definition) {
    if (!definition?.id) throw new TypeError('register requires an EffectDefinition')
    if (this.effects.has(definition.id)) throw new Error(`Effect "${definition.id}" is already registered`)
    this.effects.set(definition.id, definition)
    return this
  }

  get(namespace, func) {
    return this.effects.get(`${namespace}/${func}`) ?? null
  }

  resolve(func, search) {
    for (const namespace of search) {
      const effect = this.get(namespace, func)
      if (effect) return effect
    }
    return null
  }

  list() {
    return [...this.effects.values()].sort((a, b) => a.id.localeCompare(b.id))
  }
}
