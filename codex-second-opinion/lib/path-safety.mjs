import {
  accessSync,
  constants,
  lstatSync,
  readlinkSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path'
import { absolutePathEntries, hasLineBreak, isInside, lexicallyResolve, nearestExistingAncestor, physicalPath } from './util.mjs'

export function exists(path) {
  try { lstatSync(path); return true } catch { return false }
}

export function isDirectory(path) {
  try { return statSync(path).isDirectory() } catch { return false }
}

export function isSymlink(path) {
  try { return lstatSync(path).isSymbolicLink() } catch { return false }
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
export function resolvePathSemantics(input) {
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

// Walks up for a `.git` entry -- a file counts, since a linked worktree or a
// submodule checkout has a gitfile rather than a directory. Returns the
// starting point when nothing is found, which keeps the caller's filter at
// least as strict as before rather than opening it up.
export function enclosingRepositoryRoot(start) {
  let current = start
  for (;;) {
    if (exists(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return start
    current = parent
  }
}

// Returns { logical, destination } pairs. The logical side is the path AS
// SPELLED under root -- `<CODEX_HOME>/skills/x`, not the `/repo/x` it lands
// on -- because a caller warning about a redirect has to name the entry doing
// the redirecting: "skills" is a directory codex only reads, "cache" is one it
// writes, and the destination alone cannot tell those apart (both can point at
// the same place).
export function collectSessionDestinations(root, maxDepth = 3) {
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
      if (entry.isSymbolicLink()) {
        target = resolvePathSemantics(child)
        if (!target) throw new Error(`${child} could not be resolved (symlink cycle or too many components)`)
      }
      const real = physicalPath(target)
      const destination = real || target
      destinations.push({ logical: child, destination })
      const ancestor = nearestExistingAncestor(destination)
      if (ancestor) destinations.push({ logical: child, destination: ancestor })

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
export function resolveOnPath(name, pathValue) {
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
export function resolveReal(path) {
  const resolved = physicalPath(path)
  return resolved && !hasLineBreak(resolved) ? resolved : null
}
