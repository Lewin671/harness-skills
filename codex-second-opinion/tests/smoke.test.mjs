// Boundary-focused smoke tests for run-codex-second-opinion.mjs, run with
// `node --test`. A fake codex binary (written per-test into a scratch
// directory) stands in for the real CLI; FAKE_* environment variables steer
// its behaviour and it appends every invocation's argv to FAKE_ARGV_LOG.

import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, '..', 'run-codex-second-opinion.mjs')

const FAKE_CODEX = `#!/bin/sh
# Fake codex CLI for smoke tests.
printf '%s\\n' "$*" >> "$FAKE_ARGV_LOG"
case "$1" in
  mcp)
    if [ -n "$FAKE_MCP_ENABLED" ]; then
      case "$*" in
        *enabled=false*)
          if [ -n "$FAKE_MCP_STICKY" ]; then
            echo '[{"name":"srv","enabled":true}]'
          else
            echo '[{"name":"srv","enabled":false}]'
          fi ;;
        *)
          echo '[{"name":"srv","enabled":true}]' ;;
      esac
    else
      echo '[]'
    fi
    exit 0 ;;
  exec)
    out=""
    prev=""
    for a in "$@"; do
      if [ "$prev" = "-o" ]; then out=$a; fi
      prev=$a
    done
    if [ -n "$FAKE_SPAWN_CHILD" ]; then
      sleep 300 &
      echo $! > "$FAKE_CHILD_PID_FILE"
    fi
    if [ -n "$FAKE_SLEEP" ]; then
      sleep "$FAKE_SLEEP"
    fi
    echo '{"type":"thread.started","thread_id":"'"\${FAKE_THREAD_ID:-11111111-2222-3333-4444-555555555555}"'"}'
    echo 'free text from codex' >&2
    if [ -z "$FAKE_NO_RESULT" ] && [ -n "$out" ]; then
      echo 'the fake result body' > "$out"
    fi
    exit "\${FAKE_EXIT:-0}" ;;
esac
exit 64
`

let root // scratch root for the whole file
let repo // git fixture repository with one commit
let codexBin // fake codex path

function sh(command, options = {}) {
  const result = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8', ...options })
  assert.equal(result.status, 0, `setup command failed: ${command}\n${result.stderr}`)
  return result
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'codex-smoke-'))
  repo = join(root, 'repo')
  mkdirSync(repo)
  sh('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init && echo committed > tracked.txt && git add tracked.txt && git -c user.email=t@t -c user.name=t commit -q -m add', { cwd: repo })
  codexBin = join(root, 'bin', 'codex')
  mkdirSync(dirname(codexBin))
  writeFileSync(codexBin, FAKE_CODEX)
  chmodSync(codexBin, 0o755)
  mkdirSync(join(root, 'home'))
})

after(() => {
  rmSync(root, { recursive: true, force: true })
})

function run(args, extraEnv = {}) {
  const argvLog = join(mkdtempSync(join(root, 'argv-')), 'argv.log')
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      PATH: process.env.PATH,
      HOME: join(root, 'home'),
      TMPDIR: root,
      CODEX_BIN: codexBin,
      FAKE_ARGV_LOG: argvLog,
      ...extraEnv,
    },
  })
  result.argv = existsSync(argvLog) ? readFileSync(argvLog, 'utf8').split('\n').filter(Boolean) : []
  return result
}

test('argument and mode errors exit 3 before codex runs', () => {
  for (const args of [
    [],
    ['frobnicate'],
    ['review', '--model', 'gpt-x'], // --model without --effort
    ['review', '--timeout', '0'],
    ['review', '--timeout', 'soon'],
    ['review', '--base', 'main', '--commit', 'HEAD'], // two scopes
    ['review', '--custom', 'look here', '--context', 'background'],
    ['review', '--nonsense'],
    ['consult'], // no question
    ['consult', '--continue', 'not-a-uuid', 'question'],
    ['consult', 'question one', 'question two'],
  ]) {
    const result = run(args)
    assert.equal(result.status, 3, `expected 3 for ${JSON.stringify(args)}: ${result.stderr}`)
    assert.equal(result.argv.length, 0, `codex must not run for ${JSON.stringify(args)}`)
  }
})

test('--help exits 0 without running codex', () => {
  for (const args of [['--help'], ['review', '--help'], ['consult', '--help']]) {
    const result = run(args)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.argv.length, 0)
  }
})

test('review of a clean tree exits 2 before any codex invocation', () => {
  const result = run(['review', '--uncommitted'])
  assert.equal(result.status, 2, result.stderr)
  assert.match(result.stderr, /nothing to review/)
  assert.equal(result.argv.length, 0)
})

test('review of a change succeeds with safety args, markers and prefixes', () => {
  writeFileSync(join(repo, 'untracked.txt'), 'new\n')
  try {
    const result = run(['review', '--uncommitted'])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /the fake result body/)
    assert.match(result.stderr, /^note: using codex binary: /m)
    assert.match(result.stderr, /^report: /m)
    assert.match(result.stderr, /^log: /m)
    // codex-controlled lines are prefixed, wrapper lines are not
    assert.match(result.stderr, /^codex> \{"type":"thread\.started"/m)
    assert.match(result.stderr, /^codex> free text from codex$/m)
    // the exec call carries the read-only safety arguments
    const exec = result.argv.find((line) => line.startsWith('exec review'))
    assert.ok(exec, `no exec invocation in ${result.argv}`)
    for (const fragment of [
      'sandbox_mode="read-only"', '--disable hooks', '--disable apps',
      '--disable plugins', 'notify=[]', '--strict-config', '--ephemeral',
      '--json', '-m gpt-5.6-sol', 'model_reasoning_effort="high"',
    ]) {
      assert.ok(exec.includes(fragment), `missing ${fragment} in: ${exec}`)
    }
  } finally {
    rmSync(join(repo, 'untracked.txt'), { force: true })
  }
})

test('review --commit works on a clean tree and --context reaches the prompt', () => {
  const result = run(['review', '--commit', 'HEAD', '--context', 'behaviour must be unchanged'])
  assert.equal(result.status, 0, result.stderr)
  // the prompt is multi-line, so check the whole argv log, not one line
  const argv = result.argv.join('\n')
  assert.ok(argv.includes('CALLER-BACKGROUND'), `context fence missing in: ${argv}`)
  assert.ok(argv.includes('behaviour must be unchanged'), `context body missing in: ${argv}`)
  // with a prompt, no scope flag may be passed to codex
  const exec = result.argv.find((line) => line.startsWith('exec review'))
  assert.ok(!exec.includes('--commit'), `scope flag and prompt together in: ${exec}`)
})

test('enabled MCP servers are switched off, confirmed, and passed to exec', () => {
  const result = run(['review', '--commit', 'HEAD'], { FAKE_MCP_ENABLED: '1' })
  assert.equal(result.status, 0, result.stderr)
  const lists = result.argv.filter((line) => line.startsWith('mcp list --json'))
  assert.equal(lists.length, 2, `expected listing + re-check in ${result.argv}`)
  assert.ok(lists[1].includes('mcp_servers.srv.enabled=false'), `re-check without override: ${lists[1]}`)
  const exec = result.argv.find((line) => line.startsWith('exec review'))
  assert.ok(exec.includes('mcp_servers.srv.enabled=false'), `exec without override: ${exec}`)
  assert.match(result.stderr, /note: disabled 1 standalone MCP server/)
})

test('an MCP server that stays enabled after switch-off refuses the run', () => {
  const result = run(['review', '--commit', 'HEAD'], { FAKE_MCP_ENABLED: '1', FAKE_MCP_STICKY: '1' })
  assert.equal(result.status, 3, result.stderr)
  assert.match(result.stderr, /still enabled after being switched off/)
  assert.ok(!result.argv.some((line) => line.startsWith('exec')), 'exec must not run')
})

test('--allow-mcp leaves servers reachable with a warning', () => {
  const result = run(['review', '--commit', 'HEAD', '--allow-mcp'], { FAKE_MCP_ENABLED: '1' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /warning: leaving 1 enabled standalone MCP server/)
  const exec = result.argv.find((line) => line.startsWith('exec review'))
  assert.ok(!exec.includes('enabled=false'), `override present despite --allow-mcp: ${exec}`)
})

test('a failing codex exits 4 and discards the result but keeps the log', () => {
  const result = run(['review', '--commit', 'HEAD'], { FAKE_EXIT: '7' })
  assert.equal(result.status, 4, result.stderr)
  const out = /^report: (.*)$/m.exec(result.stderr)
  assert.equal(out, null, 'no report marker on failure')
  const log = /^log: (.*)$/m.exec(result.stderr)[1]
  assert.ok(existsSync(log), 'event log must survive a failure')
  assert.ok(!existsSync(join(dirname(log), 'result.md')), 'result must be discarded')
})

test('an empty result exits 4', () => {
  const result = run(['review', '--commit', 'HEAD'], { FAKE_NO_RESULT: '1' })
  assert.equal(result.status, 4, result.stderr)
  assert.match(result.stderr, /produced no report/)
})

test('consult extracts the session id and prints a resume descriptor', () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const result = run(['consult', '--', 'What do you think?'], { FAKE_THREAD_ID: id })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /the fake result body/)
  assert.match(result.stderr, new RegExp(`^session: ${id}$`, 'm'))
  const resume = /^resume: (.*)$/m.exec(result.stderr)[1]
  assert.ok(resume.startsWith(`--continue ${id}`), resume)
  assert.ok(resume.includes('--model gpt-5.6-sol --effort high'), resume)
  assert.ok(resume.includes('--repo '), resume)
})

test('a resumed consult passes exec resume and verifies continuation', () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const good = run(['consult', '--continue', id, '--', 'follow-up'], { FAKE_THREAD_ID: id })
  assert.equal(good.status, 0, good.stderr)
  assert.ok(good.argv.some((line) => line.startsWith(`exec resume ${id}`)), `no resume invocation in ${good.argv}`)

  const other = '99999999-8888-7777-6666-555555555555'
  const expired = run(['consult', '--continue', id, '--', 'follow-up'], { FAKE_THREAD_ID: other })
  assert.equal(expired.status, 4, expired.stderr)
  assert.match(expired.stderr, /did not resume session/)
  assert.equal(expired.stdout, '', 'a fresh-thread answer must be discarded, not printed')
})

test('a consult without a thread id still answers, with unavailable markers', () => {
  const result = run(['consult', '--', 'question'], { FAKE_THREAD_ID: 'not-a-uuid' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /^session: unavailable/m)
  assert.match(result.stderr, /^resume: unavailable/m)
})

test('a timeout exits 5 and kills the whole detached process group', async () => {
  const pidFile = join(mkdtempSync(join(root, 'pid-')), 'child.pid')
  const result = run(['consult', '--timeout', '1', '--', 'question'], {
    FAKE_SLEEP: '30',
    FAKE_SPAWN_CHILD: '1',
    FAKE_CHILD_PID_FILE: pidFile,
  })
  assert.equal(result.status, 5, result.stderr)
  assert.match(result.stderr, /exceeded 1s and was terminated/)
  const grandchild = Number(readFileSync(pidFile, 'utf8').trim())
  assert.ok(grandchild > 0)
  // group-wide SIGKILL is asynchronous; give it a moment
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
})

test('a CODEX_HOME inside the repository is refused', () => {
  const result = run(['review', '--commit', 'HEAD'], { CODEX_HOME: join(repo, '.codex-home') })
  assert.equal(result.status, 3, result.stderr)
  assert.match(result.stderr, /CODEX_HOME .* inside the repository/)
})

test('a relative CODEX_BIN is refused', () => {
  const result = run(['review', '--commit', 'HEAD'], { CODEX_BIN: 'bin/codex' })
  assert.equal(result.status, 3, result.stderr)
  assert.match(result.stderr, /must be an absolute path/)
})
