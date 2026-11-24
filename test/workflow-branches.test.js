// The branch contract of the workflows. The test jobs run on pushes to `main`
// and to `2.x`. Every job that releases a kit, sends a notice or dispatches
// work runs only for `main`: by its workflow's branch filter, by
// `github.ref == 'refs/heads/main'`, or by `workflow_run.head_branch == 'main'`.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

const workflow = (name) => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8')

// The lines of a top-level key, up to the next top-level key.
function topBlock(text, key) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => line === `${key}:`)
  assert.ok(start >= 0, `the workflow has a top-level ${key}:`)
  const end = lines.findIndex((line, index) => index > start && /^\S/.test(line))
  return lines.slice(start + 1, end < 0 ? lines.length : end)
}

// The entries of a block at an indent: name -> its lines.
function entries(lines, indent) {
  const result = {}
  let current = null
  for (const line of lines) {
    const match = new RegExp(`^ {${indent}}([A-Za-z0-9_-]+):`).exec(line)
    if (match && !line.startsWith(' '.repeat(indent + 1))) {
      current = match[1]
      result[current] = [line]
    } else if (current) {
      result[current].push(line)
    }
  }
  return result
}

const triggers = (text) => entries(topBlock(text, 'on'), 2)
const jobs = (text) => entries(topBlock(text, 'jobs'), 2)

function pushBranches(text) {
  const push = triggers(text).push
  assert.ok(push, 'the workflow runs on push')
  const line = push.find((entry) => /^ {4}branches:/.test(entry))
  assert.ok(line, 'the push trigger has a branch filter')
  return line.replace(/^ {4}branches:\s*\[|\]\s*$/g, '').split(',').map((name) => name.trim().replace(/^['"]|['"]$/g, ''))
}

const jobCondition = (lines) => (lines.find((line) => /^ {4}if:/.test(line)) ?? '').replace(/^ {4}if:\s*/, '')
// A condition limits a job to main when it has no `||`, no negation and no
// parentheses, and one of its `&&` terms is the main check.
const MAIN_CHECKS = ["github.ref == 'refs/heads/main'", "github.event.workflow_run.head_branch == 'main'", "workflow_run.head_branch == 'main'"]
const forMainOnly = (condition) => !/\|\||!(?!=)|[()]/.test(condition)
  && condition.split('&&').map((term) => term.trim()).some((term) => MAIN_CHECKS.includes(term))
// A condition that names main in any form limits a job to it, or tries to.
const namesMain = (condition) => /refs\/heads\/main|ref_name == 'main'|head_branch == 'main'/.test(condition)

// Every job of each workflow, by kind. A job that is not listed fails the
// test, so a new job is classified before it can run on `2.x`.
const WORKFLOWS = {
  'export-kit.yml': { test: ['test', 'parity'], release: ['dispatch'] },
  'platform-browser.yml': { test: ['windows', 'safari', 'webkit-floor', 'firefox-floor'], release: [] },
  'downstream.yml': { test: [], release: ['notify'] },
}

// A Windows checkout gives the workflow files CRLF line ends.
test('the contract reads workflow text with CRLF line ends as it reads LF text', () => {
  for (const name of Object.keys(WORKFLOWS)) {
    const text = workflow(name).replace(/\r\n/g, '\n')
    const crlf = text.replace(/\n/g, '\r\n')
    assert.deepEqual(triggers(crlf), triggers(text), name)
    assert.deepEqual(jobs(crlf), jobs(text), name)
  }
})

test('each workflow has only the jobs this contract classifies', () => {
  const files = readdirSync(new URL('../.github/workflows/', import.meta.url)).filter((file) => /\.ya?ml$/.test(file))
  assert.deepEqual(files.sort(), Object.keys(WORKFLOWS).sort(), 'every workflow file is classified')
  for (const [name, kinds] of Object.entries(WORKFLOWS)) {
    assert.deepEqual(Object.keys(jobs(workflow(name))).sort(), [...kinds.test, ...kinds.release].sort(), name)
  }
})

test('the test jobs run on pushes to main and to 2.x', () => {
  for (const [name, kinds] of Object.entries(WORKFLOWS)) {
    if (kinds.test.length === 0) continue
    const text = workflow(name)
    const branches = pushBranches(text)
    assert.ok(branches.includes('main') && branches.includes('2.x'), `${name} pushes run on ${branches.join(', ')}`)
    const byName = jobs(text)
    for (const job of kinds.test) {
      assert.ok(!namesMain(jobCondition(byName[job])), `${name} ${job} is not limited to main`)
    }
  }
})

test('every release, notice or dispatch job runs only for main', () => {
  for (const [name, kinds] of Object.entries(WORKFLOWS)) {
    const text = workflow(name)
    const on = triggers(text)
    // A branch filter limits a job to main only when every trigger of the
    // workflow is a push filtered to main alone.
    const filteredToMain = Object.keys(on).every((trigger) => trigger === 'push') && pushBranches(text).join() === 'main'
      && !on.push.some((line) => /^ {4}tags(-ignore)?:/.test(line))
    const byName = jobs(text)
    for (const job of kinds.release) {
      assert.ok(filteredToMain || forMainOnly(jobCondition(byName[job])), `${name} ${job} runs only for main`)
    }
  }
})
