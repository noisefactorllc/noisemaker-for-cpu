#!/usr/bin/env node

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { tokenizeDsl } from '../../src/dsl/tokenize.js'
import { parseDsl } from '../../src/dsl/parser.js'
import { effectCatalog } from '../../src/effects/catalog.js'

const scriptPath = fileURLToPath(import.meta.url)
const projectRoot = resolve(dirname(scriptPath), '..', '..')

const seededCalls = new Map()
for (const effect of effectCatalog) {
  if (!effect.params.seed) continue
  const explicitNames = new Set(['seed'])
  for (const [alias, canonical] of Object.entries(effect.paramAliases)) if (canonical === 'seed') explicitNames.add(alias)
  seededCalls.set(effect.id, { defaultValue: effect.params.seed.default, explicitNames })
}

export function pinDefaultSeeds(source, sourceName = '<dsl>') {
  const tokens = tokenizeDsl(source, { sourceName })
  const search = parseDsl(source, { sourceName }).search
  const insertions = []
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const call = tokens[index]
    const seed = call.type === 'identifier'
      ? search.map((namespace) => seededCalls.get(`${namespace}/${call.lexeme}`)).find(Boolean)
      : null
    if (!seed || tokens[index + 1].lexeme !== '(') continue
    const open = tokens[index + 1]
    let depth = 0
    let closeIndex = -1
    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      if (tokens[cursor].lexeme === '(') depth += 1
      else if (tokens[cursor].lexeme === ')' && --depth === 0) {
        closeIndex = cursor
        break
      }
    }
    if (closeIndex < 0) throw new Error(`${sourceName}: unterminated ${call.lexeme} call`)
    const argumentTokens = tokens.slice(index + 2, closeIndex)
    let argumentDepth = 0
    let hasNamedArguments = false
    let hasExplicitSeed = false
    for (let cursor = 0; cursor < argumentTokens.length; cursor += 1) {
      const token = argumentTokens[cursor]
      if (['(', '['].includes(token.lexeme)) argumentDepth += 1
      else if ([')', ']'].includes(token.lexeme)) argumentDepth -= 1
      else if (argumentDepth === 0 && token.type === 'identifier' && argumentTokens[cursor + 1]?.lexeme === ':') {
        hasNamedArguments = true
        if (seed.explicitNames.has(token.lexeme)) hasExplicitSeed = true
      }
    }
    if (hasExplicitSeed) continue
    if (argumentTokens.length > 0 && !hasNamedArguments) {
      throw new Error(`${sourceName}: cannot pin omitted seed in positional ${call.lexeme}() call`)
    }
    insertions.push({ index: open.index + 1, text: argumentTokens.length > 0 ? `seed: ${seed.defaultValue}, ` : `seed: ${seed.defaultValue}` })
    index = closeIndex
  }
  let output = source
  for (const insertion of insertions.sort((left, right) => right.index - left.index)) {
    output = output.slice(0, insertion.index) + insertion.text + output.slice(insertion.index)
  }
  return output
}

async function main() {
  const directory = resolve(projectRoot, 'parity', 'upstream-defaults')
  let changed = 0
  for (const name of (await readdir(directory)).filter((entry) => entry.endsWith('.dsl')).sort()) {
    const path = resolve(directory, name)
    const source = await readFile(path, 'utf8')
    const pinned = pinDefaultSeeds(source, name)
    if (pinned === source) continue
    await writeFile(path, pinned)
    changed += 1
  }
  process.stdout.write(`Pinned canonical default seeds in ${changed} parity fixtures\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`)
    process.exitCode = 1
  })
}
