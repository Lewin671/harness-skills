// Boundary-focused smoke tests for run-command-code-second-opinion.mjs, run
// with `node --test`. A fake cmd binary (written per-test into a scratch
// directory) stands in for the real CLI; FAKE_* environment variables steer its
// behaviour and it appends every invocation's argv to FAKE_ARGV_LOG.

import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, '..', 'run-command-code-second-opinion.mjs')

// Flags that would widen the run's authority. The wrapper must never emit one,
// whatever a caller passes: the run inherits the user's configured permission
// mode and nothing else.
const AUTHORITY_FLAGS = ['--yolo', '--dangerously-skip-permissions', '--accept-edits', '--permission-mode', '--plan', '--tools-all']

const FAKE_CMD = `#!/usr/bin/env node
// Fake cmd CLI for smoke tests.
const fs = require('node:fs')
const argv = process.argv.slice(2)
if (process.env.FAKE_ARGV_LOG) fs.appendFileSync(process.env.FAKE_ARGV_LOG, argv.join(' ') + '\\n')
let prompt = ''
try { prompt = fs.readFileSync(0, 'utf8') } catch {}
if (process.env.FAKE_PROMPT_FILE) fs.writeFileSync(process.env.FAKE_PROMPT_FILE, prompt)
if (process.env.FAKE_STDERR_TEXT) process.stderr.write(process.env.FAKE_STDERR_TEXT + '\\n')
if (process.env.FAKE_MUTATE_SOURCE) {
  const target = process.env.FAKE_MUTATE_SOURCE
  fs.mkdirSync(require('node:path').dirname(target), { recursive: true })
  fs.writeFileSync(target, 'drifted during the run\\n')
}
if (process.env.FAKE_SPAWN_CHILD) {
  const { spawn } = require('node:child_process')
  const child = spawn('sleep', ['300'], { stdio: 'ignore' })
  fs.writeFileSync(process.env.FAKE_CHILD_PID_FILE, String(child.pid))
}
if (process.env.FAKE_SLEEP) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.FAKE_SLEEP) * 1000)
}
const sessionId = process.env.FAKE_SESSION_ID || '11111111-2222-3333-4444-555555555555'
const model = process.env.FAKE_MODEL || 'fake/model-1'
const lines = []
if (!process.env.FAKE_NO_SESSION) {
  lines.push(JSON.stringify({ type: 'event', event: { type: 'run_start', sessionId } }))
}
lines.push(JSON.stringify({ type: 'event', event: { type: 'model_request_start', model } }))
if (process.env.FAKE_BLOCKED) {
  lines.push(JSON.stringify({ type: 'event', event: { type: 'tool_hook_blocked', toolName: 'shell_command', hookOutput: 'Error: requires permissions.' } }))
}
if (!process.env.FAKE_NO_RESULT) {
  const subtype = process.env.FAKE_SUBTYPE || 'success'
  const finalText = process.env.FAKE_BIG_RESULT
    ? Array.from({ length: 20000 }, (_, i) => 'model text line ' + i).join('\\n')
    : (process.env.FAKE_RESULT_TEXT || 'the fake report body')
  const result = {
    type: 'result', subtype, stopReason: 'end_turn',
    usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 1 },
    durationMs: 7, finalText,
  }
  if (subtype === 'error') {
    result.finalText = ''
    result.error = process.env.FAKE_ERROR_TEXT || 'Error: something failed'
    delete result.sessionId
  } else if (process.env.FAKE_NO_SESSION) {
    delete result.sessionId
  } else {
    result.sessionId = sessionId
  }
  lines.push(JSON.stringify(result))
}
process.stdout.write(lines.join('\\n') + '\\n')
// Not process.exit(): stdout to a pipe is asynchronous, and exiting
// immediately truncates a large write — which is exactly the failure a wrapper
// reading frames off a pipe has to survive.
process.exitCode = Number(process.env.FAKE_EXIT || 0)
`

let root
let repo
let cmdBin

function sh(command, options = {}) {
  const result = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8', ...options })
  assert.equal(result.status, 0, `setup command failed: ${command}\n${result.stderr}`)
  return result
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'cmd-second-opinion-'))
  repo = join(root, 'repo')
  mkdirSync(repo)
  sh('git init -q', { cwd: repo })
  writeFileSync(join(repo, 'tracked.txt'), 'committed\n')
  // An ignored path is where a delegated write is most likely to land unnoticed.
  writeFileSync(join(repo, '.gitignore'), 'build/\n')
  sh('git add tracked.txt .gitignore && git -c user.email=t@t -c user.name=t commit -q -m init', { cwd: repo })
  cmdBin = join(root, 'bin', 'cmd')
  mkdirSync(dirname(cmdBin))
  writeFileSync(cmdBin, FAKE_CMD)
  chmodSync(cmdBin, 0o755)
  mkdirSync(join(root, 'home'))
})

after(() => {
  rmSync(root, { recursive: true, force: true })
})

function run(args, extraEnv = {}, cwd = repo) {
  const argvLog = join(mkdtempSync(join(root, 'argv-')), 'argv.log')
  const promptFile = join(mkdtempSync(join(root, 'prompt-')), 'prompt.txt')
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      PATH: process.env.PATH,
      HOME: join(root, 'home'),
      TMPDIR: root,
      COMMAND_CODE_BIN: cmdBin,
      FAKE_ARGV_LOG: argvLog,
      FAKE_PROMPT_FILE: promptFile,
      ...extraEnv,
    },
  })
  result.argv = existsSync(argvLog) ? readFileSync(argvLog, 'utf8').split('\n').filter(Boolean) : []
  result.prompt = existsSync(promptFile) ? readFileSync(promptFile, 'utf8') : ''
  return result
}

function dirty() {
  writeFileSync(join(repo, 'tracked.txt'), 'changed\n')
}

function clean() {
  writeFileSync(join(repo, 'tracked.txt'), 'committed\n')
}

test('argument and mode errors exit 11 before the CLI runs', () => {
  for (const args of [
    [],
    ['frobnicate'],
    ['review', '--model', 'fake-model'], // --model without --effort
    ['review', '--effort', 'high'], // --effort without --model
    ['review', '--timeout', '0'],
    ['review', '--timeout', 'soon'],
    ['review', '--max-turns', 'x'],
    ['review', '--base', 'main', '--commit', 'HEAD'], // two scopes
    ['review', '--custom', 'look here', '--context', 'background'],
    ['review', '--nonsense'],
    ['review', '--commit'], // missing value
    ['consult'], // no question
    ['consult', '--resume', 'not-a-uuid', 'question'],
    ['consult', 'question one', 'question two'],
    ['consult', '--not-a-flag'], // a dash-leading question needs the -- separator
  ]) {
    const result = run(args)
    assert.equal(result.status, 11, `expected 11 for ${JSON.stringify(args)}: ${result.stderr}`)
    assert.equal(result.argv.length, 0, `the CLI must not run for ${JSON.stringify(args)}`)
  }
})

test('a dash-leading question is accepted after the -- separator', () => {
  const result = run(['consult', '--', '--not-a-flag, but a question'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.prompt, '--not-a-flag, but a question')
})

test('--help exits 0 without running the CLI', () => {
  for (const args of [['--help'], ['review', '--help'], ['consult', '--help']]) {
    const result = run(args)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.argv.length, 0)
  }
})

test('a half-set env pair still allows --help but fails a real run', () => {
  const extraEnv = { COMMAND_CODE_SECOND_OPINION_MODEL: 'fake/model-1' }
  const help = run(['review', '--help'], extraEnv)
  assert.equal(help.status, 0, help.stderr)
  const real = run(['review', '--commit', 'HEAD'], extraEnv)
  assert.equal(real.status, 11, real.stderr)
  assert.match(real.stderr, /must be set together/)
  assert.equal(real.argv.length, 0)
})

test('review of a clean tree exits 2 before any CLI invocation', () => {
  clean()
  const result = run(['review', '--uncommitted'])
  assert.equal(result.status, 2, result.stderr)
  assert.match(result.stderr, /nothing to review/)
  assert.equal(result.argv.length, 0)
})

test('base review with no changes since the merge base exits 2', () => {
  clean()
  const result = run(['review', '--base', 'HEAD'])
  assert.equal(result.status, 2, result.stderr)
  assert.match(result.stderr, /nothing to review: no changes since the merge base with HEAD/)
  assert.equal(result.argv.length, 0)
})

test('an unknown ref or commit exits 11, not 2', () => {
  clean()
  const base = run(['review', '--base', 'no-such-ref'])
  assert.equal(base.status, 11, base.stderr)
  assert.match(base.stderr, /no such branch or ref/)
  const commit = run(['review', '--commit', 'no-such-commit'])
  assert.equal(commit.status, 11, commit.stderr)
  assert.match(commit.stderr, /no such commit/)
  assert.equal(base.argv.length + commit.argv.length, 0)
})

test('review outside a git work tree exits 11 while consult proceeds', () => {
  const bare = join(root, 'bare.git')
  sh(`git init -q --bare "${bare}"`)
  const review = run(['review', '--uncommitted'], {}, bare)
  assert.equal(review.status, 11, review.stderr)
  assert.match(review.stderr, /not a git work tree/)
  assert.equal(review.argv.length, 0, 'the CLI must not run outside a work tree for a review')

  const consult = run(['consult', '--', 'a question'], {}, bare)
  assert.equal(consult.status, 0, consult.stderr)
  assert.match(consult.stdout, /the fake report body/)
})

test('a review never widens authority and never passes a permission flag', () => {
  dirty()
  try {
    const result = run(['review', '--uncommitted'])
    assert.equal(result.status, 0, result.stderr)
    assert.ok(result.argv.length >= 1)
    for (const line of result.argv) {
      for (const flag of AUTHORITY_FLAGS) {
        assert.ok(!line.includes(flag), `${flag} must never appear in: ${line}`)
      }
      assert.ok(line.startsWith('-p '), `every invocation starts with -p: ${line}`)
      for (const required of ['--output-format json', '--skip-onboarding', '--no-skills', '--no-session']) {
        assert.ok(line.includes(required), `missing ${required} in: ${line}`)
      }
      // No model is pinned by default: the run uses whatever the CLI is
      // configured to use, and an explicit pair is the only thing that moves it.
      assert.ok(!line.includes('--model'), `an unpinned review must not select a model: ${line}`)
    }
  } finally {
    clean()
  }
})

test('the review prompt carries the wrapper-built diff and the report contract', () => {
  dirty()
  try {
    const result = run(['review', '--uncommitted'])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.prompt, /-committed/)
    assert.match(result.prompt, /\+changed/)
    assert.match(result.prompt, /\[P0\]/)
    assert.match(result.prompt, /Do not modify any files/)
    assert.match(result.prompt, /git status --porcelain/)
    // The reviewer is told to read untracked files rather than being handed them.
    writeFileSync(join(repo, 'fresh.txt'), 'new\n')
    const withUntracked = run(['review', '--uncommitted'])
    assert.match(withUntracked.prompt, /Untracked files/)
    assert.match(withUntracked.prompt, /fresh\.txt/)
  } finally {
    rmSync(join(repo, 'fresh.txt'), { force: true })
    clean()
  }
})

test('markers, prefixes and usage land where the output protocol says', () => {
  dirty()
  try {
    const result = run(['review', '--uncommitted'])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /the fake report body/)
    assert.match(result.stderr, /^note: using cmd binary: /m)
    assert.match(result.stderr, /^identity: [0-9a-f]{64}$/m)
    assert.match(result.stderr, /^model: fake\/model-1$/m)
    assert.match(result.stderr, /^usage: input=11 output=3 cacheRead=1 durationMs=7$/m)
    assert.match(result.stderr, /^report: /m)
    assert.match(result.stderr, /^log: /m)
    // CLI-controlled lines are prefixed; wrapper lines are not
    assert.match(result.stderr, /^cmd> \{"type":"event"/m)
    // a review advertises no resumable session
    assert.ok(!/^session: /m.test(result.stderr), 'a review must not offer a resume')
    assert.ok(!/^resume: /m.test(result.stderr), 'a review must not offer a resume')
    // the identity marker reprints after the body so a merged stream keeps the
    // last marker of each kind the wrapper's
    assert.ok(result.stderr.lastIndexOf('identity: ') > result.stderr.indexOf('report: '))
  } finally {
    clean()
  }
})

test('a refused tool call during the run qualifies the result', () => {
  dirty()
  try {
    const result = run(['review', '--uncommitted'], { FAKE_BLOCKED: '1' })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stderr, /^warning: the permission engine refused 1 tool call\(s\)/m)
  } finally {
    clean()
  }
})

test('drift during the run is reported and voids identity, but still yields the report', () => {
  dirty()
  try {
    const result = run(['review', '--uncommitted'], { FAKE_MUTATE_SOURCE: join(repo, 'stray.txt') })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stderr, /^warning: the tree changed while this run was in progress/m)
    assert.match(result.stderr, /not identity-verified/)
    assert.match(result.stdout, /the fake report body/)
    // The two identity lines differ, and the last one prints after the body.
    const identities = result.stderr.match(/^identity: [0-9a-f]{64}$/gm)
    assert.equal(identities.length, 2, result.stderr)
    assert.notEqual(identities[0], identities[1])
  } finally {
    rmSync(join(repo, 'stray.txt'), { force: true })
    clean()
  }
})

test('a write into an ignored path during the run is caught', () => {
  dirty()
  try {
    // build/ is gitignored, so `--untracked-files=normal` alone would report a
    // clean status and the identity would certify bytes the run had changed.
    const result = run(['review', '--uncommitted'], { FAKE_MUTATE_SOURCE: join(repo, 'build', 'out.txt') })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stderr, /^warning: the tree changed while this run was in progress/m)
    assert.ok(existsSync(join(repo, 'build', 'out.txt')), 'the fake CLI wrote the ignored path')
  } finally {
    rmSync(join(repo, 'build'), { recursive: true, force: true })
    clean()
  }
})

test('a truncated run (turn cap) still yields a usable body with a warning', () => {
  dirty()
  try {
    const result = run(['review', '--uncommitted'], { FAKE_SUBTYPE: 'max_turns', FAKE_EXIT: '8' })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stderr, /^warning: the run hit its turn cap/m)
    assert.match(result.stdout, /the fake report body/)
  } finally {
    clean()
  }
})

test('the turn cap is flagged from either signal, code or subtype', () => {
  dirty()
  try {
    // Exit 8 with a `success` subtype still means the CLI stopped early.
    const byExitCode = run(['review', '--uncommitted'], { FAKE_EXIT: '8' })
    assert.equal(byExitCode.status, 0, byExitCode.stderr)
    assert.match(byExitCode.stderr, /^warning: the run hit its turn cap/m)

    const bySubtype = run(['review', '--uncommitted'], { FAKE_SUBTYPE: 'max_turns' })
    assert.equal(bySubtype.status, 0, bySubtype.stderr)
    assert.match(bySubtype.stderr, /^warning: the run hit its turn cap/m)
  } finally {
    clean()
  }
})

test('Command Code exit codes pass through unchanged', () => {
  dirty()
  try {
    for (const code of [1, 3, 4, 5, 6, 7, 9, 10]) {
      const result = run(['review', '--uncommitted'], { FAKE_EXIT: String(code), FAKE_SUBTYPE: 'error' })
      assert.equal(result.status, Number(code), `expected ${code}: ${result.stderr}`)
      assert.equal(result.stdout, '', `no body may be emitted for exit ${code}`)
      assert.equal(/^report: /m.test(result.stderr), false, `no report marker for exit ${code}`)
      const log = /^log: (.*)$/m.exec(result.stderr)
      assert.ok(log && existsSync(log[1]), 'the event log survives a failure')
    }
  } finally {
    clean()
  }
})

test('failure hints name the documented remedy', () => {
  dirty()
  try {
    const cases = [
      ['3', /not authenticated — run `cmd login`/],
      ['5', /rate limited/],
      ['10', /insufficient credits/],
      ['6', /transport or upstream failure/],
    ]
    for (const [code, pattern] of cases) {
      const result = run(['review', '--uncommitted'], { FAKE_EXIT: code, FAKE_SUBTYPE: 'error' })
      assert.match(result.stderr, pattern, `exit ${code} missing its hint: ${result.stderr}`)
    }
  } finally {
    clean()
  }
})

test('an empty result the CLI still calls success exits 11, not 0', () => {
  dirty()
  try {
    const result = run(['review', '--uncommitted'], { FAKE_NO_RESULT: '1' })
    assert.equal(result.status, 11, result.stderr)
    assert.match(result.stderr, /produced no report/)
  } finally {
    clean()
  }
})

test('a bogus resume target gets the start-fresh hint', () => {
  const result = run(['consult', '--resume', '00000000-0000-4000-8000-000000000000', '--', 'q'], {
    FAKE_EXIT: '1',
    FAKE_SUBTYPE: 'error',
    FAKE_ERROR_TEXT: 'Error: No session "00000000-0000-4000-8000-000000000000" found to resume.',
  })
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /no longer exists; start a fresh consultation/)
})

test('consult prints a resume line that is a complete runnable command', () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const result = run(['consult', '--', 'What do you think?'], { FAKE_SESSION_ID: id })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /the fake report body/)
  assert.match(result.stderr, new RegExp(`^session: ${id}$`, 'm'))
  const resume = /^resume: (.*)$/m.exec(result.stderr)[1]
  assert.ok(resume.includes('run-command-code-second-opinion.mjs'), resume)
  assert.ok(resume.includes(` consult --resume ${id}`), resume)
  assert.ok(resume.includes('--repo '), resume)
  // Nothing is pinned, so nothing travels with the follow-up either.
  assert.ok(!resume.includes('--model'), resume)

  // The printed line, plus a question, must run as-is.
  const follow = sh(`${resume} -- "follow-up"`, { env: { ...process.env, PATH: process.env.PATH, HOME: join(root, 'home'), TMPDIR: root, COMMAND_CODE_BIN: cmdBin, FAKE_SESSION_ID: id } })
  assert.match(follow.stdout, /the fake report body/)
})

test('an explicitly pinned model reaches the CLI and the resume line', () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const result = run(['consult', '--model', 'fake/model-9', '--effort', 'max', '--', 'q'], { FAKE_SESSION_ID: id })
  assert.equal(result.status, 0, result.stderr)
  assert.ok(result.argv.some((line) => line.includes('--model fake/model-9 --effort max')), result.argv.join('\n'))
  const resume = /^resume: (.*)$/m.exec(result.stderr)[1]
  assert.ok(resume.includes('--model fake/model-9 --effort max'), resume)
})

test('a consult resumed into a different session is discarded', () => {
  const asked = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const other = '99999999-8888-7777-6666-555555555555'
  const result = run(['consult', '--resume', asked, '--', 'follow-up'], { FAKE_SESSION_ID: other })
  assert.equal(result.status, 11, result.stderr)
  assert.match(result.stderr, /did not resume session/)
  assert.equal(result.stdout, '', 'a fresh-session answer must be discarded, not printed')
})

test('a resumed consult that reports no session is discarded, not passed off as deliberation', () => {
  const asked = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const result = run(['consult', '--resume', asked, '--', 'follow-up'], { FAKE_NO_SESSION: '1' })
  assert.equal(result.status, 11, result.stderr)
  assert.match(result.stderr, /could not be confirmed as a follow-up/)
  assert.equal(result.stdout, '', 'an unverifiable follow-up must be discarded, not printed')
})

test('a resumed consult passes --resume and keeps an unpinned run unpinned', () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const result = run(['consult', '--resume', id, '--', 'follow-up'], { FAKE_SESSION_ID: id })
  assert.equal(result.status, 0, result.stderr)
  assert.ok(result.argv.some((line) => line.startsWith(`-p --resume ${id} `)), result.argv.join('\n'))
  assert.ok(!result.argv[0].includes('--model'), 'an unpinned resume must not invent a model')
})

test('consult carries no scope precheck but still fingerprints', () => {
  clean()
  const result = run(['consult', '--', 'a question about nothing in particular'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /^identity: [0-9a-f]{64}$/m)
  // The prompt is the question verbatim: no wrapper framing on a blind consult.
  assert.equal(result.prompt, 'a question about nothing in particular')
})

test('a timeout exits 124 and kills the whole detached process group', async () => {
  const pidFile = join(mkdtempSync(join(root, 'pid-')), 'child.pid')
  dirty()
  try {
    const result = run(['review', '--uncommitted', '--timeout', '1'], {
      FAKE_SLEEP: '30',
      FAKE_SPAWN_CHILD: '1',
      FAKE_CHILD_PID_FILE: pidFile,
    })
    assert.equal(result.status, 124, result.stderr)
    assert.match(result.stderr, /exceeded 1s and was terminated/)
    const grandchild = Number(readFileSync(pidFile, 'utf8').trim())
    assert.ok(grandchild > 0)
    for (let i = 0; i < 50; i += 1) {
      try {
        process.kill(grandchild, 0)
      } catch {
        return // ESRCH: the grandchild is gone
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    try { process.kill(grandchild, 'SIGKILL') } catch {}
    assert.fail(`grandchild ${grandchild} survived the process-group kill`)
  } finally {
    clean()
  }
})

test('trailing markers print after a large body in a merged pipe stream', () => {
  dirty()
  try {
    const merged = join(mkdtempSync(join(root, 'merged-')), 'merged.txt')
    const argvLog = join(mkdtempSync(join(root, 'argv-')), 'argv.log')
    // A real pipe (not a file) so stdout writes are asynchronous: a body larger
    // than the pipe buffer stays queued while stderr would otherwise cut in.
    const result = spawnSync('/bin/sh', ['-c', `"${process.execPath}" "${SCRIPT}" review --uncommitted 2>&1 | cat > "${merged}"`], {
      cwd: repo,
      encoding: 'utf8',
      timeout: 60000,
      env: {
        PATH: process.env.PATH,
        HOME: join(root, 'home'),
        TMPDIR: root,
        COMMAND_CODE_BIN: cmdBin,
        FAKE_ARGV_LOG: argvLog,
        FAKE_BIG_RESULT: '1',
      },
    })
    assert.equal(result.status, 0, result.stderr)
    const observed = readFileSync(merged, 'utf8')
    const bodyEnd = observed.indexOf('model text line 19999')
    assert.ok(bodyEnd >= 0, 'the large body must reach the merged stream')
    assert.ok(observed.lastIndexOf('\nreport: ') > bodyEnd, 'the report marker must follow the whole body')
    assert.ok(observed.lastIndexOf('\nlog: ') > bodyEnd, 'the log marker must follow the whole body')
    assert.ok(observed.lastIndexOf('\nidentity: ') > bodyEnd, 'the identity marker must follow the whole body')
  } finally {
    clean()
  }
})

test('COMMAND_CODE_BIN is validated before anything runs', () => {
  dirty()
  try {
    const relative = run(['review', '--uncommitted'], { COMMAND_CODE_BIN: 'bin/cmd' })
    assert.equal(relative.status, 11, relative.stderr)
    assert.match(relative.stderr, /must be an absolute path/)

    const missing = run(['review', '--uncommitted'], { COMMAND_CODE_BIN: join(root, 'no-such-cmd') })
    assert.equal(missing.status, 11, missing.stderr)
    assert.match(missing.stderr, /not an executable file/)

    // A binary inside the repository under review could be replaced by it.
    const inside = join(repo, 'cmd')
    writeFileSync(inside, FAKE_CMD)
    chmodSync(inside, 0o755)
    const refused = run(['review', '--uncommitted'], { COMMAND_CODE_BIN: inside })
    assert.equal(refused.status, 11, refused.stderr)
    assert.match(refused.stderr, /resolves inside the repository under review/)
    assert.equal(refused.argv.length, 0)
  } finally {
    rmSync(join(repo, 'cmd'), { force: true })
    clean()
  }
})

test('a symlinked scoped path is fingerprinted, not followed', () => {
  const outside = join(root, 'outside.txt')
  writeFileSync(outside, 'outside content\n')
  symlinkSync(outside, join(repo, 'alias'))
  try {
    const result = run(['review', '--uncommitted'])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stderr, /^identity: [0-9a-f]{64}$/m)
    // Changing the link target is a change to the reviewed bytes.
    const before = /^identity: ([0-9a-f]{64})$/m.exec(result.stderr)[1]
    rmSync(join(repo, 'alias'))
    symlinkSync(outside, join(repo, 'other-name'))
    writeFileSync(join(repo, 'alias'), 'now a real file\n')
    const second = run(['review', '--uncommitted'])
    const after = /^identity: ([0-9a-f]{64})$/m.exec(second.stderr)[1]
    assert.notEqual(before, after)
  } finally {
    rmSync(join(repo, 'alias'), { force: true })
    rmSync(join(repo, 'other-name'), { force: true })
    clean()
  }
})
