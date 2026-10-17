// Smoke tests for `peer.mjs auto`, run with `node --test`. Each test builds a
// bin directory holding `node` and whichever fake CLIs it needs, and runs with
// that as the whole PATH (plus /usr/bin:/bin), so a real codex or cmd on the
// machine cannot be picked up. The fakes print nothing; what is checked is
// which one the wrapper chose, before any model output matters.

import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, '..', 'peer.mjs')

let root

before(() => {
  root = mkdtempSync(join(tmpdir(), 'peer-auto-'))
  mkdirSync(join(root, 'home'))
})

after(() => {
  rmSync(root, { recursive: true, force: true })
})

function binDir(...clis) {
  const dir = mkdtempSync(join(root, 'bin-'))
  symlinkSync(process.execPath, join(dir, 'node'))
  for (const name of clis) {
    const path = join(dir, name)
    writeFileSync(path, `#!/bin/sh\necho "$0" >> "$FAKE_RAN"\nexit 1\n`)
    chmodSync(path, 0o755)
  }
  return dir
}

function run(dir, args) {
  const ran = join(mkdtempSync(join(root, 'ran-')), 'ran.log')
  const result = spawnSync(process.execPath, [SCRIPT, 'auto', ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
    env: { PATH: `${dir}:/usr/bin:/bin`, HOME: join(root, 'home'), TMPDIR: root, FAKE_RAN: ran },
  })
  result.ran = existsSync(ran) ? readFileSync(ran, 'utf8').split('\n').filter(Boolean) : []
  return result
}

test('auto prefers codex when both CLIs are installed', () => {
  const dir = binDir('codex', 'cmd')
  const result = run(dir, ['consult', '--', 'q'])
  assert.match(result.stderr, /^note: auto selected codex\n/m)
  assert.deepEqual(result.ran, [join(dir, 'codex')])
})

test('auto falls back to command-code when codex is missing', () => {
  const dir = binDir('cmd')
  const result = run(dir, ['consult', '--', 'q'])
  assert.match(result.stderr, /^note: auto selected command-code \('codex' not found\)$/m)
  assert.deepEqual(result.ran, [join(dir, 'cmd')])
})

test('auto with neither CLI exits 3 before running anything', () => {
  const result = run(binDir(), ['consult', '--', 'q'])
  assert.equal(result.status, 3, result.stderr)
  assert.match(result.stderr, /auto found no peer CLI: none of 'codex', 'cmd'/)
  assert.ok(!/note: auto selected/.test(result.stderr))
})

test('auto refuses options that belong to one CLI, before choosing', () => {
  const dir = binDir('codex', 'cmd')
  for (const args of [
    ['consult', '--resume', '01a147af-d927-7312-897c-9c498081128f', '--', 'q'],
    ['consult', '--model', 'm', '--effort', 'high', '--', 'q'],
  ]) {
    const result = run(dir, args)
    assert.equal(result.status, 3, result.stderr)
    assert.match(result.stderr, /auto does not take --(resume|model)/)
    assert.ok(!/note: auto selected/.test(result.stderr), 'refused before a CLI was chosen')
    assert.deepEqual(result.ran, [])
  }
})

test('a question after -- may mention those flags', () => {
  const result = run(binDir('cmd'), ['consult', '--', '--model'])
  assert.match(result.stderr, /note: auto selected command-code/)
})

test('restrictions apply to options, not to option values', () => {
  const dir = binDir('cmd')
  const valued = run(dir, ['review', '--context', '--model'])
  assert.match(valued.stderr, /note: auto selected command-code/, 'a --context value that looks like a flag is accepted')
  const smuggled = run(dir, ['review', '--context', '--', '--model', 'm', '--effort', 'high'])
  assert.equal(smuggled.status, 3, smuggled.stderr)
  assert.match(smuggled.stderr, /auto does not take --model/, 'a -- inside a value does not end option parsing')
})
