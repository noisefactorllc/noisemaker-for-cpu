import { execFileSync } from 'node:child_process'

export const PINNED_UPSTREAM_REVISION = 'dc67827bfc2d4e71d64cb6095cd8c922dc64360f'
export const PINNED_SOURCE_PATHS = Object.freeze(['shaders/effects', 'shaders/src'])

export function assertPinnedSource(referenceRoot, run = execFileSync) {
  let head
  try {
    head = run('git', ['rev-parse', 'HEAD'], { cwd: referenceRoot, encoding: 'utf8' }).trim()
  } catch (error) {
    throw new Error(`Unable to verify Noisemaker source revision at ${referenceRoot}: ${error.message}`, { cause: error })
  }
  if (head !== PINNED_UPSTREAM_REVISION) {
    throw new Error(`Noisemaker source revision mismatch: expected ${PINNED_UPSTREAM_REVISION}, received ${head}`)
  }
  const dirty = run('git', ['status', '--porcelain', '--untracked-files=all', '--', ...PINNED_SOURCE_PATHS], {
    cwd: referenceRoot,
    encoding: 'utf8',
  }).trim()
  if (dirty) throw new Error(`Noisemaker pinned source paths are dirty; refusing generation:\n${dirty}`)
  return head
}
