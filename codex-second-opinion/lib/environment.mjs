import {
  accessSync,
  constants,
  copyFileSync,
  lstatSync,
  mkdtempSync,
  openSync,
  closeSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs'
import { delimiter, dirname, isAbsolute, join, parse, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { assertAddressableMcpName, enabledMcpServers, McpShapeError } from './mcp.mjs'
import {
  absolutePathEntries,
  die,
  flat,
  hasLineBreak,
  isInside,
  lexicallyResolve,
  nearestExistingAncestor,
  physicalPath,
  run,
} from './util.mjs'

// No single git or codex preflight probe should ever legitimately need this
// long; a probe that does has hung. Large enough that a cold `git status` on
// a very large repository still finishes well inside it.
const PREFLIGHT_FLOOR_SECONDS = 600

const GIT_ENV_KEYS = [
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM',
]

function exists(path) {
  try { lstatSync(path); return true } catch { return false }
}

function isDirectory(path) {
  try { return statSync(path).isDirectory() } catch { return false }
}

function isSymlink(path) {
  try { return lstatSync(path).isSymbolicLink() } catch { return false }
}

function resolveLinkChain(input) {
  let path = lexicallyResolve(input)
  const seen = new Set()
  for (let i = 0; i < 64 && isSymlink(path); i += 1) {
    if (seen.has(path)) return path
    seen.add(path)
    const target = readlinkSync(path)
    path = lexicallyResolve(isAbsolute(target) ? target : resolve(dirname(path), target))
  }
  return path
}

// Resolve path components in filesystem order. path.resolve()/normalize()
// collapses `link/..` before observing that `link` is a symlink, which is not
// how open(2) walks it and can approve a CODEX_HOME that actually lands in the
// repository.
//
// Returns null when the walk cannot be completed -- a step-budget overrun or a
// symlink cycle -- rather than the prefix it got to. Returning the prefix was a
// fail-OPEN: `..` means `current` does not descend monotonically, so a path
// like `/outside/` + `x/../` * 260 + `<repo>/pwned` keeps the prefix parked on
// `/outside` for every one of the 512 steps while the components that actually
// descend into the repository are still queued in `pending`. The caller then
// checked `/outside` -- outside the repo, approved -- and handed codex the
// original string, which the kernel resolves to a destination inside the very
// repository being reviewed. Verified empirically with a 530-component path.
// Every caller now treats null as "cannot establish where this lands", which is
// the same answer they already give for an unreadable path.
function resolvePathSemantics(input) {
  const absolute = isAbsolute(input) ? input : resolve(input)
  let pending = absolute.slice(parse(absolute).root.length).split(sep).filter(Boolean)
  let current = parse(absolute).root
  const seen = new Set()
  for (let steps = 0; pending.length && steps < 512; steps += 1) {
    const part = pending.shift()
    if (part === '.' || part === '') continue
    if (part === '..') { current = dirname(current); continue }
    const candidate = join(current, part)
    if (isSymlink(candidate)) {
      const key = `${candidate}\0${pending.join(sep)}`
      if (seen.has(key)) return null
      seen.add(key)
      const target = readlinkSync(candidate)
      if (isAbsolute(target)) {
        pending = [...target.slice(parse(target).root.length).split(sep).filter(Boolean), ...pending]
        current = parse(target).root
      } else {
        // Splice the target's own raw components onto pending, resolved
        // one at a time from `current` (the symlink's containing
        // directory) by the same loop -- not join(current, target), which
        // would lexically collapse a `..` inside a RELATIVE target before
        // a symlink component earlier in that same target is itself
        // resolved, the identical bug this function exists to close for
        // the outer path, one level deeper.
        pending = [...target.split(sep).filter(Boolean), ...pending]
      }
    } else {
      current = candidate
    }
  }
  return pending.length ? null : current
}

function collectSessionDestinations(root, maxDepth = 3) {
  const destinations = []
  const visit = (logical, depth, ancestry) => {
    if (depth > maxDepth) return
    let entries
    try {
      entries = readdirSync(logical, { withFileTypes: true })
    } catch (error) {
      // A directory that is no longer there is not a destination codex can
      // write through, so it is nothing to refuse over -- and codex's own
      // scratch below CODEX_HOME turns over while this walk runs, which
      // would otherwise make the refusal intermittent. Every other failure
      // (unreadable, not a directory, I/O error) still refuses: those mean
      // the destination exists and could not be inspected.
      if (error.code === 'ENOENT') return
      throw new Error(`could not enumerate ${logical}: ${error.code || error.message}`)
    }
    for (const entry of entries) {
      const child = join(logical, entry.name)
      let target = lexicallyResolve(child)
      if (entry.isSymbolicLink()) target = resolveLinkChain(child)
      const real = physicalPath(target)
      const destination = real || target
      destinations.push(destination)
      const ancestor = nearestExistingAncestor(destination)
      if (ancestor) destinations.push(ancestor)

      const directory = isDirectory(child)
      if (!directory || depth === maxDepth) continue
      const identity = physicalPath(child) || destination
      if (ancestry.has(identity)) continue
      const next = new Set(ancestry)
      next.add(identity)
      visit(child, depth + 1, next)
    }
  }
  visit(root, 1, new Set([physicalPath(root) || root]))
  return destinations
}

// A safe subset of POSIX PATH search for a bare command name: only absolute
// PATH entries are tried, via the shared absolutePathEntries filter (also
// applied to baseEnv.PATH itself in the constructor below). When CODEX_BIN
// is unset, resolveCodexBin uses this result as the actual binary to spawn
// -- not just to print -- so a relative PATH entry earlier in the search
// order can never win over it. A relative entry is skipped rather than
// probed: after initialize() has already changed into the repository under
// review, joining it with a relative directory would probe that
// repository's own content, the exact hijack this function exists to
// avoid, not merely disclose.
function resolveOnPath(name, pathValue) {
  for (const dir of absolutePathEntries(pathValue)) {
    // resolvePathSemantics, not join()+lexical use: a PATH entry containing
    // `..` after a symlink component (`/safe/link/../bin`, where `link` is
    // a symlink) must have that symlink followed before `..` is applied --
    // the same filesystem-order-vs-lexical-normalization hole
    // resolvePathSemantics already exists to close for CODEX_HOME. join()
    // alone would collapse `link/..` as a string first and probe the wrong
    // directory, both for a match this function should have found and for
    // one it should not have.
    // A null here means the entry could not be walked at all (step-budget
    // overrun or symlink cycle). Skip it rather than probing a guessed
    // location: an entry whose destination cannot be established is exactly
    // as untrustworthy as a relative one, and the loop simply moves on to
    // the next entry the same way.
    const resolvedDir = resolvePathSemantics(dir)
    if (!resolvedDir) continue
    const candidate = join(resolvedDir, name)
    try {
      accessSync(candidate, constants.X_OK)
      if (statSync(candidate).isFile()) return candidate
    } catch {}
  }
  return null
}

// Shared by both branches of resolveCodexBin: fully dereferences path (no
// remaining symlink indirection for a later spawn to re-resolve, possibly
// differently) and refuses a result that would forge a marker line in this
// script's stderr, the same way cwd/CODEX_HOME/scratch already are. Returns
// null on either failure rather than dying itself, so each call site can
// give its own specific error and hint.
function resolveReal(path) {
  const resolved = physicalPath(path)
  return resolved && !hasLineBreak(resolved) ? resolved : null
}

export class Environment {
  constructor(state) {
    this.state = state
    this.cwd = null
    this.repoRoots = []
    this.scratch = null
    this.codexBin = process.env.CODEX_BIN || 'codex'
    // codexBin is later reassigned, in resolveCodexBin, to a dereferenced,
    // safe-to-exec real path -- but some installs are a symlink to a shared
    // dispatcher that branches on argv[0] (e.g. a multicall binary), so the
    // *file executed* and the *identity the process sees itself invoked
    // under* need to stay independently controllable. codexArgv0 keeps the
    // original, pre-resolution value (the literal CODEX_BIN string, or the
    // bare 'codex' default) for exactly that: Runtime.execute passes it as
    // spawn's `argv0` option, so a dispatcher keeps seeing "codex" even
    // though the safer, resolved path is what actually gets executed.
    this.codexArgv0 = this.codexBin
    this.mcpArgs = []
    this.baseEnv = { ...process.env }
    for (const key of GIT_ENV_KEYS) delete this.baseEnv[key]
    delete this.baseEnv.CDPATH
    // A relative PATH entry is a hijack risk for every child this script
    // spawns, not just codex: git subcommands, and -- the concrete case
    // that motivated this -- an env-shebang launcher (`#!/usr/bin/env
    // node`, which is how codex is actually packaged) performing its own
    // fresh PATH search for its interpreter, after this process has
    // already changed into the repository under review. resolveOnPath
    // already refused to pick a relative entry for its own search; this
    // makes every spawned child see the same absolute-only PATH, so
    // nothing it (or something it execs in turn) searches for can resolve
    // through one either.
    this.baseEnv.PATH = absolutePathEntries(this.baseEnv.PATH).join(delimiter)
  }

  command(command, args, options = {}) {
    return run(command, args, {
      cwd: options.cwd || this.cwd || process.cwd(),
      env: { ...this.baseEnv, ...(options.env || {}) },
      input: options.input,
      encoding: options.encoding,
      stdio: options.stdio,
      argv0: options.argv0,
      // Preflight probes run before Runtime's watchdog exists, so they carry
      // a deadline of their own; see run() in lib/util.mjs. It is --timeout
      // or PREFLIGHT_FLOOR_SECONDS, whichever is LARGER, rather than
      // --timeout alone: --timeout means "abort a hung review", and a caller
      // passing a deliberately tiny one (the contract suite uses `--timeout
      // 1` to exercise the watchdog) would otherwise have every git and codex
      // probe killed before it could answer, turning a fast-failing review
      // into an environment error. The floor is well above any legitimate
      // probe while still bounding the unbounded case.
      timeout: Math.max(this.state.timeout || 0, PREFLIGHT_FLOOR_SECONDS) * 1000,
    })
  }

  git(args, options = {}) {
    return this.command('git', args, options)
  }

  initialize() {
    try {
      process.chdir(this.state.repo)
    } catch {
      die(3, `error: cannot enter ${flat(this.state.repo)}`)
    }
    this.cwd = realpathSync(process.cwd())
    process.chdir(this.cwd)
    if (hasLineBreak(this.cwd)) {
      die(3, 'error: the repository path contains a line break, which would forge marker lines in this script\'s output')
    }
    // Before the first child is spawned -- git included, since git is what
    // resolveRepositoryRoots below needs in order to learn the rest of the
    // boundary. Filtering PATH to absolute entries only ever removed
    // *relative* ones, but the dev-tooling case internals.md names as the
    // motivation (direnv, asdf, mise) prepends an ABSOLUTE entry inside the
    // project, e.g. `PATH_add bin` exporting `/repo/bin`. Such an entry
    // survived the absolute-only filter untouched and could supply this run's
    // `git`, its `codex`, or the `node` an env-shebang launcher looks up --
    // all from the repository under review. Verified empirically: a
    // `/repo/bin/node` on an absolute repo-internal PATH entry ran.
    this.excludeFromPath([this.cwd])

    const workTree = this.git(['rev-parse', '--is-inside-work-tree'])
    if (workTree.status !== 0 || workTree.stdout.trim() !== 'true') {
      die(3, `error: ${flat(this.state.repo)} is not a git work tree`)
    }

    this.resolveRepositoryRoots()
    // Again, now that the full boundary is known: sibling worktrees and the
    // git storage directories were not yet discoverable at the first call.
    this.excludeFromPath(this.repoRoots)
    this.resolveScratchAndCodexHome()
    this.baseEnv.GIT_NO_LAZY_FETCH = '1'
    this.resolveCodexBin()
    this.verifyFeatures()
    this.verifyMcp()
  }

  // Drops every PATH entry that lands inside one of `roots`, comparing on the
  // entry's resolved destination rather than its spelling, so a symlink
  // pointing into the repository is caught as readily as a literal repo path.
  // An entry whose destination cannot be established at all is dropped too:
  // this is a trust filter, and an unresolvable candidate has not earned it.
  // Idempotent, so calling it again once more roots are known only ever
  // narrows the set further.
  excludeFromPath(roots) {
    if (!roots.length) return
    const kept = []
    const dropped = []
    for (const dir of absolutePathEntries(this.baseEnv.PATH)) {
      const resolved = resolvePathSemantics(dir)
      const destination = resolved ? physicalPath(resolved) || resolved : null
      if (destination && !isInside(destination, roots)) kept.push(dir)
      else dropped.push(dir)
    }
    if (!dropped.length) return
    this.baseEnv.PATH = kept.join(delimiter)
    process.stderr.write(`note: dropped ${dropped.length} PATH entry/entries that resolve inside the repository under review\n`)
  }

  resolveCodexBin() {
    const raw = process.env.CODEX_BIN
    if (raw && !isAbsolute(raw)) {
      die(3,
        `error: CODEX_BIN (${flat(raw)}) must be an absolute path.`,
        "error: this script changes into the repository under review before codex is spawned, so a relative CODEX_BIN resolves against that repository's own content, not the directory it was set from -- letting reviewed-repo content substitute for the binary this run is supposed to trust.",
        'hint: set CODEX_BIN to an absolute path, e.g. the output of `command -v codex` in an interactive shell.')
    }
    // Both branches below pin codexBin to a symlink-free real path, not just
    // print one, and do it once here rather than per invocation. verifyFeatures
    // and verifyMcp check codexBin now; the actual review/consult exec, which
    // can start minutes later, spawns the identical string again. If codexBin
    // still named a symlink, the OS would re-resolve it fresh at that later
    // spawn -- so retargeting the symlink in between would run a different,
    // unaudited binary while the earlier note and feature/MCP checks kept
    // describing the original target. Resolving once, to a path with no
    // remaining symlink indirection, removes that window. resolveReal is
    // shared so both a dangling/unresolvable path and a resolved path that
    // would forge a marker line are refused the same way from either branch,
    // rather than duplicating (and risking drifting) the same two checks.
    if (raw) {
      const resolved = resolveReal(raw)
      if (!resolved) {
        // A silent fall-through here would leave codexBin as the unresolved,
        // still-symlink-capable `raw` string -- the exact unpinned state this
        // method exists to eliminate, and it could be a transient failure
        // (mid-swap) rather than a simply-missing path, so proceeding on the
        // unresolved value is never safer than refusing.
        die(3,
          `error: CODEX_BIN (${flat(raw)}) does not resolve to a real, readable path with no embedded line break.`,
          'hint: point CODEX_BIN at a binary that exists and is reachable, e.g. the output of `command -v codex` in an interactive shell.')
      }
      this.codexBin = resolved
      process.stderr.write(`note: using codex binary: ${resolved}\n`)
      return
    }
    // Without CODEX_BIN, the bare name would otherwise be handed to spawn
    // unresolved, letting the OS/Node search the full PATH -- including a
    // relative entry, which (like a relative CODEX_BIN) resolves against
    // the reviewed repository once this script has changed into it.
    const found = resolveOnPath(this.codexBin, this.baseEnv.PATH)
    if (!found) {
      die(3,
        `error: could not find '${this.codexBin}' on an absolute PATH entry.`,
        'error: only absolute PATH entries are searched here, since a relative one would resolve against the repository under review rather than the directory this script was launched from.',
        'hint: set CODEX_BIN to an absolute path, e.g. the output of `command -v codex` in an interactive shell.')
    }
    const resolved = resolveReal(found)
    if (!resolved) {
      // flat(found), not found verbatim: found is itself an unverified PATH
      // candidate at this point -- resolveReal rejected it, possibly for
      // this exact reason -- so echoing it unflattened here would let the
      // rejection message forge the same marker line resolveReal exists to
      // prevent.
      die(3,
        `error: '${flat(found)}' was found on PATH but does not resolve to a real, readable path with no embedded line break.`,
        'hint: set CODEX_BIN to an absolute path, e.g. the output of `command -v codex` in an interactive shell.')
    }
    this.codexBin = resolved
    process.stderr.write(`note: using codex binary: ${resolved}\n`)
  }

  resolveRepositoryRoots() {
    const top = this.git(['rev-parse', '--show-toplevel'])
    if (top.status !== 0 || !top.stdout.trim()) die(3, 'error: could not resolve the repository root')
    const worktreeRoot = physicalPath(top.stdout.trim())
    if (!worktreeRoot) die(3, 'error: could not resolve the repository root')
    this.worktreeRoot = worktreeRoot
    this.repoRoots = [worktreeRoot]

    const worktrees = this.git(['worktree', 'list', '--porcelain', '-z'])
    if (worktrees.status !== 0) {
      die(3,
        `error: could not enumerate the repository's worktrees (${worktrees.status}).`,
        'hint: every worktree root has to be known before a scratch or CODEX_HOME path can be called outside the repository; refusing rather than checking a partial list.')
    }
    for (const record of worktrees.stdout.split('\0')) {
      if (!record.startsWith('worktree ')) continue
      const path = physicalPath(record.slice('worktree '.length))
      if (path) this.repoRoots.push(path)
    }

    // Fail closed, exactly like the worktree enumeration above. Silently
    // skipping a probe that failed -- or a path that would not resolve --
    // left the git storage directories out of repoRoots while
    // internals.md still promised they were part of the protected boundary,
    // so a CODEX_HOME inside repository metadata could be approved on the
    // strength of a list that was never complete. A partial boundary is not
    // evidence that a path lies outside it.
    for (const args of [
      ['rev-parse', '--absolute-git-dir'],
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    ]) {
      const result = this.git(args)
      if (result.status !== 0 || !result.stdout.trim()) {
        die(3,
          `error: could not resolve the repository's git storage directory (\`git ${args.join(' ')}\`).`,
          'hint: every git storage path has to be known before a scratch or CODEX_HOME path can be called outside the repository; refusing rather than checking a partial boundary.')
      }
      const path = physicalPath(result.stdout.trim())
      if (!path) {
        die(3,
          `error: the repository's git storage directory (${flat(result.stdout.trim())}) could not be resolved to a real path.`,
          'hint: every git storage path has to be known before a scratch or CODEX_HOME path can be called outside the repository; refusing rather than checking a partial boundary.')
      }
      this.repoRoots.push(path)
    }
    this.repoRoots = [...new Set(this.repoRoots)]
  }

  resolveScratchAndCodexHome() {
    const requestedScratch = process.env.TMPDIR || tmpdir()
    let scratch = physicalPath(requestedScratch)
    if (!scratch) {
      scratch = physicalPath('/tmp') || '/tmp'
      this.baseEnv.TMPDIR = scratch
    }

    if (!process.env.CODEX_HOME && !process.env.HOME) {
      die(3,
        'error: neither CODEX_HOME nor HOME is set, so where codex would write its sessions cannot be determined',
        'hint: set CODEX_HOME explicitly, outside the repository.')
    }
    const codexHome = process.env.CODEX_HOME || join(process.env.HOME, '.codex')
    if (hasLineBreak(codexHome)) {
      die(3, "error: CODEX_HOME contains a line break, which would forge marker lines in this script's output")
    }

    const homeInput = isAbsolute(codexHome) ? codexHome : join(this.cwd, codexHome)
    const absoluteHome = resolvePathSemantics(homeInput)
    if (!absoluteHome) {
      die(3,
        `error: CODEX_HOME (${flat(codexHome)}) could not be walked to a destination (too many path components, or a symlink cycle).`,
        'error: where codex would write cannot be established, so whether it lands inside the repository cannot be decided; refusing to start.',
        'hint: point CODEX_HOME at a plain absolute path outside the repository.')
    }
    const homeAncestor = nearestExistingAncestor(absoluteHome)
    const destinations = [absoluteHome]
    if (homeAncestor) destinations.push(homeAncestor)

    const sessions = join(absoluteHome, 'sessions')
    if (isDirectory(absoluteHome) && exists(sessions)) {
      let sessionDestination
      if (isSymlink(sessions)) sessionDestination = resolveLinkChain(sessions)
      else sessionDestination = physicalPath(sessions)
      if (!sessionDestination) {
        die(3,
          `error: ${flat(sessions)} exists but could not be entered, so where codex would write cannot be established`,
          'hint: make it readable, or point CODEX_HOME somewhere else, outside the repository.')
      }
      if (exists(sessionDestination) && !isDirectory(sessions)) {
        die(3,
          `error: ${flat(sessions)} exists but could not be entered, so where codex would write cannot be established`,
          'hint: make it a readable directory, or point CODEX_HOME somewhere else, outside the repository.')
      }
      destinations.push(sessionDestination)
      const ancestor = nearestExistingAncestor(sessionDestination)
      if (ancestor) destinations.push(ancestor)
      if (isDirectory(sessions)) {
        try { accessSync(sessions, constants.R_OK | constants.X_OK) } catch {
          die(3,
            `error: ${flat(sessions)} exists but could not be entered, so where codex would write cannot be established`,
            'hint: make it readable, or point CODEX_HOME somewhere else, outside the repository.')
        }
        try {
          destinations.push(...collectSessionDestinations(sessions))
        } catch (error) {
          die(3,
            `error: could not enumerate the session directories under CODEX_HOME (${flat(error.message)}), so where codex would write cannot be established`,
            `hint: make ${sessionDestination} readable, or point CODEX_HOME elsewhere, outside the repository.`)
        }
      }
    } else if (isSymlink(sessions)) {
      const target = resolveLinkChain(sessions)
      destinations.push(target)
      const ancestor = nearestExistingAncestor(target)
      if (ancestor) destinations.push(ancestor)
    }

    if (destinations.some((path) => path && isInside(path, this.repoRoots))) {
      die(3,
        `error: CODEX_HOME (${flat(codexHome)}) resolves inside ${flat(this.worktreeRoot)} or its git storage.`,
        `error: codex writes every session under CODEX_HOME/sessions, so this ${this.state.runNoun} would write the repository it is reading; refusing to start.`,
        'hint: point CODEX_HOME outside the repository for this run.')
    }

    // sessions/ is a refusal because codex demonstrably writes there on every
    // single run. The rest of CODEX_HOME is a WARNING, and the difference is
    // deliberate: an install also carries archived_sessions, cache, .tmp,
    // attachments and automations, which codex does write -- but it equally
    // carries skills/ and prompts/, which it only READS, and linking those to
    // a directory inside a repository is a completely ordinary thing to do.
    // Measured: this machine has ~/.codex/skills/obsidian-authoring pointing
    // into this very repository, and refusing on the whole subtree made every
    // review of it impossible. Since this script cannot tell which of those
    // entries codex writes, it reports what it found and lets the caller
    // judge, rather than either refusing a normal setup or staying silent
    // about a genuinely redirected state directory.
    if (isDirectory(absoluteHome)) {
      let sweep = []
      try {
        sweep = collectSessionDestinations(absoluteHome, 2)
      } catch (error) {
        process.stderr.write(`warning: could not fully enumerate CODEX_HOME (${flat(error.message)}); entries below it were not checked against the repository\n`)
      }
      const inside = [...new Set(sweep.filter((path) => path && isInside(path, this.repoRoots)))]
      if (inside.length) {
        process.stderr.write(`warning: ${inside.length} path(s) under CODEX_HOME resolve inside ${flat(this.worktreeRoot)}:\n`)
        // Every path, not one example: the caller has to decide per entry
        // whether codex writes it, and cannot do that from a sample.
        for (const path of inside) process.stderr.write(`warning:   ${flat(path)}\n`)
        process.stderr.write('warning: codex READS some of what lives under CODEX_HOME (skills, prompts) and WRITES others (sessions, archived_sessions, caches, .tmp).\n')
        process.stderr.write('hint: if every path listed above is a read-only kind, this run is fine as-is. If any is one codex writes, stop, point CODEX_HOME outside the repository, and rerun -- otherwise this run may write the tree it is reading.\n')
      }
    }

    if (isInside(scratch, this.repoRoots)) {
      process.stderr.write('warning: TMPDIR is inside the repo; using /tmp instead\n')
      scratch = physicalPath('/tmp') || '/tmp'
      if (isInside(scratch, this.repoRoots)) {
        die(3, 'error: no temporary directory outside the repo; set TMPDIR elsewhere')
      }
      this.baseEnv.TMPDIR = scratch
    }
    if (hasLineBreak(scratch)) {
      die(3,
        'error: the temporary directory path contains a line break, which would forge marker lines in this script\'s output',
        'hint: set TMPDIR to a path without one.')
    }
    try { accessSync(scratch, constants.R_OK | constants.W_OK | constants.X_OK) } catch {
      die(3, `error: cannot create the throwaway index or scratch files under ${flat(scratch)}`)
    }
    this.scratch = scratch

    // Hand the child the paths that were actually validated, not the
    // spellings they were validated from. Everything above resolves
    // CODEX_HOME and TMPDIR through their symlinks and then checks the
    // destination -- but leaving the original, still-indirect strings in
    // baseEnv meant codex re-walked them itself at spawn time, which can be
    // minutes later. Retargeting a symlink component in that window moved
    // codex's writes somewhere the placement check never saw. This is the
    // same reasoning that makes resolveCodexBin pin a dereferenced binary
    // path instead of a symlink, applied to the two storage paths; it
    // narrows the same TOCTOU window rather than claiming to close it,
    // since a pathname is still not a handle.
    this.baseEnv.CODEX_HOME = absoluteHome
    this.baseEnv.TMPDIR = scratch
    this.codexHome = absoluteHome
  }

  verifyFeatures() {
    const args = ['features', 'list', '--disable', 'hooks', '--disable', 'apps', '--disable', 'plugins']
    const features = this.command(this.codexBin, args, { argv0: this.codexArgv0 })
    let featureText = features.stdout
    if (features.status !== 0) {
      featureText = ''
      const version = this.command(this.codexBin, ['--version'], { argv0: this.codexArgv0 })
      if (version.status !== 0) {
        die(3,
          `error: '${this.codexBin}' is not runnable.`,
          '',
          'A codex on PATH that fails --version usually means a broken install',
          '(a shell-function wrapper, or an npm shim whose vendored binary is',
          "missing) rather than a missing one. Try 'codex update', or set",
          'CODEX_BIN to a working binary.')
      }
    }

    const states = new Map()
    for (const line of featureText.split(/\r?\n/)) {
      const fields = line.trim().split(/\s+/)
      if (['hooks', 'apps', 'plugins'].includes(fields[0])) states.set(fields[0], fields.at(-1))
    }
    for (const feature of ['hooks', 'apps', 'plugins']) {
      const state = states.get(feature) || 'unknown'
      if (state !== 'false') {
        die(3,
          `error: codex ${feature} stay enabled (effective state: '${state}').`,
          `error: ${feature} act outside the read-only sandbox, so this ${this.state.runNoun} could write; refusing to start.`)
      }
    }
  }

  verifyMcp() {
    const base = ['mcp', 'list', '--json', '--disable', 'hooks', '--disable', 'apps', '--disable', 'plugins']
    const listing = this.command(this.codexBin, base, { argv0: this.codexArgv0 })
    let problem = null
    let enabled = []
    if (listing.status !== 0) {
      problem = "could not verify standalone MCP exposure ('codex mcp list' failed)"
    } else {
      try {
        enabled = enabledMcpServers(listing.stdout.trimEnd())
        for (const entry of enabled) assertAddressableMcpName(entry.name)
      } catch (error) {
        problem = error instanceof McpShapeError ? error.message : `could not parse standalone MCP exposure (${error.message})`
      }
    }

    const overrides = enabled.flatMap(({ name }) => ['-c', `mcp_servers.${name}.enabled=false`])
    if (!problem && enabled.length && !this.state.allowMcp) {
      const verify = this.command(this.codexBin, [...base, ...overrides], { argv0: this.codexArgv0 })
      if (verify.status !== 0) {
        problem = "could not confirm the standalone MCP servers were switched off ('codex mcp list' failed on the re-check)"
      } else {
        try {
          const left = enabledMcpServers(verify.stdout.trimEnd())
          if (left.length) problem = `standalone MCP server(s) still enabled after being switched off: ${left.map((x) => x.name).join(' ')}`
        } catch (error) {
          if (error.message.includes('unrecognized')) {
            problem = 'could not confirm the standalone MCP servers were switched off (unrecognized re-check output)'
          } else if (error.message.includes('incomplete') || error.message.includes('malformed')) {
            problem = 'could not confirm the standalone MCP servers were switched off (incomplete re-check output)'
          } else {
            problem = `could not confirm the standalone MCP servers were switched off (${error.message})`
          }
        }
      }
    }

    if (problem) {
      if (this.state.allowMcp) {
        process.stderr.write(`warning: ${problem}; proceeding because --allow-mcp was set\n`)
        process.stderr.write('warning: local commands stay read-only, but MCP tools may mutate external systems\n')
        return
      }
      die(3,
        `error: ${problem}.`,
        'error: refusing to start because MCP tools may mutate external systems.',
        'hint: disable those servers, or use --allow-mcp only after the user explicitly accepts that risk.')
    }

    if (enabled.length && this.state.allowMcp) {
      process.stderr.write(`warning: leaving ${enabled.length} enabled standalone MCP server(s) reachable because --allow-mcp was set\n`)
      process.stderr.write('warning: local commands stay read-only, but MCP tools may mutate external systems\n')
    } else if (enabled.length) {
      this.mcpArgs = overrides
      process.stderr.write(`note: disabled ${enabled.length} enabled standalone MCP server(s) for this ${this.state.runNoun}; pass --allow-mcp to keep them\n`)
    }
  }

  readonlyGit(args) {
    const indexPath = this.git(['rev-parse', '--git-path', 'index'])
    if (indexPath.status !== 0 || !indexPath.stdout.trim() || !exists(indexPath.stdout.trim())) {
      return this.git(args)
    }
    let directory
    try {
      directory = mkdtempSync(join(this.scratch, 'codex-idx-'))
      const copy = join(directory, 'index')
      copyFileSync(indexPath.stdout.trim(), copy)
      return this.git(args, { env: { GIT_INDEX_FILE: copy } })
    } catch {
      die(3,
        `error: cannot create the throwaway index under ${this.scratch}`,
        `error: refusing to run a working-tree git command that would rewrite ${indexPath.stdout.trim()}`)
    } finally {
      if (directory) rmSync(directory, { recursive: true, force: true })
    }
  }

  createArtifacts(mode) {
    // Tracked so a failure partway through does not leave the directories it
    // already made behind: this runs before codex is reached, an exit here is
    // a `3`, and SKILL.md says a `3` leaves no artifacts.
    let outDir = null
    let logDir = null
    try {
      outDir = mkdtempSync(join(this.scratch, `codex-${mode}-`))
      logDir = mkdtempSync(join(this.scratch, `codex-${mode}-log-`))
      const out = join(outDir, 'result.md')
      const log = join(logDir, 'events.jsonl')
      closeSync(openSync(out, 'wx', 0o600))
      closeSync(openSync(log, 'wx', 0o600))
      process.stderr.write(`log: ${log}\n`)
      return { out, outDir, log, logDir }
    } catch {
      for (const directory of [outDir, logDir]) {
        if (directory) rmSync(directory, { recursive: true, force: true })
      }
      die(3, `error: cannot create scratch files under ${this.scratch}`)
    }
  }
}

export const environmentInternals = { resolveLinkChain, resolvePathSemantics, collectSessionDestinations, resolveOnPath, resolveReal }
