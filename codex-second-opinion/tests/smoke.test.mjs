// Boundary-focused smoke tests for run-codex-second-opinion.mjs, run with
// `node --test`. A fake codex binary (written per-test into a scratch
// directory) stands in for the real CLI; FAKE_* environment variables steer
// its behaviour and it appends every invocation's argv to FAKE_ARGV_LOG.

import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, chmodSync, existsSync, symlinkSync } from 'node:fs'
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
      echo '[{"name":"srv","enabled":true}]'
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
    if [ -n "$FAKE_CAPTURE_FILE" ]; then
      {
        echo "cwd=$PWD"
        printf 'tracked-before='
        cat tracked.txt
        if [ -f untracked.txt ]; then echo 'untracked=yes'; else echo 'untracked=no'; fi
        echo 'cached-diff:'
        git diff --cached -- tracked.txt
        if [ -n "$FAKE_SOURCE_MUST_BE_HIDDEN" ]; then
          if grep -R -a -F "$FAKE_SOURCE_MUST_BE_HIDDEN" .git >/dev/null 2>&1; then
            echo 'source-metadata=yes'
          else
            echo 'source-metadata=no'
          fi
        fi
      } > "$FAKE_CAPTURE_FILE"
    fi
    if [ -n "$FAKE_MUTATE_SOURCE" ]; then
      echo continued > "$FAKE_MUTATE_SOURCE/tracked.txt"
      printf 'tracked-after=' >> "$FAKE_CAPTURE_FILE"
      cat tracked.txt >> "$FAKE_CAPTURE_FILE"
    fi
    echo '{"type":"thread.started","thread_id":"'"\${FAKE_THREAD_ID:-11111111-2222-3333-4444-555555555555}"'"}'
    echo 'free text from codex' >&2
    if [ -n "$FAKE_BIG_RESULT" ] && [ -n "$out" ]; then
      awk 'BEGIN{for(i=0;i<20000;i++)print "model text line " i}' > "$out"
    elif [ -z "$FAKE_NO_RESULT" ] && [ -n "$out" ]; then
      if [ -n "$FAKE_RESULT_PATH" ]; then
        echo "finding at $PWD/tracked.txt" > "$out"
      else
        echo 'the fake result body' > "$out"
      fi
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
  sh('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init && mkdir dir && echo committed > tracked.txt && echo nested > dir/file.txt && git add tracked.txt dir/file.txt && git -c user.email=t@t -c user.name=t commit -q -m add', { cwd: repo })
  mkdirSync(join(repo, 'dir\\name'))
  writeFileSync(join(repo, 'dir\\name', 'file.txt'), 'nested\n')
  sh("git add -- 'dir\\name/file.txt' && git -c user.email=t@t -c user.name=t commit -q -m backslash-path", { cwd: repo })
  codexBin = join(root, 'bin', 'codex')
  mkdirSync(dirname(codexBin))
  writeFileSync(codexBin, FAKE_CODEX)
  chmodSync(codexBin, 0o755)
  mkdirSync(join(root, 'home'))
})

after(() => {
  rmSync(root, { recursive: true, force: true })
})

function run(args, extraEnv = {}, cwd = repo) {
  const argvLog = join(mkdtempSync(join(root, 'argv-')), 'argv.log')
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
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

test('a half-set env pair still allows --help but fails a real run', () => {
  const extraEnv = { CODEX_SECOND_OPINION_MODEL: 'gpt-x' }
  const help = run(['review', '--help'], extraEnv)
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stderr, /Usage: run-codex-second-opinion review/)
  const real = run(['review', '--commit', 'HEAD'], extraEnv)
  assert.equal(real.status, 3, real.stderr)
  assert.match(real.stderr, /must be set together/)
  assert.equal(real.argv.length, 0)
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

test('live review uses an isolated startup snapshot while source edits continue', () => {
  const capture = join(root, 'snapshot-capture.txt')
  const sourceRoot = realpathSync(repo)
  writeFileSync(join(repo, 'tracked.txt'), 'review me\n')
  writeFileSync(join(repo, 'untracked.txt'), 'new\n')
  try {
    const result = run(['review', '--uncommitted'], {
      FAKE_CAPTURE_FILE: capture,
      FAKE_MUTATE_SOURCE: repo,
      FAKE_RESULT_PATH: '1',
      FAKE_SOURCE_MUST_BE_HIDDEN: sourceRoot,
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stderr, /^snapshot: ready [0-9a-f]{64}$/m)
    // the marker reprints after the result so that in a merged stream the
    // last marker of each kind is the wrapper's, not model text
    assert.equal(result.stderr.match(/^snapshot: ready [0-9a-f]{64}$/gm).length, 2)
    assert.ok(result.stderr.lastIndexOf('snapshot: ready') > result.stderr.indexOf('report: '),
      'the final snapshot marker must print after the report marker')
    const observed = readFileSync(capture, 'utf8')
    const cwd = /^cwd=(.*)$/m.exec(observed)[1]
    assert.notEqual(cwd, repo, 'codex must run outside the live source repository')
    assert.match(observed, /^tracked-before=review me$/m)
    assert.match(observed, /^tracked-after=review me$/m)
    assert.match(observed, /^untracked=yes$/m)
    assert.match(observed, /^source-metadata=no$/m)
    assert.equal(readFileSync(join(repo, 'tracked.txt'), 'utf8'), 'continued\n')
    assert.equal(existsSync(cwd), false, 'the isolated snapshot must be removed after review')
    assert.match(result.stdout, new RegExp(`finding at ${sourceRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/tracked\\.txt`))
    assert.ok(!result.stdout.includes(cwd), 'temporary paths must be remapped in the report')
  } finally {
    writeFileSync(join(repo, 'tracked.txt'), 'committed\n')
    rmSync(join(repo, 'untracked.txt'), { force: true })
  }
})

test('base review snapshots a clean working tree', () => {
  const result = run(['review', '--base', 'HEAD^'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /^snapshot: ready [0-9a-f]{64}$/m)
  const exec = result.argv.find((line) => line.startsWith('exec review'))
  assert.match(exec, /--base [0-9a-f]{40}/)
})

test('snapshot preserves staged changes separately from the working tree', () => {
  const capture = join(root, 'index-capture.txt')
  writeFileSync(join(repo, 'tracked.txt'), 'staged\n')
  sh('git add -- tracked.txt', { cwd: repo })
  writeFileSync(join(repo, 'tracked.txt'), 'committed\n')
  sh('git config diff.noprefix true', { cwd: repo })
  try {
    const result = run(['review', '--uncommitted'], { FAKE_CAPTURE_FILE: capture })
    assert.equal(result.status, 0, result.stderr)
    const observed = readFileSync(capture, 'utf8')
    assert.match(observed, /^tracked-before=committed$/m)
    assert.match(observed, /^\+staged$/m)
  } finally {
    sh('git reset -q HEAD -- tracked.txt', { cwd: repo })
    sh('git config --unset diff.noprefix', { cwd: repo })
    writeFileSync(join(repo, 'tracked.txt'), 'committed\n')
  }
})

test('base snapshot excludes unrelated untracked files', () => {
  const capture = join(root, 'base-capture.txt')
  writeFileSync(join(repo, 'untracked.txt'), 'unrelated\n')
  try {
    const result = run(['review', '--base', 'HEAD^'], { FAKE_CAPTURE_FILE: capture })
    assert.equal(result.status, 0, result.stderr)
    assert.match(readFileSync(capture, 'utf8'), /^untracked=no$/m)
  } finally {
    rmSync(join(repo, 'untracked.txt'), { force: true })
  }
})

test('snapshot refuses a symlink ancestor without touching its external target', () => {
  const outside = join(root, 'outside')
  mkdirSync(outside)
  writeFileSync(join(outside, 'file.txt'), 'must survive\n')
  rmSync(join(repo, 'dir'), { recursive: true })
  symlinkSync(outside, join(repo, 'dir'))
  try {
    const result = run(['review', '--uncommitted'])
    assert.equal(result.status, 3, result.stderr)
    assert.match(result.stderr, /ancestor dir is a symbolic link/)
    assert.equal(result.argv.length, 0, 'codex must not run on an unsafe snapshot')
    assert.equal(readFileSync(join(outside, 'file.txt'), 'utf8'), 'must survive\n')
  } finally {
    rmSync(join(repo, 'dir'), { force: true })
    mkdirSync(join(repo, 'dir'))
    writeFileSync(join(repo, 'dir', 'file.txt'), 'nested\n')
  }
})

test('snapshot treats backslash as a filename character when guarding symlink ancestors', () => {
  const outside = join(root, 'outside-backslash')
  const sourceDir = join(repo, 'dir\\name')
  mkdirSync(outside)
  writeFileSync(join(outside, 'file.txt'), 'must survive\n')
  rmSync(sourceDir, { recursive: true })
  symlinkSync(outside, sourceDir)
  try {
    const result = run(['review', '--uncommitted'])
    assert.equal(result.status, 3, result.stderr)
    assert.match(result.stderr, /is a symbolic link/)
    assert.equal(result.argv.length, 0, 'codex must not run on an unsafe snapshot')
    assert.equal(readFileSync(join(outside, 'file.txt'), 'utf8'), 'must survive\n')
  } finally {
    rmSync(sourceDir, { force: true })
    mkdirSync(sourceDir)
    writeFileSync(join(sourceDir, 'file.txt'), 'nested\n')
  }
})

test('snapshot refuses an unchanged symlink into the live source repository', () => {
  const linkRepo = join(root, 'link-repo')
  mkdirSync(linkRepo)
  sh('git init -q', { cwd: linkRepo })
  writeFileSync(join(linkRepo, 'tracked.txt'), 'committed\n')
  symlinkSync(join(linkRepo, 'tracked.txt'), join(linkRepo, 'alias'))
  sh('git add tracked.txt alias && git -c user.email=t@t -c user.name=t commit -q -m init', { cwd: linkRepo })
  writeFileSync(join(linkRepo, 'tracked.txt'), 'changed\n')

  const result = run(['review', '--uncommitted'], {}, linkRepo)
  assert.equal(result.status, 3, result.stderr)
  assert.match(result.stderr, /resolves outside the isolated review repository/)
  assert.equal(result.argv.length, 0, 'codex must not run with a live external symlink')
})

test('snapshot refuses a tracked file replaced by an external symlink', () => {
  const outside = join(root, 'outside-tracked.txt')
  writeFileSync(outside, 'external\n')
  rmSync(join(repo, 'tracked.txt'))
  symlinkSync(outside, join(repo, 'tracked.txt'))
  try {
    const result = run(['review', '--uncommitted'])
    assert.equal(result.status, 3, result.stderr)
    assert.match(result.stderr, /resolves outside the isolated review repository/)
    assert.equal(result.argv.length, 0, 'codex must not run with a live external symlink')
  } finally {
    rmSync(join(repo, 'tracked.txt'), { force: true })
    writeFileSync(join(repo, 'tracked.txt'), 'committed\n')
  }
})

test('a review from an ignored subdirectory falls back to the snapshot root', () => {
  const igRepo = join(root, 'ignored-cwd-repo')
  mkdirSync(igRepo)
  sh('git init -q', { cwd: igRepo })
  writeFileSync(join(igRepo, '.gitignore'), 'build/\n')
  writeFileSync(join(igRepo, 'tracked.txt'), 'committed\n')
  sh('git add .gitignore tracked.txt && git -c user.email=t@t -c user.name=t commit -q -m init', { cwd: igRepo })
  mkdirSync(join(igRepo, 'build'))
  writeFileSync(join(igRepo, 'tracked.txt'), 'changed\n')

  const result = run(['review', '--uncommitted'], {}, join(igRepo, 'build'))
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /^note: the current directory is not present in the snapshot/m)
  assert.match(result.stdout, /the fake result body/)
})

test('snapshot tolerates an unchanged committed symlink to an unrelated external target', () => {
  const dotRepo = join(root, 'dotfiles-repo')
  const outside = join(root, 'outside-home')
  mkdirSync(dotRepo)
  mkdirSync(outside)
  writeFileSync(join(outside, 'rc'), 'external\n')
  sh('git init -q', { cwd: dotRepo })
  writeFileSync(join(dotRepo, 'tracked.txt'), 'committed\n')
  symlinkSync(join(outside, 'rc'), join(dotRepo, 'link'))
  sh('git add tracked.txt link && git -c user.email=t@t -c user.name=t commit -q -m init', { cwd: dotRepo })
  writeFileSync(join(dotRepo, 'tracked.txt'), 'changed\n')

  const result = run(['review', '--uncommitted'], {}, dotRepo)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /^snapshot: ready [0-9a-f]{64}$/m)
})

test('a repository with no commits yet gets a make-an-initial-commit hint', () => {
  const unborn = join(root, 'unborn-repo')
  mkdirSync(unborn)
  sh('git init -q', { cwd: unborn })
  writeFileSync(join(unborn, 'first.txt'), 'new\n')
  sh('git add first.txt', { cwd: unborn })

  const result = run(['review', '--uncommitted'], {}, unborn)
  assert.equal(result.status, 3, result.stderr)
  assert.match(result.stderr, /no commits yet/)
  assert.match(result.stderr, /make an initial commit/)
  assert.equal(result.argv.length, 0, 'codex must not run without a resolvable HEAD')
})

test('base review fails closed on a branch-introduced external symlink', () => {
  const baseRepo = join(root, 'base-symlink-repo')
  const outside = join(root, 'outside-base')
  mkdirSync(baseRepo)
  mkdirSync(outside)
  writeFileSync(join(outside, 'file.txt'), 'external\n')
  sh('git init -q', { cwd: baseRepo })
  writeFileSync(join(baseRepo, 'a.txt'), 'one\n')
  sh('git add a.txt && git -c user.email=t@t -c user.name=t commit -q -m base', { cwd: baseRepo })
  const baseSha = sh('git rev-parse HEAD', { cwd: baseRepo }).stdout.trim()
  symlinkSync(join(outside, 'file.txt'), join(baseRepo, 'link'))
  sh('git add link && git -c user.email=t@t -c user.name=t commit -q -m link', { cwd: baseRepo })

  const result = run(['review', '--base', baseSha], {}, baseRepo)
  assert.equal(result.status, 3, result.stderr)
  assert.match(result.stderr, /resolves outside the isolated review repository/)
  assert.equal(result.argv.length, 0, 'codex must not run on an unsafe snapshot')
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

test('trailing markers print after a large result body in a merged pipe stream', () => {
  const merged = join(mkdtempSync(join(root, 'merged-')), 'merged.txt')
  const argvLog = join(mkdtempSync(join(root, 'argv-')), 'argv.log')
  // A real pipe (not a file) so stdout writes are asynchronous: a body larger
  // than the pipe buffer stays queued while stderr would otherwise cut in.
  const result = spawnSync('/bin/sh', ['-c',
    `"${process.execPath}" "${SCRIPT}" review --commit HEAD 2>&1 | cat > "${merged}"`], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      PATH: process.env.PATH,
      HOME: join(root, 'home'),
      TMPDIR: root,
      CODEX_BIN: codexBin,
      FAKE_ARGV_LOG: argvLog,
      FAKE_BIG_RESULT: '1',
    },
  })
  assert.equal(result.status, 0, result.stderr)
  const observed = readFileSync(merged, 'utf8')
  const bodyEnd = observed.indexOf('model text line 19999')
  assert.ok(bodyEnd >= 0, 'the large result body must reach the merged stream')
  assert.ok(observed.lastIndexOf('\nreport: ') > bodyEnd, 'the report marker must follow the whole result body')
  assert.ok(observed.lastIndexOf('\nlog: ') > bodyEnd, 'the final log marker must follow the whole result body')
})

test('MCP servers are left untouched — no listing, no overrides', () => {
  const result = run(['review', '--commit', 'HEAD'], { FAKE_MCP_ENABLED: '1' })
  assert.equal(result.status, 0, result.stderr)
  assert.ok(!result.argv.some((line) => line.startsWith('mcp')), `unexpected mcp invocation in ${result.argv}`)
  const exec = result.argv.find((line) => line.startsWith('exec review'))
  assert.ok(!exec.includes('enabled=false'), `MCP override present in: ${exec}`)
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

test('consult prints a resume line that is a complete runnable command', () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const result = run(['consult', '--', 'What do you think?'], { FAKE_THREAD_ID: id })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /the fake result body/)
  assert.match(result.stderr, new RegExp(`^session: ${id}$`, 'm'))
  const resume = /^resume: (.*)$/m.exec(result.stderr)[1]
  assert.ok(resume.includes('run-codex-second-opinion.mjs'), resume)
  assert.ok(resume.includes(` consult --continue ${id}`), resume)
  // inside a work tree, codex's own git check stays active
  const exec = result.argv.find((line) => line.startsWith('exec'))
  assert.ok(!exec.includes('--skip-git-repo-check'), exec)
  assert.ok(resume.includes('--model gpt-5.6-sol --effort high'), resume)
  assert.ok(resume.includes('--repo '), resume)

  // the printed line, plus the question, must run as-is
  const argvLog = join(mkdtempSync(join(root, 'argv-')), 'argv.log')
  const follow = spawnSync('/bin/sh', ['-c', `${resume} -- "follow-up"`], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      PATH: process.env.PATH,
      HOME: join(root, 'home'),
      TMPDIR: root,
      CODEX_BIN: codexBin,
      FAKE_ARGV_LOG: argvLog,
      FAKE_THREAD_ID: id,
    },
  })
  assert.equal(follow.status, 0, follow.stderr)
  const followArgv = readFileSync(argvLog, 'utf8')
  assert.ok(followArgv.includes(`exec resume ${id}`), followArgv)
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

test('consult runs outside a git work tree; review refuses', () => {
  const plain = mkdtempSync(join(root, 'plain-'))
  const consult = run(['consult', '--', 'question'], {}, plain)
  assert.equal(consult.status, 0, consult.stderr)
  assert.match(consult.stdout, /the fake result body/)
  // the real codex refuses non-git directories unless told to skip the check
  const exec = consult.argv.find((line) => line.startsWith('exec'))
  assert.ok(exec.includes('--skip-git-repo-check'), exec)
  const review = run(['review', '--uncommitted'], {}, plain)
  assert.equal(review.status, 3, review.stderr)
  assert.match(review.stderr, /not a git work tree/)
})

test('a relative CODEX_BIN is refused', () => {
  const result = run(['review', '--commit', 'HEAD'], { CODEX_BIN: 'bin/codex' })
  assert.equal(result.status, 3, result.stderr)
  assert.match(result.stderr, /must be an absolute path/)
})

test('a CODEX_BIN that does not exist is refused with a clear message', () => {
  const result = run(['review', '--commit', 'HEAD'], { CODEX_BIN: join(root, 'missing-codex') })
  assert.equal(result.status, 3, result.stderr)
  assert.match(result.stderr, /not an executable file/)
  assert.equal(result.argv.length, 0)
})
