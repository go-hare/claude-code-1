/**
 * densable `_583` `V()` + `pe`/`Be`/`qn`/`Zn`/`Ir` PATH jail.
 * Gold: gold-forged-V.txt / gold-forged-pe.txt / gold-forged-Be-bound.txt /
 * gold-forged-qn-reach.txt / gold-forged-Zn.txt / gold-forged-Ir.txt /
 * gold-forged-Pr.txt / gold-forged-tr.txt / gold-forged-Bn-ji.txt /
 * gold-forged-V-Fe.txt / gold-forged-Gr.txt / gold-forged-dollar-e.txt /
 * gold-forged-Zn-Ie-cn.txt / gold-forged-j-startup.txt
 *
 * Offsets (official-247 SEA): `V` @210541503, `Ir` @210559228,
 * `Zn` @210558360, `pe` @210557299, 127 `je`/`Tr` @210541815,
 * `$e`/`ni` @207162110 (`Qfd as $e` @210531489), `Ie` @210540281,
 * `cn` @210533172, `j`/`ot` @209216997 (`PYb as j` @210530724).
 * `Re` @210540017, `Qo` @206912790, `gt` @210532563, `S` @209040451.
 */

import { chmodSync, lstatSync, mkdirSync, readlinkSync, realpathSync } from 'fs'
import { homedir, tmpdir } from 'os'
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  resolve,
  sep,
} from 'path'
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import {
  getAdditionalDirectoriesForClaudeMd,
  getFlagSettingsPath,
} from '../../bootstrap/state.js'
import { execFileNoThrowWithCwd } from '../execFileNoThrow.js'
import { gitExe } from '../git.js'
import { getAppliedGlobalConfigEnv } from '../managedEnv.js'
import { expandPath, stripWindowsLongPathPrefixXpr } from '../path.js'
import { permissionRuleValueFromString } from '../permissions/permissionRuleParser.js'
import { getPlatform } from '../platform.js'
import {
  detectWorktreeMainRepoPath,
  resolvePathPatternForSandbox,
  resolveSandboxFilesystemPath,
} from '../sandbox/sandbox-adapter.js'
import { SETTING_SOURCES, type SettingSource } from '../settings/constants.js'
import { getSettingsForSource } from '../settings/settings.js'
import { seedPathContains } from './seedGitInclude.js'

/** densable `Fe` (`_` @ `_752`) */
export const SEED_GIT_FE = Object.freeze([
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=',
] as const)

/** densable `$r` */
export const SEED_GIT_HARDENED_C = Object.freeze([
  '-c',
  'submodule.recurse=false',
  '-c',
  'core.commitGraph=false',
  '-c',
  'core.multiPackIndex=false',
] as const)

/** densable `Hr` */
export const SEED_GIT_MAX_BUFFER = 67108864

/** densable `Dr` — `J` symlink hop cap */
const REALPATH_HOPS = 8

/** densable `je` */
export const SEED_GIT_NOT_FOUND =
  'git was not found on the PATH this process was started with'

/** densable `Tr` */
export const SEED_GIT_NOT_FOUND_BOUND = `${SEED_GIT_NOT_FOUND} (directories a cloud session bound here can write \u2014 inside this checkout or a checkout enclosing it, such as a worktree\u2019s main checkout; a session temp directory; one whose git links into those \u2014 are not searched)`

/** densable `kr` */
const JAIL_PATH_ENV = [
  'GIT_EXEC_PATH',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'LD_AUDIT',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'DYLD_FRAMEWORK_PATH',
  'DYLD_FALLBACK_LIBRARY_PATH',
  'DYLD_FALLBACK_FRAMEWORK_PATH',
] as const

/** densable `Rr` */
const PATH_EXES =
  getPlatform() === 'windows' ? ['git', 'powershell.exe'] : ['git', 'ps']

/** densable `Gt` / `xn` @ `_752` `ji` */
const GIT_SCRUB = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_CEILING_DIRECTORIES',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_SHALLOW_FILE',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG',
] as const

const GIT_SCRUB_SET = new Set(GIT_SCRUB)
/** densable `Rn` */
const GIT_CONFIG_KV = /^GIT_CONFIG_(KEY|VALUE)_\d+$/i

/** densable `Mr` */
export const SEED_GIT_MR: NodeJS.ProcessEnv = {
  GIT_ALLOW_PROTOCOL: 'file:git:http:https:ssh',
  GIT_TERMINAL_PROMPT: '0',
  GIT_NO_LAZY_FETCH: '1',
  GIT_NO_REPLACE_OBJECTS: '1',
  GIT_GRAFT_FILE:
    getPlatform() === 'windows'
      ? '\\\\.\\NUL\\no-grafts'
      : '/dev/null/no-grafts',
}

const pathFilterCache = new Map<string, string>()
/** densable `xn` — `Ir` caches successful `$e` only */
const gitWhichCache = new Map<string, string>()

/**
 * densable `_612` `oe.preSettingsEnvSnapshot`.
 * `get` lazily freezes `{...process.env}`; `peek`/`j()` is undefined until then.
 */
let preSettingsEnvSnapshot: NodeJS.ProcessEnv | undefined

/** densable `Gt` unused `t="/tmp"` — TEMP/TMP only, not TMPDIR */
const WIN_PATH_ENTRY = /^(?:[a-zA-Z]:[\\/]|[\\/]{2})/

export type SeedHardenedLayout = {
  gitDir: string
  commonDir: string
  workTree: string
  adminDir?: string
  bound?: boolean
  configPins?: Record<string, string>
}

export type SeedHardenedOpts = {
  layout?: SeedHardenedLayout
  reach?: string[]
  signal?: AbortSignal
  env?: NodeJS.ProcessEnv
  input?: string
  stripFinalNewline?: boolean
}

/** densable `V` third arg — missing `hardened` is the `!hardened` arm */
export type SeedGitOpts = SeedHardenedOpts & {
  hardened?: boolean
}

/** densable `R` / `y` @ `_695` */
function envGet(env: NodeJS.ProcessEnv, name: string): string | undefined {
  if (name in env) return env[name]
  if (getPlatform() !== 'windows') return
  const key = Object.keys(env).find(k => k.toUpperCase() === name.toUpperCase())
  return key === undefined ? undefined : env[key]
}

/**
 * densable `OYb` / `Ge` — first call captures process-start env.
 * Export so settings/bootstrap can import later.
 */
export function getPreSettingsEnvSnapshot(): NodeJS.ProcessEnv {
  return (preSettingsEnvSnapshot ??= Object.freeze({ ...process.env }))
}

/** densable `PYb` / `ot` / `j()` */
export function peekPreSettingsEnvSnapshot(): NodeJS.ProcessEnv | undefined {
  return preSettingsEnvSnapshot
}

/** densable `RYb` / `SYb` / `st` / `it` */
export function dropPreSettingsEnvSnapshot(): void {
  preSettingsEnvSnapshot = undefined
}

/** densable `j` / `_612` `PYb` / `ot` */
export function seedGitJ(): NodeJS.ProcessEnv | undefined {
  return peekPreSettingsEnvSnapshot()
}

/** densable `K` — home keys `Re` compares to the `j()` snapshot. */
const SEED_GIT_K = [
  'CLAUDE_CONFIG_DIR',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'CLAUDE_CODE_USE_COWORK_PLUGINS',
] as const

/** densable `Se` */
const SEED_GIT_SE = ['projectSettings', 'localSettings'] as const

/** densable `$n` / `QNc` — Vn windows case-fold filter. */
function seedGitDollarN(
  env: NodeJS.ProcessEnv,
  keep: (value: string | undefined, key: string) => boolean,
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (keep(value, key)) next[key] = value
  }
  return next
}

/** densable `_583` `Ft` — string `ee(source)?.env` into one object. */
function seedGitCollectSettingsEnv(
  sources: readonly SettingSource[],
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const source of sources) {
    try {
      const raw = getSettingsForSource(source)?.env
      if (!raw) continue
      for (const [key, value] of Object.entries(raw)) {
        if (typeof value === 'string') env[key] = value
      }
    } catch {
      // official Ft swallows loader throws
    }
  }
  return env
}

/**
 * densable `Pn` — `_n` is flagSettingsExpectedContent (unset host ⇒
 * undefined). `Pe` is `getFlagSettingsPath`.
 */
function seedGitPnDisabled(): readonly SettingSource[] {
  return getFlagSettingsPath() !== undefined
    ? [...SEED_GIT_SE, 'flagSettings']
    : SEED_GIT_SE
}

/** densable `Ct` */
function seedGitCt(): SettingSource[] {
  const disabled = seedGitPnDisabled()
  return SETTING_SOURCES.filter(source => !disabled.includes(source))
}

/**
 * densable `Re` — `{...Tn(), ...n?Ft(Ct()):{}}`.
 * `n` is snapshot missing or every `K` key unchanged vs `j()`.
 */
export function seedGitRe(): NodeJS.ProcessEnv {
  const snap = seedGitJ()
  const unchanged =
    snap === undefined ||
    SEED_GIT_K.every(key => envGet(process.env, key) === envGet(snap, key))
  return {
    ...getAppliedGlobalConfigEnv(),
    ...(unchanged ? seedGitCollectSettingsEnv(seedGitCt()) : {}),
  }
}

/**
 * densable `Vn` — overlay `Re()` on `j()`; Windows drops snapshot keys
 * that `Re` sets (case-insensitive) before spreading overlay.
 */
export function seedGitVn(): NodeJS.ProcessEnv {
  const snap = seedGitJ()
  if (snap === undefined) return process.env
  const overlay = seedGitRe()
  if (getPlatform() !== 'windows') return { ...snap, ...overlay }
  const taken = new Set(Object.keys(overlay).map(key => key.toUpperCase()))
  return {
    ...seedGitDollarN(snap, (_value, key) => !taken.has(key.toUpperCase())),
    ...overlay,
  }
}

/** densable `_825` `ft` */
function seedGitFt(dir: string): boolean {
  if (!isAbsolute(dir)) return false
  return WIN_PATH_ENTRY.test(dir)
}

/** densable `_841` `kr` */
const CWD_SHADOW_DIR_NAMES = new Set([
  'node_modules',
  '.venv',
  'venv',
  'env',
  '.env',
  'virtualenv',
  '.tox',
  '.nox',
  '.direnv',
  '__pypackages__',
])

/** densable `_841` `Wr` / `Gr` / `$r` */
const REALPATH_RETRY = new Set(['EPERM', 'EBUSY', 'EACCES'])
const REALPATH_TRIES = 4
const REALPATH_WAIT_MS = 50
let realpathWaitSlot: Int32Array | undefined
let windowsAppsAliasCache: { key: string; aliasDirs: string[] } | undefined

/** densable `_841` `R` */
function stripLongPathPrefix(path: string): string {
  return stripWindowsLongPathPrefixXpr(path)
}

/** densable `_841` `B` — `realpathSync.native` with retry. */
function seedGitWhichB(path: string): string | null {
  const native = realpathSync.native ?? realpathSync
  for (let attempt = 0; ; attempt++) {
    try {
      return stripLongPathPrefix(native(path))
    } catch (err) {
      const code =
        err !== null &&
        typeof err === 'object' &&
        'code' in err &&
        typeof err.code === 'string'
          ? err.code
          : undefined
      if (
        code === undefined ||
        !REALPATH_RETRY.has(code) ||
        attempt >= REALPATH_TRIES - 1
      ) {
        return null
      }
      realpathWaitSlot ??= new Int32Array(new SharedArrayBuffer(4))
      Atomics.wait(realpathWaitSlot, 0, 0, REALPATH_WAIT_MS)
    }
  }
}

/** densable `_841` `E` */
function stripTrailingSep(path: string): string {
  return path.endsWith(sep) ? path.slice(0, -1) : path
}

/** densable `_841` `Kr` */
function isWindowsDrivePath(path: string): boolean {
  return /^[A-Za-z]:[\\/](?![\\/])/.test(path)
}

/** densable `_841` `he` */
function windowsAppsAliasDirs(
  home: string,
  localAppData: string,
  map: (path: string) => string,
): string[] {
  const dirs: string[] = []
  if (home) {
    dirs.push(
      stripTrailingSep(map(home)) +
        sep +
        ['appdata', 'local', 'microsoft', 'windowsapps'].join(sep),
    )
  }
  if (localAppData) {
    const extra =
      stripTrailingSep(map(localAppData)) +
      sep +
      ['microsoft', 'windowsapps'].join(sep)
    if (!dirs.includes(extra)) dirs.push(extra)
  }
  return dirs
}

/** densable `_841` `G` */
function underWindowsAppsAlias(
  aliasDirs: string[],
  candidateDir: string,
  cwd: string,
): boolean {
  const cwdNorm = stripTrailingSep(cwd)
  for (const alias of aliasDirs) {
    if (!(cwdNorm === alias || cwdNorm.startsWith(alias + sep))) continue
    if (candidateDir === alias || candidateDir.startsWith(alias + sep)) {
      return true
    }
  }
  return false
}

/** densable `_841` `fe` */
function isUnderCwdViaShadowDir(candidateDir: string, cwd: string): boolean {
  if (!candidateDir.startsWith(stripTrailingSep(cwd) + sep)) return false
  return candidateDir.split(sep).some(seg => CWD_SHADOW_DIR_NAMES.has(seg))
}

/** densable `_841` `pe` — `xe` is `os.homedir`. */
function isUnderSharedWindowsAppsAlias(
  candidateDir: string,
  cwd: string,
  mode: 'lexical' | 'canonical',
): boolean {
  const home = homedir()
  const localAppData = (process.env.LOCALAPPDATA ?? '').trim()
  if (mode === 'lexical') {
    return underWindowsAppsAlias(
      windowsAppsAliasDirs(home, localAppData, path =>
        resolve(path).toLowerCase(),
      ),
      candidateDir,
      cwd,
    )
  }
  const key = `${home}\0${localAppData}`
  if (windowsAppsAliasCache?.key === key) {
    return underWindowsAppsAlias(
      windowsAppsAliasCache.aliasDirs,
      candidateDir,
      cwd,
    )
  }
  let cacheable = true
  const aliasDirs = windowsAppsAliasDirs(home, localAppData, path => {
    if (!isWindowsDrivePath(path)) return resolve(path).toLowerCase()
    const real = seedGitWhichB(path)?.toLowerCase()
    if (real == null) {
      cacheable = false
      return resolve(path).toLowerCase()
    }
    return real
  })
  if (cacheable) windowsAppsAliasCache = { key, aliasDirs }
  return underWindowsAppsAlias(aliasDirs, candidateDir, cwd)
}

/**
 * densable `_841` `Qo` / `gyd` / `h`.
 * True ⇒ `$e` `Ht` drops the candidate (cwd shadow / windowsapps).
 */
export function seedGitQo(found: string, cwd: string): boolean {
  const resolvedCwd = resolve(cwd).toLowerCase()
  const candidateDir = dirname(resolve(found)).toLowerCase()
  if (
    candidateDir === resolvedCwd ||
    isUnderCwdViaShadowDir(candidateDir, resolvedCwd) ||
    isUnderSharedWindowsAppsAlias(candidateDir, resolvedCwd, 'lexical')
  ) {
    return true
  }
  const realCwd = seedGitWhichB(cwd)?.toLowerCase()
  if (realCwd == null) return false
  const realDir = seedGitWhichB(dirname(resolve(found)))?.toLowerCase()
  if (realDir == null) return true
  return (
    realDir === realCwd ||
    isUnderCwdViaShadowDir(realDir, realCwd) ||
    isUnderSharedWindowsAppsAlias(realDir, realCwd, 'canonical')
  )
}

/** densable `_825` `h` */
function seedGitWhichH(found: string, cwd: string): boolean {
  return seedGitQo(found, cwd)
}

/** densable `_825` `Ht` */
function seedGitHt(paths: string[]): string[] {
  const cwd = process.cwd()
  return paths.filter(path => !seedGitWhichH(path, cwd))
}

/** densable `_825` `w` — `!1` is compiled-out false */
function seedGitWhichW(cmd: string, found: string | null): string | null {
  if (!found || false || isAbsolute(cmd)) return found
  return seedGitHt([found])[0] ?? null
}

/** densable `_825` `Ft` */
function seedGitFtWhich(cmd: string, pathValue: string): string | null {
  const which = typeof Bun !== 'undefined' ? Bun.which : undefined
  if (typeof which !== 'function') return null
  const found = which(cmd, { PATH: pathValue })
  return seedGitWhichW(cmd, found ?? null)
}

/**
 * densable `$e` / `Qfd` / `ni` — which-on-PATH Ir actually calls.
 * Empty / no Windows-absolute entries → official `null` → 127 `je`/`Tr`.
 */
export function seedGitDollarE(cmd: string, pathValue: string): string | null {
  const dirs = pathValue.split(delimiter).filter(seedGitFt)
  if (dirs.length === 0) return null
  return seedGitFtWhich(cmd, dirs.join(delimiter))
}

/** densable `_615` `N` */
function seedGitN(env: NodeJS.ProcessEnv = process.env): string {
  return envGet(env, 'CLAUDE_CODE_TMPDIR') || tmpdir()
}

/** densable `_615` `S` host `ensured` */
let seedGitSEnsured: string | undefined

/**
 * densable `_615` `S` — `join(N(),"claude")` then mkdir 0700 (`mode:448`).
 * `getuid` platforms chmod after mkdir; else try/catch mkdir only.
 */
export function seedGitS(env: NodeJS.ProcessEnv = process.env): string {
  const dir = join(seedGitN(env), 'claude')
  if (dir !== seedGitSEnsured) {
    if (typeof process.getuid === 'function') {
      mkdirSync(dir, { recursive: true, mode: 448 })
      chmodSync(dir, 448)
    } else {
      try {
        mkdirSync(dir, { recursive: true, mode: 448 })
      } catch {
        // official S swallows mkdir when getuid is missing
      }
    }
    seedGitSEnsured = dir
  }
  return dir
}

/**
 * densable `oe`/`w` and `un`/`J` — both `S(_.of(host))`.
 */
export function seedGitOe(env: NodeJS.ProcessEnv = process.env): string {
  return seedGitS(env)
}

/**
 * densable `ne`/`Kr` @209860953 — `qa`=`homedir`.
 * Copy the unique list; do not invent extra TMP/TEMP roots.
 */
export function seedGitNe(): string[] {
  const home = homedir()
  return [
    '/dev/stdout',
    '/dev/stderr',
    '/dev/null',
    '/dev/tty',
    '/dev/dtracehelper',
    '/dev/autofs_nowait',
    '/tmp/claude',
    '/private/tmp/claude',
    join(home, '.npm/_logs'),
    join(home, '.claude/debug'),
  ]
}

/** densable `In` */
function seedGitIn(value: string | undefined): string | undefined {
  return value !== undefined && value.length > 1
    ? value.replace(/[\\/]+$/, '')
    : value
}

/** densable `Gt` — unused `t="/tmp"`; TEMP then TMP only */
function seedGitGtTmp(env: NodeJS.ProcessEnv): string | undefined {
  const read = (name: string) => envGet(env, name) || undefined
  return seedGitIn(read('TEMP') ?? read('TMP'))
}

/** densable `xt` */
export function seedGitXt(env: NodeJS.ProcessEnv): string | undefined {
  return (
    seedGitIn(envGet(env, 'CLAUDE_CODE_TMPDIR') || undefined) ??
    seedGitGtTmp(env)
  )
}

/** densable `Ke` */
function seedGitKe(path: string): string {
  return path.replace(/^~(?=$|\/)/, homedir())
}

/** densable `Ye` — `mt=/[*?[\]{}]/` */
function seedGitYe(path: string): string | null {
  if (!isAbsolute(path)) return null
  const parts = path.split('/')
  const globAt = parts.findIndex(part => /[*?[\]{}]/.test(part))
  const kept = (globAt === -1 ? parts : parts.slice(0, globAt))
    .join('/')
    .replace(/\/+$/, '')
  return kept === '' ? '/' : kept
}

/** densable `an` — `nn` skipped */
function seedGitAn(path: string, cwd: string): string[] {
  const t = path.startsWith('~') || isAbsolute(path) ? path : resolve(cwd, path)
  const r = seedGitYe(seedGitKe(t))
  const rows = [r].filter((row): row is string => row !== null)
  const resolved = rows.flatMap(row => {
    try {
      const real = realpathSync(row)
      return isAbsolute(real) ? [real] : []
    } catch {
      return []
    }
  })
  return uniq([...rows, ...resolved])
}

/** densable `pn` */
export function seedGitPn(): string[] {
  const home = homedir()
  return uniq([
    seedGitOe(),
    seedGitOe(),
    ...seedGitNe().map(path =>
      path === '~' || path.startsWith('~/') ? join(home, path.slice(1)) : path,
    ),
  ])
}

/**
 * densable `Ie` — `At`=`basename`, `Te`=`join`.
 * When `j()` is unset, official returns `pn()` only.
 */
export function seedGitIe(): string[] {
  const base = seedGitPn()
  const snap = seedGitJ()
  if (snap === undefined) return base
  const tmp = seedGitXt(snap)
  if (tmp === undefined) return base
  const joined = join(tmp, basename(seedGitOe()))
  return uniq([...base, joined, joined])
}

/** densable `Qe`/`B` — realpath(oe())+sep. */
function seedGitQe(): string {
  return seedGitRealpath(seedGitOe()) + sep
}

/**
 * densable `en`/`JRb`/`z` — realpath(`S()`)+sep (`childProcessTmpDir`).
 */
export function seedGitEn(): string {
  const raw = seedGitS()
  try {
    return realpathSync(raw) + sep
  } catch {
    return raw + sep
  }
}

type SeedSettingsSlice = {
  env?: Record<string, string>
  permissions?: {
    allow?: string[]
    additionalDirectories?: string[]
  }
  sandbox?: { filesystem?: { allowWrite?: string[] } }
}

/**
 * densable `gt` — `ee`=`getSettingsForSource`, `Ve`=`permissionRuleValueFromString`,
 * `Ze`=`Bash`, `rn`=`yZ`/`resolvePathPatternForSandbox`,
 * `on`=`_Z`/`resolveSandboxFilesystemPath`, `he`=`expandPath`.
 */
export function seedGitGt(
  source: SettingSource,
  root: string,
  overlay?: SeedSettingsSlice | null,
): string[] {
  let settings: SeedSettingsSlice | null | undefined
  try {
    settings = overlay === undefined ? getSettingsForSource(source) : overlay
  } catch {
    return []
  }
  const rows: string[] = []
  for (const rule of settings?.permissions?.allow ?? []) {
    try {
      const parsed = permissionRuleValueFromString(rule)
      if (parsed.toolName === BASH_TOOL_NAME && parsed.ruleContent) {
        rows.push(resolvePathPatternForSandbox(parsed.ruleContent, source))
      }
    } catch {
      // official gt swallows per-rule throws
    }
  }
  for (const path of settings?.sandbox?.filesystem?.allowWrite ?? []) {
    try {
      rows.push(resolveSandboxFilesystemPath(path, source))
    } catch {
      // official gt swallows per-path throws
    }
  }
  for (const path of settings?.permissions?.additionalDirectories ?? []) {
    try {
      rows.push(expandPath(path, root))
    } catch {
      // official gt swallows per-path throws
    }
  }
  return rows
}

/** densable `wt` — `t??gt(n,e)` so `null` still loads `gt`. */
function seedGitWt(
  root: string,
  source: SettingSource,
  overlay: string[] | null,
): string[] {
  return uniq(
    (overlay ?? seedGitGt(source, root)).flatMap(path => seedGitAn(path, root)),
  )
}

/**
 * densable `pt` — `Qe()`, `en()`, `ne()`, `sn`=`WZ`, `ze`=`additionalDirectoriesForClaudeMd`.
 */
function seedGitPt(root: string): string[] {
  const rows = [seedGitQe(), seedGitEn()]
  try {
    rows.push(...seedGitNe())
  } catch {
    // official pt swallows ne()
  }
  try {
    const mainGit = detectWorktreeMainRepoPath(root)
    if (mainGit) rows.push(mainGit)
  } catch {
    // official pt swallows sn()
  }
  for (const path of getAdditionalDirectoriesForClaudeMd()) {
    try {
      rows.push(expandPath(path, root))
    } catch {
      // official pt swallows ze()/he()
    }
  }
  return uniq(rows.flatMap(path => seedGitAn(path, root)))
}

/** densable `cn` — `Q`=`de`=`SETTING_SOURCES`. */
export function seedGitCn(root: string): string[] {
  return uniq([
    ...seedGitPt(root),
    ...SETTING_SOURCES.flatMap(source => seedGitWt(root, source, null)),
  ])
}

/** densable `br` / `Zt` */
function pathExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/** densable `Sr` */
function readlinkAbs(path: string): string | null {
  try {
    const target = readlinkSync(path)
    if (isAbsolute(target)) return target
    return join(realpathSync(dirname(path)), target)
  } catch {
    return null
  }
}

/** densable `J` */
export function seedGitRealpath(
  path: string,
  extra: string[] = [],
  hops = 0,
): string {
  try {
    return join(realpathSync(path), ...extra)
  } catch {
    const viaLink = hops < REALPATH_HOPS ? readlinkAbs(path) : null
    if (viaLink !== null) return seedGitRealpath(viaLink, extra, hops + 1)
    const parent = dirname(path)
    return parent === path
      ? join(path, ...extra)
      : seedGitRealpath(parent, [basename(path), ...extra], hops)
  }
}

function uniq(items: string[]): string[] {
  return [...new Set(items)]
}

/** densable `Qn` */
export function seedGitQn(path: string): string {
  return basename(path).toLowerCase() === '.git' ? dirname(path) : path
}

/** densable `et` — `Yn`=`homedir` */
export function seedGitEt(start: string): string[] {
  const home = homedir()
  const walk = (cur: string): string[] => {
    const parent = dirname(cur)
    if (parent === cur || seedPathContains(parent, home)) return []
    return [parent, ...walk(parent)]
  }
  return walk(start).filter(dir => pathExists(join(dir, '.git')))
}

/**
 * densable `Zn` — `[e,...n,...Ie(),...cn(e)]` then realpath.
 */
export function seedGitZn(root: string, extra: string[]): string[] {
  const rows = [root, ...extra, ...seedGitIe(), ...seedGitCn(root)]
  return uniq([...rows, ...rows.map(row => seedGitRealpath(row))])
}

/** densable `V` argv: `!hardened` is `[...Fe,...n]`; hardened adds `$r` */
export function seedGitVArgv(
  args: readonly string[],
  hardened: boolean,
): string[] {
  return hardened
    ? [...SEED_GIT_FE, ...SEED_GIT_HARDENED_C, ...args]
    : [...SEED_GIT_FE, ...args]
}

/**
 * densable `Ir` — `$e("git", PATH)`. Empty/no-hit is official `null` → 127.
 */
export function seedGitIr(env: NodeJS.ProcessEnv): string | null {
  const pathValue = envGet(env, 'PATH') ?? ''
  const cached = gitWhichCache.get(pathValue)
  if (cached !== undefined) return cached
  const found = seedGitDollarE('git', pathValue)
  if (found !== null) gitWhichCache.set(pathValue, found)
  return found
}

/**
 * densable `V` `s===null` → `{stdout:"",stderr:i===void 0?je:Tr,code:127}`.
 * Local also sets `exitCode`.
 */
export function seedGitV127(reach: string[] | undefined): {
  stdout: string
  stderr: string
  code: number
  exitCode: number
} {
  return {
    stdout: '',
    stderr: reach === undefined ? SEED_GIT_NOT_FOUND : SEED_GIT_NOT_FOUND_BOUND,
    code: 127,
    exitCode: 127,
  }
}

/** densable `qn` */
export function seedGitReach(
  cwd: string,
  layout?: Pick<SeedHardenedLayout, 'workTree' | 'commonDir'>,
): string[] {
  const workTree = layout?.workTree ?? cwd
  return seedGitZn(workTree, [
    ...seedGitEt(workTree),
    ...(layout === undefined ? [] : [seedGitQn(layout.commonDir)]),
  ])
}

/** densable `Be` */
export function seedGitBe(
  layout: Pick<SeedHardenedLayout, 'bound' | 'workTree' | 'commonDir'>,
): string[] | undefined {
  return layout.bound === true
    ? seedGitReach(layout.workTree, layout)
    : undefined
}

/** densable `jn` = lodash `omit` flat keys (`WJc`) */
function omitKeys(env: NodeJS.ProcessEnv, keys: string[]): NodeJS.ProcessEnv {
  const next = { ...env }
  for (const key of keys) delete next[key]
  return next
}

/** densable `Pr` — `$e` skipped, official fallback `d(s,a)`=`join` */
export function filterSeedPath(pathValue: string, reach: string[]): string {
  const cacheKey = `${pathValue}\0${reach.join('\0')}`
  const cached = pathFilterCache.get(cacheKey)
  if (cached !== undefined) return cached
  const underReach = (path: string) =>
    reach.some(root => seedPathContains(root, path)) ||
    reach.some(root => seedPathContains(root, seedGitRealpath(path)))
  const filtered = pathValue
    .split(delimiter)
    .filter(
      dir =>
        dir !== '' &&
        isAbsolute(dir) &&
        !underReach(dir) &&
        PATH_EXES.every(
          exe => !underReach(seedGitDollarE(exe, dir) ?? join(dir, exe)),
        ),
    )
    .join(delimiter)
  pathFilterCache.set(cacheKey, filtered)
  return filtered
}

/** densable `pe` — default `n` is `Vn()` */
export function jailSeedGitEnv(
  reach: string[] | undefined,
  env: NodeJS.ProcessEnv = seedGitVn(),
): NodeJS.ProcessEnv {
  if (reach === undefined) return env
  const pathKeys = Object.keys(env).filter(key =>
    getPlatform() === 'windows' ? key.toUpperCase() === 'PATH' : key === 'PATH',
  )
  const underReach = (path: string) =>
    path !== '' &&
    (reach.some(root => seedPathContains(root, path)) ||
      reach.some(root => seedPathContains(root, seedGitRealpath(path))))
  const splitJail = (value: string) =>
    getPlatform() === 'windows' ? value.split(delimiter) : value.split(/[:\s]+/)
  const drop = JAIL_PATH_ENV.filter(key =>
    splitJail(env[key] ?? '').some(underReach),
  )
  return {
    ...(drop.length === 0 ? env : omitKeys(env, [...drop])),
    ...Object.fromEntries(
      pathKeys.map(key => [key, filterSeedPath(env[key] ?? '', reach)]),
    ),
  }
}

/** densable `Gr` — pins are spread by `V`, not here */
export function seedGitGr(layout: SeedHardenedLayout): NodeJS.ProcessEnv {
  if (layout.adminDir === undefined) {
    return {
      GIT_DIR: layout.gitDir,
      GIT_COMMON_DIR: layout.commonDir,
      GIT_WORK_TREE: layout.workTree,
    }
  }
  return {
    GIT_DIR: layout.adminDir,
    GIT_WORK_TREE: layout.workTree,
    GIT_INDEX_FILE: join(layout.adminDir, 'index'),
  }
}

/** densable `Bn` / `ji` */
export function mergeHardenedGitEnv(
  overlay: NodeJS.ProcessEnv,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const wipe: NodeJS.ProcessEnv = {}
  for (const key of GIT_SCRUB) wipe[key] = undefined
  const overlayUpper = new Set(
    Object.keys(overlay).map(key => key.toUpperCase()),
  )
  for (const key of Object.keys(base)) {
    const upper = key.toUpperCase()
    if (
      GIT_SCRUB_SET.has(upper as (typeof GIT_SCRUB)[number]) ||
      GIT_CONFIG_KV.test(key) ||
      (overlayUpper.has(upper) && !(key in overlay))
    ) {
      wipe[key] = undefined
    }
  }
  return { ...base, ...wipe, ...overlay }
}

/** densable `tr` */
export function stripGitConfigAttrEnv(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const names = new Set(['GIT_CONFIG', 'GIT_ATTR_SOURCE'])
  const hits = Object.keys(env).filter(key => names.has(key.toUpperCase()))
  return {
    ...env,
    ...Object.fromEntries(hits.map(key => [key, undefined])),
    GIT_CONFIG: undefined,
    GIT_ATTR_SOURCE: undefined,
  }
}

function compactEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = value
  }
  return out
}

/**
 * densable `V` — `!hardened` is `Fe` only (no `$r`/`Mr`/`Hr`/`extendEnv:false`).
 * Hardened arm is `runSeedGitHardened`.
 */
export async function runSeedGit(
  cwd: string,
  args: string[],
  opts: SeedGitOpts = {},
): Promise<{ stdout: string; stderr: string; code: number; exitCode: number }> {
  if (!opts.hardened) {
    const input = opts.input === undefined ? {} : { input: opts.input }
    const result = await execFileNoThrowWithCwd(
      gitExe(),
      seedGitVArgv(args, false),
      {
        cwd,
        abortSignal: opts.signal,
        ...input,
        ...(opts.env ? { env: opts.env } : {}),
      },
    )
    return { ...result, exitCode: result.code }
  }
  return runSeedGitHardened(cwd, args, opts)
}

/**
 * densable `V` hardened arm.
 * `s=i===void 0&&j()===void 0?xe():Ir(o)`; empty `$e` → 127 `je`/`Tr`.
 */
export async function runSeedGitHardened(
  cwd: string,
  args: string[],
  opts: SeedHardenedOpts = {},
): Promise<{ stdout: string; stderr: string; code: number; exitCode: number }> {
  const reach =
    opts.reach ??
    (opts.layout?.bound === true ? seedGitReach(cwd, opts.layout) : undefined)
  const jailed = jailSeedGitEnv(reach)
  const git =
    reach === undefined && seedGitJ() === undefined
      ? gitExe()
      : seedGitIr(jailed)
  if (git === null) return seedGitV127(reach)
  const input = opts.input === undefined ? {} : { input: opts.input }
  const result = await execFileNoThrowWithCwd(git, seedGitVArgv(args, true), {
    cwd: opts.layout?.workTree ?? cwd,
    abortSignal: opts.signal,
    maxBuffer: SEED_GIT_MAX_BUFFER,
    ...input,
    ...(opts.stripFinalNewline === false ? { stripFinalNewline: false } : {}),
    env: compactEnv(
      stripGitConfigAttrEnv(
        mergeHardenedGitEnv(
          {
            ...SEED_GIT_MR,
            ...(opts.layout ? seedGitGr(opts.layout) : {}),
            ...opts.layout?.configPins,
            ...opts.env,
          },
          jailed,
        ),
      ),
    ),
    extendEnv: false,
  })
  return { ...result, exitCode: result.code }
}
