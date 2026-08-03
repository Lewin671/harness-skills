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
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { assertAddressableMcpName, enabledMcpServers, McpShapeError } from './mcp.mjs'
import {
  die,
  flat,
  hasLineBreak,
  isInside,
  lexicallyResolve,
  nearestExistingAncestor,
  physicalPath,
  run,
} from './util.mjs'

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
      if (seen.has(key)) return lexicallyResolve(candidate)
      seen.add(key)
      const target = readlinkSync(candidate)
      const expanded = isAbsolute(target) ? target : join(current, target)
      pending = [...expanded.slice(parse(expanded).root.length).split(sep).filter(Boolean), ...pending]
      current = parse(expanded).root
    } else {
      current = candidate
    }
  }
  return current
}

function collectSessionDestinations(root, maxDepth = 3) {
  const destinations = []
  const visit = (logical, depth, ancestry) => {
    if (depth > maxDepth) return
    let entries
    try {
      entries = readdirSync(logical, { withFileTypes: true })
    } catch (error) {
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

export class Environment {
  constructor(state) {
    this.state = state
    this.cwd = null
    this.repoRoots = []
    this.scratch = null
    this.codexBin = process.env.CODEX_BIN || 'codex'
    this.mcpArgs = []
    this.baseEnv = { ...process.env }
    for (const key of GIT_ENV_KEYS) delete this.baseEnv[key]
    delete this.baseEnv.CDPATH
  }

  command(command, args, options = {}) {
    return run(command, args, {
      cwd: options.cwd || this.cwd || process.cwd(),
      env: { ...this.baseEnv, ...(options.env || {}) },
      input: options.input,
      encoding: options.encoding,
      stdio: options.stdio,
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

    const workTree = this.git(['rev-parse', '--is-inside-work-tree'])
    if (workTree.status !== 0 || workTree.stdout.trim() !== 'true') {
      die(3, `error: ${flat(this.state.repo)} is not a git work tree`)
    }

    this.resolveRepositoryRoots()
    this.resolveScratchAndCodexHome()
    this.baseEnv.GIT_NO_LAZY_FETCH = '1'
    this.verifyFeatures()
    this.verifyMcp()
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

    for (const args of [
      ['rev-parse', '--absolute-git-dir'],
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    ]) {
      const result = this.git(args)
      if (result.status === 0 && result.stdout.trim()) {
        const path = physicalPath(result.stdout.trim())
        if (path) this.repoRoots.push(path)
      }
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
  }

  verifyFeatures() {
    const args = ['features', 'list', '--disable', 'hooks', '--disable', 'apps', '--disable', 'plugins']
    const features = this.command(this.codexBin, args)
    let featureText = features.stdout
    if (features.status !== 0) {
      featureText = ''
      const version = this.command(this.codexBin, ['--version'])
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
    const listing = this.command(this.codexBin, base)
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
      const verify = this.command(this.codexBin, [...base, ...overrides])
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
    try {
      const outDir = mkdtempSync(join(this.scratch, `codex-${mode}-`))
      const logDir = mkdtempSync(join(this.scratch, `codex-${mode}-log-`))
      const out = join(outDir, 'result.md')
      const log = join(logDir, 'events.jsonl')
      closeSync(openSync(out, 'wx', 0o600))
      closeSync(openSync(log, 'wx', 0o600))
      process.stderr.write(`log: ${log}\n`)
      return { out, log }
    } catch {
      die(3, `error: cannot create scratch files under ${this.scratch}`)
    }
  }
}

export const environmentInternals = { resolveLinkChain, resolvePathSemantics, collectSessionDestinations }
