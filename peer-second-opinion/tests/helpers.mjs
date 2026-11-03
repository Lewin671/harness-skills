// Shared fixtures for the peer.mjs tests: a git repository, fake codex and
// agy CLIs, and a runner. Each fake records every invocation as one JSON line
// ({ argv }) in FAKE_LOG; FAKE_* variables steer what it prints:
//
//   FAKE_SESSION_ID  session they report (default SESSION); FAKE_NO_SESSION
//   FAKE_RESULT_TEXT body text; FAKE_BIG_RESULT a 20000-line body; FAKE_NO_RESULT
//   FAKE_EXIT        exit code; FAKE_STDERR_TEXT one stderr line
//   FAKE_SLEEP       seconds to stall after reporting the session
//   FAKE_SPAWN_CHILD file to write the pid of a `sleep 300` grandchild into
//   FAKE_WRITE       file to create during the run (drift, build output)
//   FAKE_EVENT       one extra raw stdout line
//   FAKE_RESULT_STATUS, FAKE_RESULT_ERROR, FAKE_FINISHED_REASON  (agy only)
//                    fields of the closing result event

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

export const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'peer.mjs')
export const SESSION = '11111111-2222-3333-4444-555555555555'
export const OTHER_SESSION = '99999999-8888-7777-6666-555555555555'
// The note's load-bearing parts: no sandbox, no repository or git changes,
// and a Verification paragraph.
export const NOTE = /This is a second opinion, run headlessly with the user's own shell and no sandbox\.[^]*Do not modify the repository[^]*no git state changes \(no commit, checkout, switch, reset, restore, stash[^]*starts with "Verification:"/

const FAKE_CODEX = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const env = process.env
const argv = process.argv.slice(2)
if (env.FAKE_LOG) fs.appendFileSync(env.FAKE_LOG, JSON.stringify({ argv }) + '\\n')
if (env.FAKE_STDERR_TEXT) process.stderr.write(env.FAKE_STDERR_TEXT + '\\n')
if (env.FAKE_WRITE) {
  fs.mkdirSync(path.dirname(env.FAKE_WRITE), { recursive: true })
  fs.writeFileSync(env.FAKE_WRITE, 'written during the run\\n')
}
if (env.FAKE_SPAWN_CHILD) {
  const child = require('node:child_process').spawn('sleep', ['300'], { stdio: 'ignore' })
  fs.writeFileSync(env.FAKE_SPAWN_CHILD, String(child.pid))
}
const sleep = () => { if (env.FAKE_SLEEP) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(env.FAKE_SLEEP) * 1000) }
const session = env.FAKE_SESSION_ID || '${SESSION}'
const body = env.FAKE_BIG_RESULT
  ? Array.from({ length: 20000 }, (_, i) => 'model text line ' + i).join('\\n')
  : (env.FAKE_RESULT_TEXT || 'the fake result body')
const frame = (value) => fs.writeSync(1, JSON.stringify(value) + '\\n')
if (argv[0] !== 'exec') process.exit(64)
if (!env.FAKE_NO_SESSION) frame({ type: 'thread.started', thread_id: session })
sleep()
if (env.FAKE_EVENT) fs.writeSync(1, env.FAKE_EVENT + '\\n')
process.stderr.write('free text from codex\\n')
if (!env.FAKE_NO_RESULT) fs.writeFileSync(argv[argv.indexOf('-o') + 1], body + '\\n')
process.exitCode = Number(env.FAKE_EXIT || 0)
`

// agy reads the prompt from --print=TEXT and reports everything as
// stream-json events, the answer in the closing result event.
const FAKE_AGY = `#!/usr/bin/env node
const fs = require('node:fs')
const env = process.env
const argv = process.argv.slice(2)
if (env.FAKE_LOG) fs.appendFileSync(env.FAKE_LOG, JSON.stringify({ argv }) + '\\n')
if (env.FAKE_STDERR_TEXT) process.stderr.write(env.FAKE_STDERR_TEXT + '\\n')
const sleep = () => { if (env.FAKE_SLEEP) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(env.FAKE_SLEEP) * 1000) }
const session = env.FAKE_NO_SESSION ? undefined : (env.FAKE_SESSION_ID || '${SESSION}')
const body = env.FAKE_RESULT_TEXT || 'the fake result body'
const frame = (value) => fs.writeSync(1, JSON.stringify(value) + '\\n')
if (!argv.some((arg) => arg.startsWith('--print='))) process.exit(64)
frame({ event: 'init', conversation_id: session, init: { model: argv[argv.indexOf('--model') + 1], tools: [] } })
sleep()
frame({ event: 'step_update', step_update: { conversation_id: session, step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'streamed answer text' } })
if (env.FAKE_EVENT) fs.writeSync(1, env.FAKE_EVENT + '\\n')
if (!env.FAKE_NO_RESULT) {
  const result = { conversation_id: session, status: env.FAKE_RESULT_STATUS || 'SUCCESS', response: env.FAKE_RESULT_STATUS ? '' : body + '\\n' }
  if (env.FAKE_RESULT_ERROR) result.error = env.FAKE_RESULT_ERROR
  if (env.FAKE_FINISHED_REASON) result.finished_reason = env.FAKE_FINISHED_REASON
  frame({ event: 'result', result })
}
process.exitCode = Number(env.FAKE_EXIT || 0)
`

export function sh(command, cwd) {
  const result = spawnSync('/bin/sh', ['-c', command], { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, `setup command failed: ${command}\n${result.stderr}`)
  return result.stdout
}

// A repository with one commit: tracked.txt plus a .gitignore for build/.
export function makeRepo(dir) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'tracked.txt'), 'committed\n')
  writeFileSync(join(dir, '.gitignore'), 'build/\n')
  sh('git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -q -m init', dir)
  return dir
}

export function installFake(dir, name = 'codex') {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, name === 'agy' ? FAKE_AGY : FAKE_CODEX)
  chmodSync(path, 0o755)
  return path
}

// One fixture per test file: a scratch root, a repository, and the fake.
export function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'peer-test-'))
  mkdirSync(join(root, 'home'))
  const bin = installFake(join(root, 'bin'))
  const agyBin = installFake(join(root, 'bin'), 'agy')
  const fixture = {
    root,
    repo: makeRepo(join(root, 'repo')),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    // The environment a run gets; `env` entries override it, and an
    // undefined value removes a variable.
    env(env = {}) {
      const merged = { PATH: process.env.PATH, HOME: join(root, 'home'), TMPDIR: root, CODEX_BIN: bin, AGY_BIN: agyBin, ...env }
      for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key]
      return merged
    },
    // Runs `peer.mjs <provider>` (default codex) and attaches what the fake
    // saw: calls[i] = { argv, prompt }, the prompt being the argument after
    // `--` or the value of --print=.
    run(args, { env = {}, cwd = fixture.repo, provider = 'codex' } = {}) {
      const log = join(mkdtempSync(join(root, 'log-')), 'calls.jsonl')
      const result = spawnSync(process.execPath, [SCRIPT, provider, ...args], {
        cwd, encoding: 'utf8', timeout: 60000, env: fixture.env({ FAKE_LOG: log, ...env }),
      })
      result.calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => {
        const call = JSON.parse(line)
        const print = call.argv.find((arg) => arg.startsWith('--print='))
        call.prompt = print ? print.slice('--print='.length) : call.argv[call.argv.indexOf('--') + 1] ?? ''
        return call
      }) : []
      return result
    },
    // stdout and stderr merged through a real pipe, as a caller reading
    // `2>&1 | ...` sees them.
    runMerged(args, env = {}) {
      const file = join(mkdtempSync(join(root, 'merged-')), 'merged.txt')
      const command = `"${process.execPath}" "${SCRIPT}" codex ${args.join(' ')} 2>&1 | cat > "${file}"`
      const result = spawnSync('/bin/sh', ['-c', command], { cwd: fixture.repo, encoding: 'utf8', timeout: 60000, env: fixture.env(env) })
      assert.equal(result.status, 0, result.stderr)
      return readFileSync(file, 'utf8')
    },
    // Edits tracked.txt for the duration of fn.
    dirty(fn) {
      writeFileSync(join(fixture.repo, 'tracked.txt'), 'changed\n')
      try { return fn() } finally { writeFileSync(join(fixture.repo, 'tracked.txt'), 'committed\n') }
    },
  }
  return fixture
}

export function marker(stderr, name) {
  return stderr.split('\n').filter((line) => line.startsWith(`${name}: `)).map((line) => line.slice(name.length + 2))
}

// Polls until the pid is gone; fails (after killing it) if it survives.
export async function assertGone(pid) {
  for (let i = 0; i < 50; i += 1) {
    try { process.kill(pid, 0) } catch { return }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  try { process.kill(pid, 'SIGKILL') } catch {}
  assert.fail(`process ${pid} survived the process-group kill`)
}
