/**
 * densable 2.1.216 worktree git isolation (XB / Ros / shared-checkout guard).
 *
 * Prevents worktree-isolated agents from retargeting git at the shared
 * checkout via GIT_DIR/GIT_WORK_TREE, `git -C`, `--git-dir`, or `--work-tree`.
 */

import { basename, isAbsolute, normalize, resolve } from 'path'
import { getOriginalCwd } from '../bootstrap/state.js'
import { getCwd, getCwdOverride } from './cwd.js'

/**
 * Optional session provider registered by worktree.ts to avoid a circular
 * import (worktree.ts → this module for XB; this module → session for guard).
 */
type WorktreeSessionLike = {
  worktreePath: string
  originalCwd: string
}
let worktreeSessionProvider: (() => WorktreeSessionLike | null) | undefined

export function registerWorktreeSessionProvider(
  provider: () => WorktreeSessionLike | null,
): void {
  worktreeSessionProvider = provider
}

/** densable XB — scrub worktree-redirecting git env for subprocesses. */
export function scrubGitEnvForWorktree(
  extra?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_DIR: undefined,
    GIT_WORK_TREE: undefined,
    GIT_COMMON_DIR: undefined,
    GIT_INDEX_FILE: undefined,
    ...extra,
  }
}

/**
 * densable Ros — env names that retarget git's repository.
 * J9g also treats GIT_CONFIG*, HOME, CDPATH, XDG_CONFIG_HOME as redirectors.
 */
export const WORKTREE_GIT_REDIRECT_ENV = new Set([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_INDEX_FILE',
  'GIT_SHALLOW_FILE',
])

/** densable U9g — opaque git flags (unverified injection). */
export const WORKTREE_GIT_OPAQUE_FLAGS = new Set([
  '--namespace',
  '--attr-source',
  '--shallow-file',
])

/** densable q9g — value-taking pins that retarget the repo. */
export const WORKTREE_GIT_PIN_FLAGS = ['--git-dir', '--work-tree'] as const

/** densable xos — git binary name. */
const GIT_BINARY_RE = /^git(?:\.exe|\.real|-[a-z][\w-]*)?$/i

export function isGitBinaryName(name: string): boolean {
  return GIT_BINARY_RE.test(basename(name))
}

/** densable J9g */
export function isWorktreeGitRedirectEnvName(name: string): boolean {
  const upper = name.toUpperCase()
  return (
    WORKTREE_GIT_REDIRECT_ENV.has(upper) ||
    upper.startsWith('GIT_CONFIG') ||
    upper === 'HOME' ||
    upper === 'CDPATH' ||
    upper === 'XDG_CONFIG_HOME'
  )
}

export type WorktreeGitIsolationContext = {
  worktreePath: string
  sharedCheckout: string
}

/**
 * Active worktree isolation: EnterWorktree session, or agent cwd override
 * under `.claude/worktrees/` (isolation: "worktree").
 */
export function getWorktreeGitIsolationContext(
  cwd: string = getCwd(),
): WorktreeGitIsolationContext | null {
  const session = worktreeSessionProvider?.() ?? null
  if (session) {
    return {
      worktreePath: session.worktreePath,
      sharedCheckout: session.originalCwd,
    }
  }

  const override = getCwdOverride()
  if (override && isClaudeWorktreesPath(override)) {
    return {
      worktreePath: override,
      sharedCheckout: getOriginalCwd(),
    }
  }

  // Fallback: cwd itself is a managed worktree path (e.g. process.chdir)
  if (isClaudeWorktreesPath(cwd)) {
    const original = getOriginalCwd()
    if (!pathsEqualForGit(cwd, original)) {
      return { worktreePath: cwd, sharedCheckout: original }
    }
  }

  return null
}

export function isClaudeWorktreesPath(path: string): boolean {
  const n = path.replace(/\\/g, '/')
  return n.includes('/.claude/worktrees/')
}

function normalizeGitPath(p: string): string {
  return normalize(resolve(p)).replace(/\\/g, '/').replace(/\/+$/, '')
}

function pathsEqualForGit(a: string, b: string): boolean {
  const na = normalizeGitPath(a)
  const nb = normalizeGitPath(b)
  if (process.platform === 'win32') {
    return na.toLowerCase() === nb.toLowerCase()
  }
  return na === nb
}

/**
 * densable prr — path targets the shared checkout (exact root, or its .git dir).
 */
function targetsSharedCheckout(
  resolved: string,
  sharedCheckout: string,
): boolean {
  if (pathsEqualForGit(resolved, sharedCheckout)) {
    return true
  }
  // GIT_DIR often points at <shared>/.git
  if (pathsEqualForGit(resolved, `${normalizeGitPath(sharedCheckout)}/.git`)) {
    return true
  }
  return false
}

/**
 * Resolve a path token relative to base. Returns null if not statically
 * verifiable (contains `$`, `` ` ``, unquoted wildcards, etc.).
 */
export function resolveStaticPath(
  token: string,
  base: string,
  hasUnquotedGlob = false,
): string | null {
  let t = token.trim()
  if (!t) return null
  // strip matching quotes
  if (
    (t.startsWith("'") && t.endsWith("'")) ||
    (t.startsWith('"') && t.endsWith('"'))
  ) {
    t = t.slice(1, -1)
  }
  if (!t) return null
  if (
    hasUnquotedGlob ||
    /[*$`?]/.test(t) ||
    t.includes('${') ||
    t.includes('~')
  ) {
    return null
  }
  // refuse proc/dev fd tricks (densable bxu / Sxu subset)
  if (/(^|[\\/])proc[\\/](self|thread-self|\d+)([\\/]|$)/i.test(t)) {
    return null
  }
  if (/(^|[\\/])dev[\\/](fd|stdin|stdout|stderr)([\\/]|$)/i.test(t)) {
    return null
  }
  return isAbsolute(t) ? resolve(t) : resolve(base, t)
}

export type GitArgvRedirect =
  | { kind: 'opaque'; flag: string }
  | {
      kind: 'pins'
      chdirs: string[]
      pins: { flag: string; value: string }[]
      bare: boolean
    }

/**
 * Scan argv after the git binary for -C / --git-dir / --work-tree / --bare
 * and opaque U9g flags. densable vxu simplified for single-command argv.
 */
export function extractGitRedirectsFromArgv(argv: string[]): GitArgvRedirect {
  const chdirs: string[] = []
  const pins: { flag: string; value: string }[] = []
  let bare = false

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--') break
    if (WORKTREE_GIT_OPAQUE_FLAGS.has(a)) {
      return { kind: 'opaque', flag: a }
    }
    for (const flag of WORKTREE_GIT_OPAQUE_FLAGS) {
      if (a.startsWith(`${flag}=`)) {
        return { kind: 'opaque', flag }
      }
    }
    if (a === '-C') {
      const v = argv[i + 1]
      if (v !== undefined) {
        chdirs.push(v)
        i++
      }
      continue
    }
    if (a.startsWith('-C') && a.length > 2 && !a.startsWith('--')) {
      // rare compact form -Cpath
      chdirs.push(a.slice(2))
      continue
    }
    if (a === '--bare') {
      bare = true
      continue
    }
    let matchedPin = false
    for (const flag of WORKTREE_GIT_PIN_FLAGS) {
      if (a === flag) {
        const v = argv[i + 1]
        if (v !== undefined) {
          pins.push({ flag, value: v })
          i++
        }
        matchedPin = true
        break
      }
      if (a.startsWith(`${flag}=`)) {
        pins.push({ flag, value: a.slice(flag.length + 1) })
        matchedPin = true
        break
      }
    }
    if (matchedPin) {
      continue
    }
    // stop at first non-option that is not a pin we care about — git options
    // before subcommand; keep scanning only pure flags without values we ignore
    if (!a.startsWith('-')) {
      // subcommand — stop scanning global options
      break
    }
  }
  return { kind: 'pins', chdirs, pins, bare }
}

const PREFIX_ASSIGN_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s

/**
 * Lightweight token split for guard (not a full shell parser).
 * Good enough for `GIT_DIR=/x git status` and `git -C /x status`.
 */
export function roughShellTokens(command: string): string[] {
  const tokens: string[] = []
  let cur = ''
  let quote: "'" | '"' | null = null
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!
    if (quote) {
      if (ch === quote) {
        quote = null
      } else {
        cur += ch
      }
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (cur) {
        tokens.push(cur)
        cur = ''
      }
      continue
    }
    // split on shell operators (compound) — analyze each segment separately
    if (ch === '|' || ch === '&' || ch === ';' || ch === '\n') {
      if (cur) {
        tokens.push(cur)
        cur = ''
      }
      tokens.push(ch)
      // swallow && ||
      if ((ch === '|' || ch === '&') && command[i + 1] === ch) {
        tokens[tokens.length - 1] = ch + ch
        i++
      }
      continue
    }
    cur += ch
  }
  if (cur) tokens.push(cur)
  return tokens
}

function splitCompound(tokens: string[]): string[][] {
  const segments: string[][] = []
  let cur: string[] = []
  for (const t of tokens) {
    if (
      t === '|' ||
      t === '||' ||
      t === '&' ||
      t === '&&' ||
      t === ';' ||
      t === '\n'
    ) {
      if (cur.length) segments.push(cur)
      cur = []
      continue
    }
    cur.push(t)
  }
  if (cur.length) segments.push(cur)
  return segments
}

/**
 * densable shared-checkout command guard (simplified single-pass).
 * Returns deny reason string or null if allowed / not applicable.
 */
export function checkWorktreeSharedCheckoutGitRedirect(
  command: string,
  isolation: WorktreeGitIsolationContext,
): string | null {
  const tokens = roughShellTokens(command)
  const segments = splitCompound(tokens)
  const shared = isolation.sharedCheckout
  const worktree = isolation.worktreePath

  for (const seg of segments) {
    if (seg.length === 0) continue

    // Collect leading VAR=value assignments
    let i = 0
    const assignments: { name: string; value: string }[] = []
    while (i < seg.length) {
      const m = PREFIX_ASSIGN_RE.exec(seg[i]!)
      if (!m) break
      assignments.push({ name: m[1]!, value: m[2] ?? '' })
      i++
    }
    const argv = seg.slice(i)
    if (argv.length === 0) {
      // bare assignments only — densable: assigns redirect env → deny
      for (const { name } of assignments) {
        if (isWorktreeGitRedirectEnvName(name)) {
          return `assigns ${name}, which redirects git to a repository this guard cannot verify`
        }
      }
      continue
    }

    const bin = basename(argv[0]!)
    // env VAR=... git ...
    let gitArgvStart = 0
    if (bin.toLowerCase() === 'env') {
      let j = 1
      while (j < argv.length) {
        const a = argv[j]!
        if (a === '-C' || a === '--chdir') {
          const dir = argv[j + 1]
          if (dir !== undefined) {
            const resolved = resolveStaticPath(dir, worktree)
            if (resolved === null) {
              return `changes directory via env to a location computed at runtime (${dir}) before running git`
            }
            if (targetsSharedCheckout(resolved, shared)) {
              return `changes directory via env to the shared checkout (${dir}) before running git`
            }
            j += 2
            continue
          }
        }
        if (a.startsWith('--chdir=')) {
          j++
          continue
        }
        const am = PREFIX_ASSIGN_RE.exec(a)
        if (am) {
          assignments.push({ name: am[1]!, value: am[2] ?? '' })
          j++
          continue
        }
        if (a.startsWith('-')) {
          j++
          continue
        }
        break
      }
      gitArgvStart = j
    }

    const rest = argv.slice(gitArgvStart)
    const gitIdx = rest.findIndex(t => isGitBinaryName(t))
    if (gitIdx === -1) {
      // no git — still block export of redirect env alone when command is gitless assignment export
      for (const { name } of assignments) {
        if (isWorktreeGitRedirectEnvName(name) && isGitBinaryName(bin)) {
          // handled below
        }
      }
      continue
    }

    // Assignments that redirect git
    for (const { name, value } of assignments) {
      if (!isWorktreeGitRedirectEnvName(name)) continue
      const resolved = resolveStaticPath(value, worktree)
      if (resolved === null) {
        return `sets ${name} to a location computed at runtime (${value}), which can't be verified before it runs`
      }
      if (targetsSharedCheckout(resolved, shared)) {
        return `sets ${name} to the shared checkout (${value})`
      }
      // densable: any redirect env assignment beyond baseline is suspicious for
      // HOME/CDPATH/XDG and GIT_CONFIG* even if not shared — keep strict for Ros set
      if (WORKTREE_GIT_REDIRECT_ENV.has(name.toUpperCase())) {
        // non-shared but still retargets repo — densable verifies against shared only
        // for pins; for env assignment of Ros keys to non-shared still may be OK
        // if not shared. Allow non-shared static paths.
      }
    }

    const afterGit = rest.slice(gitIdx + 1)
    const redirects = extractGitRedirectsFromArgv(afterGit)
    if (redirects.kind === 'opaque') {
      return `passes ${redirects.flag} to git, injecting configuration whose effect on where git writes can't be verified`
    }

    let effectiveDir = worktree
    for (const d of redirects.chdirs) {
      const resolved = resolveStaticPath(d, effectiveDir)
      if (resolved === null) {
        return `points git at a directory computed at runtime (-C ${d}), which can't be verified before it runs`
      }
      effectiveDir = resolved
      if (targetsSharedCheckout(resolved, shared)) {
        return `redirects git to the shared checkout via -C`
      }
    }
    for (const { flag, value } of redirects.pins) {
      const resolved = resolveStaticPath(value, effectiveDir)
      if (resolved === null) {
        return `points git at a repository computed at runtime (${flag} ${value}), which can't be verified before it runs`
      }
      if (targetsSharedCheckout(resolved, shared)) {
        return `redirects git to the shared checkout via ${flag}`
      }
    }
  }

  return null
}

/**
 * Convenience for BashTool: deny message or null.
 */
export function denyWorktreeGitRedirectIfNeeded(
  command: string,
  cwd: string = getCwd(),
): string | null {
  const isolation = getWorktreeGitIsolationContext(cwd)
  if (!isolation) return null
  // If shared and worktree resolve equal, isolation is a no-op
  if (pathsEqualForGit(isolation.worktreePath, isolation.sharedCheckout)) {
    return null
  }
  return checkWorktreeSharedCheckoutGitRedirect(command, isolation)
}
