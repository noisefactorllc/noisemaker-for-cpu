import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const SNAPSHOT = 'src/effects/generated/upstream-snapshot.js'
const REVISION = /^export const UPSTREAM_REVISION = "[0-9a-f]{40}"$/gm
const PACKAGE_INPUTS = ['package.json', 'package-lock.json']

async function collectFiles(root, directory) {
  const children = await readdir(join(root, directory), { withFileTypes: true })
  const paths = []
  for (const child of children) {
    const relative = `${directory}/${child.name}`
    if (child.isDirectory()) paths.push(...await collectFiles(root, relative))
    else if (child.isFile()) paths.push(relative)
    else throw new Error(`Unsupported renderer input type: ${relative}`)
  }
  return paths
}

function snapshotBytes(contents) {
  const source = contents.toString('latin1')
  if ([...source.matchAll(REVISION)].length !== 1) {
    throw new Error(`Expected one exact UPSTREAM_REVISION declaration in ${SNAPSHOT}`)
  }
  return Buffer.from(source.replace(REVISION, `export const UPSTREAM_REVISION = "${'0'.repeat(40)}"`), 'latin1')
}

// The CPU renderer resolves its modules and generated data from src. Node
// resolves the package as ESM using the root manifest. The replay also binds
// its own executable and its frozen case and reference data separately.
export async function rendererInputDigest(root) {
  if (!(await lstat(join(root, 'src'))).isDirectory()) throw new Error('Expected a regular src directory')
  const files = [...PACKAGE_INPUTS, ...await collectFiles(root, 'src')].sort()
  const digest = createHash('sha256')
  for (const file of files) {
    const path = join(root, file)
    if (!(await lstat(path)).isFile()) throw new Error(`Expected a regular renderer input: ${file}`)
    const content = await readFile(path)
    const input = file === SNAPSHOT ? snapshotBytes(content) : content
    const hash = createHash('sha256').update(input).digest('hex')
    digest.update(`${JSON.stringify([file, hash])}\n`)
  }
  if (!files.includes(SNAPSHOT)) throw new Error(`Expected renderer input: ${SNAPSHOT}`)
  return digest.digest('hex')
}
