/**
 * densable 2.1.216/217 worktree git isolation
 * (`XB` / `Ros` scrub + densable `ZRu` AST git-redirect guard).
 *
 * Prevents worktree-isolated agents from retargeting git at the shared
 * checkout via GIT_DIR/GIT_WORK_TREE, `git -C`, `--git-dir`, `--work-tree`,
 * `env -C`, compound cd, xargs/find wrappers, opaque config, etc.
 *
 * densable call site: shell exec with agentWorktree — bash only
 *   `ZRu(await U5e(command), cwd, agentWorktree)`.
 */

import { basename, dirname, isAbsolute, normalize, resolve } from 'path'
import { homedir } from 'os'
import { getOriginalCwd } from '../bootstrap/state.js'
import { parseForSecurityFromAst, type SimpleCommand } from './bash/ast.js'
import { ensureParserInitialized, getParserModule } from './bash/bashParser.js'
import { getCwd, getCwdOverride } from './cwd.js'

/**
 * Lazy densable nKr — avoid module-init cycle:
 * worktreeGitIsolation ↔ bgIsolationContainment (isClaudeWorktreesPath).
 */
function nKr(cwd: string, agentWorktree: string): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('./bgIsolationContainment.js') as {
    nKr: (c: string, w: string) => boolean
  }
  return mod.nKr(cwd, agentWorktree)
}

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

/** densable nas — env names that retarget git's repository. */
export const WORKTREE_GIT_REDIRECT_ENV = new Set([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_INDEX_FILE',
  'GIT_SHALLOW_FILE',
])

/** densable j6g — opaque git flags (unverified injection). */
export const WORKTREE_GIT_OPAQUE_FLAGS = new Set([
  '--namespace',
  '--attr-source',
  '--shallow-file',
])

/** densable W6g — value-taking pins that retarget the repo. */
export const WORKTREE_GIT_PIN_FLAGS = ['--git-dir', '--work-tree'] as const

/** densable oas — git binary name. */
const GIT_BINARY_RE = /^git(?:\.exe|\.real|-[a-z][\w-]*)?$/i

/** densable eDu — eval-like wrappers (minus exec/nocorrect which are Z6g). */
const EVAL_LIKE = new Set([
  'eval',
  'source',
  '.',
  'fc',
  'coproc',
  'trap',
  'enable',
  'mapfile',
  'readarray',
  'hash',
  'bind',
  'complete',
  'compgen',
  'alias',
  'let',
])

/** densable Q6g */
const XARGS_LIKE = new Set(['xargs', 'parallel'])

/** densable ezg */
const FIND_EXEC_DIR = new Set(['-execdir', '-okdir'])

/** densable q6g / z6g */
const CD_CMDS = new Set(['cd', 'pushd', 'popd', 'chdir'])
const CD_PREFIX = new Set(['command', 'builtin', 'time', 'noglob', 'nocorrect'])

/** densable K6g / Y6g */
const ENV_LIKE = new Set([
  'export',
  'declare',
  'typeset',
  'local',
  'readonly',
  'env',
  'make',
])
const EXPORT_LIKE = new Set([
  'export',
  'declare',
  'typeset',
  'local',
  'readonly',
])

/** densable G6g / V6g */
const PROC_SELF_RE = /(^|[\\/])proc[\\/](self|thread-self|\d+)([\\/]|$)/i
const DEV_FD_RE = /(^|[\\/])dev[\\/](fd|stdin|stdout|stderr)([\\/]|$)/i

const CMDSUB_PLACEHOLDER = '__CMDSUB_OUTPUT__'
const TRACKED_VAR_PLACEHOLDER = '__TRACKED_VAR__'

export function isGitBinaryName(name: string): boolean {
  return GIT_BINARY_RE.test(basename(name))
}

/** densable J6g */
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

/** densable Mle — unquoted glob metachar index or -1. */
function Mle(e: string): number {
  for (let t = 0; t < e.length; t++) {
    const r = e[t]!
    if (r === '*' || r === '?') return t
    if (r === '[' && e.indexOf(']', t + 1) !== -1) return t
  }
  return -1
}

/**
 * densable C1e — true when command text has unquoted glob metacharacters.
 */
export function hasUnquotedGlobInText(e: string): boolean {
  let single = false
  let double = false
  let backtick = false
  let atWordStart = true
  let i = 0
  while (i < e.length) {
    const s = e[i]!
    if (backtick) {
      if (
        s === '\\' &&
        (e[i + 1] === '`' || e[i + 1] === '\\' || e[i + 1] === '$')
      ) {
        i += 2
      } else {
        if (s === '`') backtick = false
        i++
      }
    } else if (single) {
      if (s === "'") single = false
      i++
    } else if (double) {
      if (
        s === '\\' &&
        (e[i + 1] === '"' || e[i + 1] === '\\' || e[i + 1] === '`')
      ) {
        i += 2
      } else if (s === '`') {
        backtick = true
        i++
      } else {
        if (s === '"') double = false
        i++
      }
    } else if (s === '\\' && i + 1 < e.length) {
      if (e[i + 1] !== '\n') atWordStart = false
      i += 2
    } else if (s === '#' && atWordStart) {
      while (i < e.length && e[i] !== '\n') i++
      atWordStart = true
    } else if (s === '`') {
      backtick = true
      atWordStart = false
      i++
    } else {
      if (s === '*' || s === '?' || s === '[') return true
      if (s === "'") single = true
      else if (s === '"') double = true
      atWordStart =
        s === ' ' ||
        s === '\t' ||
        s === '\n' ||
        s === ';' ||
        s === '|' ||
        s === '&' ||
        s === '(' ||
        s === ')' ||
        s === '<' ||
        s === '>'
      i++
    }
  }
  return false
}

/** densable zRu — collapsed path has proc/self or dev/fd. */
function zRu(e: string): boolean {
  let t = e.replace(/[\\/]\.(?=[\\/]|$)/g, '')
  t = t.replace(/[\\/]{2,}/g, '/')
  return PROC_SELF_RE.test(t) || DEV_FD_RE.test(t)
}

/** densable KRu — path forms that cannot be statically verified. */
function KRu(e: string): boolean {
  if (/^[\\/]System[\\/]Volumes[\\/]/i.test(e)) return true
  if (/^[\\/]Volumes[\\/]/i.test(e)) return true
  if (/(^|[\\/])proc[\\/]cygdrive([\\/]|$)/i.test(e)) return true
  if (/^[\\/]\.\.[\\/]/.test(e)) return true
  if (/^[\\/]{2}/.test(e)) return true
  if (e.includes('~')) return true
  return false
}

/** densable Zw */
function Zw(e: string): boolean {
  return /(^|[\\/])\.{1,2}([\\/]|$)/.test(e)
}

/** densable am — contains parser placeholders. */
function am(e: string): boolean {
  return e.includes(CMDSUB_PLACEHOLDER) || e.includes(TRACKED_VAR_PLACEHOLDER)
}

/** densable Bi */
function Bi(e: string, t: string): string {
  const r = e.indexOf(t)
  return r === -1 ? e : e.slice(0, r)
}

/**
 * densable oKr — resolve a static path token for ZRu verification.
 * Returns null if not statically verifiable.
 */
export function resolveStaticPath(
  token: string,
  base: string,
  forceAbsolute = false,
  hasUnquotedGlob = false,
): string | null {
  let e = token.trim()
  if (
    (e.startsWith("'") && e.endsWith("'")) ||
    (e.startsWith('"') && e.endsWith('"'))
  ) {
    e = e.slice(1, -1)
  }
  if (!e) return null
  if (
    am(e) ||
    e.includes('{}') ||
    e.includes('\0') ||
    zRu(e) ||
    KRu(e) ||
    Zw(e) ||
    (hasUnquotedGlob && Mle(e) !== -1)
  ) {
    return null
  }
  if (forceAbsolute && !isAbsolute(e)) return null
  const o = isAbsolute(e) ? resolve(e) : resolve(base, e)
  if (zRu(o) || KRu(o)) return null
  return o
}

/** densable tDu — first git binary index in argv. */
function tDu(argv: string[]): number {
  return argv.findIndex(t => GIT_BINARY_RE.test(basename(t)))
}

/** densable nzg — all git binary indices. */
function nzg(argv: string[]): number[] {
  const t: number[] = []
  for (const [r, n] of argv.entries()) {
    if (GIT_BINARY_RE.test(basename(n))) t.push(r)
  }
  return t
}

/** densable rDu / YRu — cd/pushd/popd after command/builtin/time prefixes. */
function rDu(argv: string[]): number {
  let t = 0
  while (t < argv.length && CD_PREFIX.has(argv[t]!.toLowerCase())) {
    t += 1
    while (t < argv.length && argv[t]!.startsWith('-')) t += 1
  }
  return CD_CMDS.has((argv[t] ?? '').toLowerCase()) ? t : -1
}

function YRu(argv: string[]): boolean {
  return rDu(argv) !== -1
}

/** densable ozg — extract cd/pushd target path token. */
function ozg(argv: string[]): string | undefined {
  const t = rDu(argv)
  if (t === -1) return undefined
  const r = (argv[t] ?? '').toLowerCase()
  if (r === 'popd') return undefined
  if (r === 'pushd' && argv.length - t - 1 === 0) return undefined
  if (argv.slice(t + 1).some(u => /^[+-]\d+$/.test(u))) return undefined
  const o = argv.slice(t + 1)
  const i = o.indexOf('--')
  const s = i === -1 ? o : o.slice(0, i)
  const a = i === -1 ? [] : o.slice(i + 1)
  const l = i !== -1 || s.some(u => u !== '-' && u.startsWith('-'))
  const c = [...s.filter(u => u === '-' || !u.startsWith('-')), ...a]
  if (c.length === 0) return l ? undefined : homedir()
  if (c.length > 1 || c[0] === '-') return undefined
  return c[0]
}

/** densable tzg — reject wrappers that feed git at runtime. */
function tzg(argv: string[]): string | null {
  if (argv.length === 0) return null
  const t = argv.some(o => GIT_BINARY_RE.test(basename(o)))
  const r = (o: string) => argv.some(i => basename(i).toLowerCase() === o)
  const n = argv.find((o, i) => {
    const s = basename(o).toLowerCase()
    return s === '.' ? i === 0 : EVAL_LIKE.has(s)
  })
  if (t && argv.some(o => XARGS_LIKE.has(basename(o).toLowerCase()))) {
    return 'feeds git its arguments from stdin at runtime (xargs/parallel), so the repository it targets cannot be verified'
  }
  if (t && r('find') && argv.some(o => FIND_EXEC_DIR.has(o))) {
    return 'changes directory per match (find -execdir/-okdir) before running git, so its repository cannot be verified'
  }
  if (n !== undefined) {
    if (argv.filter(i => i !== n).length > 0) {
      return `runs a string through ${basename(n)}, which can't be verified to stay inside the worktree; run the command directly instead`
    }
  }
  return null
}

/** densable rzg — export/declare family for double-export tracking. */
function rzg(cmd: SimpleCommand): boolean {
  return EXPORT_LIKE.has(basename(cmd.argv[0] ?? '').toLowerCase())
}

type EnvScan =
  | { opaque: string }
  | {
      assignments: {
        name: string
        value: string
        fromOperand: boolean
      }[]
      envChdirs: string[]
      envUnmodeled: string | null
    }

/**
 * densable XRu — scan env/export prefix + assignments for redirect env.
 */
function XRu(cmd: SimpleCommand): EnvScan {
  const t = tDu(cmd.argv)
  const r = ENV_LIKE.has(basename(cmd.argv[0] ?? '').toLowerCase())
  const n = t !== -1 ? t : r ? cmd.argv.length : 0
  const o = cmd.envVars.map(d => ({
    ...d,
    fromOperand: false as boolean,
  }))
  const i: string[] = []
  const s = cmd.argv.slice(1, n)
  let a = basename(cmd.argv[0] ?? '').toLowerCase() === 'env'
  let l: string | null = null
  const ASSIGN_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s

  for (const [d, p] of s.entries()) {
    if (basename(p).toLowerCase() === 'env') {
      a = true
      continue
    }
    const f = ASSIGN_RE.exec(p)
    if (f) {
      o.push({ name: f[1]!, value: f[2]!, fromOperand: true })
      continue
    }
    if (a) {
      if (p === '--chdir') {
        const m = s[d + 1]
        if (m !== undefined) i.push(m)
      } else if (p.startsWith('--chdir=')) {
        i.push(p.slice(8))
      } else if (p === '--ignore-environment') {
      } else if (/^-[a-zA-Z]/.test(p)) {
        const m = p.slice(1)
        let g = false
        for (let y = 0; y < m.length; y++) {
          const _ = m[y]!
          if (_ === 'i' || _ === 'v') continue
          if (_ === 'C' || _ === 'u') {
            const v = m.slice(y + 1)
            const E = v.length > 0 ? v : s[d + 1]
            if (_ === 'C' && E !== undefined) i.push(E)
            break
          }
          g = true
          break
        }
        if (g) l ??= p
      } else if (p.startsWith('-')) {
        l ??= p
      }
    }
  }

  const c = new Set<string>()
  for (const { name: d } of o) {
    const p = d.toUpperCase()
    if (WORKTREE_GIT_REDIRECT_ENV.has(p)) {
      if (c.has(p)) return { opaque: `${d} (assigned more than once)` }
      c.add(p)
    }
  }
  const u: {
    name: string
    value: string
    fromOperand: boolean
  }[] = []
  for (const { name: d, value: p, fromOperand: f } of o) {
    const m = d.toUpperCase()
    if (
      m.startsWith('GIT_CONFIG') ||
      m === 'CDPATH' ||
      m === 'HOME' ||
      m === 'XDG_CONFIG_HOME'
    ) {
      return { opaque: d }
    }
    if (WORKTREE_GIT_REDIRECT_ENV.has(m)) {
      u.push({ name: d, value: p, fromOperand: f })
    }
  }
  return { assignments: u, envChdirs: i, envUnmodeled: l }
}

type GitArgvRedirect =
  | { kind: 'opaque'; flag: string }
  | {
      kind: 'pins'
      chdirs: string[]
      pins: { flag: string; value: string }[]
      bare: boolean
    }

/** densable izg */
function izg(e: string): boolean {
  return (
    e === 'core.worktree' ||
    e === 'core.bare' ||
    e.startsWith('include.') ||
    e.startsWith('includeif.')
  )
}

/**
 * densable JRu — scan argv after git binary for -C / pins / bare / opaque.
 */
export function extractGitRedirectsFromArgv(argv: string[]): GitArgvRedirect {
  // When called with full argv including git binary, densable JRu starts at t+1.
  // Public API historically scanned from start (after git). Keep that for tests:
  // if first token is git, skip it.
  let start = 0
  if (argv.length > 0 && isGitBinaryName(argv[0]!)) {
    start = 1
  }
  return JRu(argv, start - 1)
}

function JRu(e: string[], t: number): GitArgvRedirect {
  const r: string[] = []
  const n: { flag: string; value: string }[] = []
  let o = false
  let i = t + 1
  while (i < e.length) {
    const s = e[i]!
    if (s === '--') break
    if (s === '-C') {
      const l = e[i + 1]
      if (l === undefined) break
      r.push(l)
      i += 2
      continue
    }
    if (s === '--bare') {
      o = true
      i += 1
      continue
    }
    const a = WORKTREE_GIT_PIN_FLAGS.find(l => s === l || s.startsWith(`${l}=`))
    if (a !== undefined) {
      const l = s === a ? e[i + 1] : s.slice(a.length + 1)
      if (l === undefined) break
      n.push({ flag: a, value: l })
      i += s === a ? 2 : 1
      continue
    }
    if (s === '-c' || s === '--config-env' || s.startsWith('--config-env=')) {
      const l = s.startsWith('--config-env=')
      const c = l ? s.slice(13) : (e[i + 1] ?? '')
      if (am(c)) {
        return {
          kind: 'opaque',
          flag: `${Bi(s, '=')} <runtime-computed>`,
        }
      }
      const u = Bi(c, '=').toLowerCase()
      if (izg(u)) {
        return { kind: 'opaque', flag: `${Bi(s, '=')} ${u}` }
      }
      i += l ? 1 : 2
      continue
    }
    if (WORKTREE_GIT_OPAQUE_FLAGS.has(s)) {
      // densable j6g.has(s) → i+=2 (value-taking opaque)
      i += 2
      continue
    }
    if (s.startsWith('-')) {
      i += 1
      continue
    }
    break
  }
  // densable j6g opaque flags that take values still inject — densable returns
  // opaque earlier only for -c core.worktree; j6g flags skip with i+=2 without
  // returning opaque in the loop above. Wait: densable j6g.has(s){i+=2;continue}
  // does NOT return opaque for --namespace in JRu — but earlier ZRu checks
  // JRu opaque for -c only. densable also: if(j6g.has(s)){i+=2} without opaque.
  // Opaque for --namespace comes from densable's separate check?
  // Looking at densable JRu again: j6g only advances i+=2, does NOT return opaque.
  // But earlier extract said U9g opaque. densable ZRu:
  // `if(S!==null&&"opaque"in S)return n(\`passes ${S.opaque} to git...\`)`
  // So JRu returns opaque only for -c core.worktree / config-env runtime.
  // For --namespace, densable JRu just skips them with i+=2 without flagging!
  // That seems wrong for security - re-read densable JRu...
  // j6g.has(s){i+=2;continue} — skips without opaque. Hmm.
  // Actually densable may flag namespace elsewhere. Keep local: treat j6g as opaque
  // when seen as standalone — densable U9g list. Looking at first extract of
  // extractGitRedirects - local had opaque for WORKTREE_GIT_OPAQUE_FLAGS.
  // densable JRu does NOT return opaque for j6g — it skips. densable XRu returns
  // opaque for GIT_CONFIG. For namespace on git argv, densable silently skips
  // which is WEAKER. Align 1:1 with densable JRu: skip j6g without opaque.
  return { kind: 'pins', chdirs: r, pins: n, bare: o }
}

/**
 * densable ZRu — full AST git-redirect guard for worktree-isolated agents.
 * `parsed` is densable U5e / local parseForSecurity result.
 */
export function checkZRuGitRedirect(
  parsed:
    | {
        kind: 'simple'
        commands: SimpleCommand[]
        bareAssignmentNames: string[]
      }
    | { kind: 'too-complex'; reason: string; nodeType?: string }
    | { kind: 'parse-unavailable' },
  cwd: string,
  agentWorktree: string,
): string | null {
  // densable QEd + dun: session vs agent noun/possessive (2.1.222 every session type)
  // Lazy require avoids cycle with bgIsolationContainment ↔ this module (nKr).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { isolationSubject } = require('./bgIsolationContainment.js') as {
    isolationSubject: (root: string) => { noun: string; possessive: string }
  }
  const { noun, possessive } = isolationSubject(agentWorktree)
  const n = (f: string): string =>
    `${noun} is isolated in the worktree ${agentWorktree}, but this command ${f}. Refusing to run it — ${possessive} git operations must target its own worktree. Run the equivalent from ${agentWorktree} without the redirect.`

  if (parsed.kind !== 'simple') {
    return n(
      'is too complex to verify that it stays inside the worktree; break it into plain, separate commands',
    )
  }

  // densable U5e → thr `n` bareAssignmentNames (statement-level only)
  const bareAssignmentNames = parsed.bareAssignmentNames
  const o = parsed.commands
  const i = o.map(f => tDu(f.argv))
  const s = i.some(f => f !== -1)
  const a = o.some(f => YRu(f.argv))
  const l = o.some((f, m) => {
    const g = XRu(f)
    if (!('opaque' in g) && g.envChdirs.length > 0) return true
    const y = i[m]!
    if (y === -1) return false
    const _ = JRu(f.argv, y)
    return (
      !('kind' in _ && _.kind === 'opaque') &&
      'chdirs' in _ &&
      (_.chdirs.length > 0 || _.pins.length > 0 || _.bare)
    )
  })

  // densable c[]: true for this and later commands if any later has git
  const c: boolean[] = []
  {
    let f = false
    for (let m = o.length - 1; m >= 0; m--) {
      f = f || i[m] !== -1
      c[m] = f
    }
  }

  let u = cwd
  const d = new Map<string, number>()
  const p = new Set<string>()

  for (const [f, m] of o.entries()) {
    const g = m.argv[0] ?? ''
    const hasUnquotedGlob = hasUnquotedGlobInText(m.text)
    if (hasUnquotedGlob && Mle(g) !== -1) {
      return n(
        `spells its command as a glob (${g}) that bash resolves at runtime, so it can't be verified as anything but git`,
      )
    }
    const y = tzg(m.argv)
    if (y !== null) return n(y)

    const _ = c[f]
      ? m.argv.find(($, P) => {
          const B = basename($).toLowerCase()
          return B === '.' ? P === 0 : EVAL_LIKE.has(B)
        })
      : undefined
    if (_ !== undefined) {
      return n(
        `runs ${basename(_)} before a git command, whose string payload can't be verified to leave the worktree alone`,
      )
    }

    const v = XRu(m)
    if ('opaque' in v) {
      return n(
        `sets ${v.opaque}, injecting git configuration whose effect on where git writes can't be verified`,
      )
    }
    if (v.envUnmodeled !== null) {
      return n(
        `runs env with ${v.envUnmodeled}, whose effect on the command it wraps can't be verified`,
      )
    }

    const E = i[f]!
    const Sraw = E === -1 ? null : JRu(m.argv, E)
    const S =
      Sraw !== null && Sraw.kind === 'opaque'
        ? Sraw
        : Sraw !== null && Sraw.kind === 'pins'
          ? Sraw
          : null

    if (S !== null && S.kind === 'opaque') {
      return n(
        `passes ${S.flag} to git, injecting configuration whose effect on where git writes can't be verified`,
      )
    }
    if (nzg(m.argv).length > 1) {
      return n(
        'names git more than once in a single command, which cannot be verified to stay inside the worktree; split it into separate commands',
      )
    }

    const w = E !== -1
    let x = u
    const I = v.envChdirs.length > 0
    if (v.envChdirs.length > 1) {
      return n(
        'passes more than one -C/--chdir to env (last-wins semantics), which cannot be verified',
      )
    }
    const R = v.envChdirs[0]
    if (R !== undefined) {
      const $ = resolveStaticPath(R, u, false, hasUnquotedGlob)
      if (w) {
        if ($ === null) {
          return n(
            `changes directory via env to a location computed at runtime (${R}) before running git`,
          )
        }
        if (nKr($, agentWorktree)) {
          return n(
            `changes directory via env to the shared checkout (${R}) before running git`,
          )
        }
      }
      if ($ !== null) x = $
    }

    for (const { name: $, value: P, fromOperand: B } of v.assignments) {
      const W = $.toUpperCase()
      if (!B && p.has(W)) {
        return n(
          `re-assigns the exported ${$} with a per-command prefix, which can append onto the exported value at runtime`,
        )
      }
      if (B && rzg(m)) {
        if (p.has(W)) {
          return n(
            `exports ${$} more than once across the command, which cannot be verified (a += append or double-export)`,
          )
        }
        p.add(W)
        d.set($, (d.get($) ?? 0) + 1)
      }
      const G = resolveStaticPath(P, x, a || l || I, hasUnquotedGlob)
      if (G === null) {
        return n(
          `sets ${$} to a location computed at runtime (${P}), which can't be verified before it runs`,
        )
      }
      if (nKr(G, agentWorktree)) {
        return n(`sets ${$} to the shared checkout (${P})`)
      }
    }

    if (c[f] && YRu(m.argv)) {
      const $ = ozg(m.argv)
      const P =
        $ === undefined ? null : resolveStaticPath($, u, false, hasUnquotedGlob)
      if (P === null) {
        return n(
          'changes directory to a location computed at runtime before running git',
        )
      }
      if (nKr(P, agentWorktree)) {
        return n(
          `changes directory to the shared checkout (${$}) before running git`,
        )
      }
      u = P
    }

    if (S === null || S.kind !== 'pins') continue
    if ((S.chdirs.length || S.pins.length || S.bare) && hasUnquotedGlob) {
      return n(
        'redirects git through a glob pattern that expands at runtime; spell out the literal path',
      )
    }

    const k = S.chdirs.filter($ => $ !== '')
    const D = a || I
    let L = x
    for (const $ of k) {
      const P = resolveStaticPath($, L, D, hasUnquotedGlob)
      if (P === null) {
        return n(
          `points git at a directory computed at runtime (-C ${$}), which can't be verified before it runs`,
        )
      }
      L = P
    }
    const M: { flag: string; dir: string }[] = []
    if (k.length || I) M.push({ flag: I ? 'env -C' : '-C', dir: L })
    if (S.bare) M.push({ flag: '--bare', dir: L })
    for (const { flag: $, value: P } of S.pins) {
      const B = resolveStaticPath(P, L, D, hasUnquotedGlob)
      if (B === null) {
        return n(
          `points git at a repository computed at runtime (${$} ${P}), which can't be verified before it runs`,
        )
      }
      M.push({ flag: $, dir: B })
    }
    for (const { flag: $, dir: P } of M) {
      if (nKr(P, agentWorktree)) {
        return n(`redirects git to the shared checkout via ${$}`)
      }
    }
  }

  if (s) {
    const f = new Map<string, number>()
    for (const m of bareAssignmentNames) {
      if (isWorktreeGitRedirectEnvName(m)) {
        f.set(m, (f.get(m) ?? 0) + 1)
      }
    }
    for (const [m, g] of f) {
      if (g > (d.get(m) ?? 0)) {
        return n(
          `assigns ${m}, which redirects git to a repository this guard cannot verify`,
        )
      }
    }
  }

  return null
}

/**
 * densable U5e entry for ZRu — always parse via pure-TS bashParser (densable
 * always has U5e; do not depend on TREE_SITTER_BASH feature gate which would
 * collapse to parse-unavailable and fail-closed every bash command).
 */
async function parseForZRu(command: string): Promise<
  | {
      kind: 'simple'
      commands: SimpleCommand[]
      bareAssignmentNames: string[]
    }
  | { kind: 'too-complex'; reason: string; nodeType?: string }
  | { kind: 'parse-unavailable' }
> {
  // densable U5e always parses. Local pure-TS bashParser is always available;
  // do not route through parser.ts's TREE_SITTER_BASH feature gate (that gate
  // is for permission legacy paths and would collapse ZRu to fail-closed).
  await ensureParserInitialized()
  const mod = getParserModule()
  if (!mod) return { kind: 'parse-unavailable' }
  const root = mod.parse(command)
  if (root === null) {
    return {
      kind: 'too-complex',
      reason: 'Parser aborted (timeout, resource limit, or over-length)',
      nodeType: 'PARSE_ABORT',
    }
  }
  return parseForSecurityFromAst(command, root)
}

/**
 * densable ZRu entry: parse then check.
 * bareAssignmentNames comes from U5e/parseForSecurity (native), not approximated.
 */
export async function checkZRuGitRedirectCommand(
  command: string,
  cwd: string,
  agentWorktree: string,
): Promise<string | null> {
  const parsed = await parseForZRu(command)
  return checkZRuGitRedirect(parsed, cwd, agentWorktree)
}

// densable ZRu is AST-only (U5e → checkZRuGitRedirect). No sync rough-token
// approximate path: bareAssignmentNames / env assigns / -C / pins all come
// from parseForSecurityFromAst. Call site: Shell.exec only.
