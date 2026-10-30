// Shared fixtures for the peer.mjs tests: a git repository, fake codex and
// cmd CLIs, and a runner. The fakes record every invocation as one JSON line
// ({ argv, stdin }) in FAKE_LOG; FAKE_* variables steer what they print:
//
//   FAKE_SESSION_ID  session they report (default SESSION); FAKE_NO_SESSION
//   FAKE_RESULT_TEXT body text; FAKE_BIG_RESULT a 20000-line body; FAKE_NO_RESULT
//   FAKE_EXIT        exit code; FAKE_STDERR_TEXT one stderr line
//   FAKE_SLEEP       seconds to stall after reporting the session
//   FAKE_SPAWN_CHILD file to write the pid of a `sleep 300` grandchild into
//   FAKE_WRITE       file to create during the run (drift, build output)
//   codex only:      FAKE_EVENT one extra raw stdout line
//   cmd only:        FAKE_MODEL, FAKE_SUBTYPE, FAKE_ERROR_TEXT, FAKE_WORKDIR, FAKE_BLOCKED

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

export const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'peer.mjs')
export const SESSION = '11111111-2222-3333-4444-555555555555'
export const OTHER_SESSION = '99999999-8888-7777-6666-555555555555'
// The note's load-bearing parts: no sandbox, no repository or git changes,
// and a Verification paragraph.
export const NOTE = /This is a second opinion, run headlessly with the user's own shell and no sandbox\.[^]*Do not modify the repository[^]*no git state changes \(no commit, checkout, switch, reset, restore, stash[^]*starts with "Verification:"/

const COMMON = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const env = process.env
const argv = process.argv.slice(2)
let stdin = ''
try { stdin = fs.readFileSync(0, 'utf8') } catch {}
if (env.FAKE_LOG) fs.appendFileSync(env.FAKE_LOG, JSON.stringify({ argv, stdin }) + '\\n')
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
// Small frames before a stall go out synchronously; the sleep blocks the
// event loop an async write would need.
const frame = (value) => fs.writeSync(1, JSON.stringify(value) + '\\n')
// Not process.exit(): a large stdout write to a pipe is asynchronous.
const finish = () => { process.exitCode = Number(env.FAKE_EXIT || 0) }
`

const FAKE_CODEX = `${COMMON}
if (argv[0] !== 'exec') process.exit(64)
if (!env.FAKE_NO_SESSION) frame({ type: 'thread.started', thread_id: session })
sleep()
if (env.FAKE_EVENT) fs.writeSync(1, env.FAKE_EVENT + '\\n')
process.stderr.write('free text from codex\\n')
if (!env.FAKE_NO_RESULT) fs.writeFileSync(argv[argv.indexOf('-o') + 1], body + '\\n')
finish()
`

const FAKE_CMD = `${COMMON}
const model = env.FAKE_MODEL || 'fake/model-1'
if (!env.FAKE_NO_SESSION) frame({ type: 'event', event: { type: 'run_start', sessionId: session } })
frame({ type: 'event', event: { type: 'model_request_start', model } })
sleep()
const lines = []
if (env.FAKE_WORKDIR) {
  lines.push({ type: 'event', event: { type: 'run_end', result: { nextState: { modState: { workspace: { cwd: env.FAKE_WORKDIR } } } } } })
}
lines.push({ type: 'event', event: { type: 'tool_queued', toolName: 'shell_command', input: { command: 'git log --oneline -1' } } })
if (env.FAKE_BLOCKED) lines.push({ type: 'event', event: { type: 'tool_hook_blocked', toolName: 'shell_command' } })
if (!env.FAKE_NO_RESULT) {
  const subtype = env.FAKE_SUBTYPE || 'success'
  const result = { type: 'result', subtype, usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 1 }, durationMs: 7, finalText: body }
  if (subtype === 'error') {
    result.finalText = ''
    result.error = env.FAKE_ERROR_TEXT || 'Error: something failed'
  } else if (!env.FAKE_NO_SESSION) {
    result.sessionId = session
  }
  lines.push(result)
}
process.stdout.write(lines.map((line) => JSON.stringify(line)).join('\\n') + '\\n')
finish()
`

export const PROVIDERS = {
  codex: { binary: 'codex', envVar: 'CODEX_BIN', source: FAKE_CODEX },
  'command-code': { binary: 'cmd', envVar: 'COMMAND_CODE_BIN', source: FAKE_CMD },
}

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

export function installFake(dir, provider) {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, PROVIDERS[provider].binary)
  writeFileSync(path, PROVIDERS[provider].source)
  chmodSync(path, 0o755)
  return path
}

// One fixture per test file: a scratch root, a repository, and both fakes in
// a bin directory that also holds `node`, so a PATH of just that directory
// still runs them.
export function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'peer-test-'))
  mkdirSync(join(root, 'home'))
  const bin = join(root, 'bin')
  installFake(bin, 'codex')
  installFake(bin, 'command-code')
  symlinkSync(process.execPath, join(bin, 'node'))
  const fixture = {
    root,
    bin,
    repo: makeRepo(join(root, 'repo')),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    // The environment a run gets; `env` entries override it, and an
    // undefined value removes a variable.
    env(provider, env = {}) {
      const merged = { PATH: process.env.PATH, HOME: join(root, 'home'), TMPDIR: root }
      const known = PROVIDERS[provider]
      if (known) merged[known.envVar] = join(bin, known.binary)
      Object.assign(merged, env)
      for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key]
      return merged
    },
    // Runs peer.mjs and attaches what the fake saw: calls[i] = { argv, stdin,
    // prompt } where prompt is stdin or the argv after `--`.
    run(provider, args, { env = {}, cwd = fixture.repo } = {}) {
      const log = join(mkdtempSync(join(root, 'log-')), 'calls.jsonl')
      const result = spawnSync(process.execPath, [SCRIPT, provider, ...args], {
        cwd, encoding: 'utf8', timeout: 60000, env: fixture.env(provider, { FAKE_LOG: log, ...env }),
      })
      result.calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => {
        const call = JSON.parse(line)
        const dash = call.argv.indexOf('--')
        call.prompt = call.stdin || (dash >= 0 ? call.argv.slice(dash + 1).join(' ') : '')
        return call
      }) : []
      return result
    },
    // stdout and stderr merged through a real pipe, as a caller reading
    // `2>&1 | ...` sees them.
    runMerged(provider, args, env = {}) {
      const file = join(mkdtempSync(join(root, 'merged-')), 'merged.txt')
      const command = `"${process.execPath}" "${SCRIPT}" ${provider} ${args.join(' ')} 2>&1 | cat > "${file}"`
      const result = spawnSync('/bin/sh', ['-c', command], { cwd: fixture.repo, encoding: 'utf8', timeout: 60000, env: fixture.env(provider, env) })
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
