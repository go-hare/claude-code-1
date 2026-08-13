/**
 * densable 2.1.224 repo-committed settings confine (kjv / tre / EKn / rBh block).
 *
 * Scans workspace `.claude/settings.json` + `settings.local.json` for write-scope
 * grants that escape the session workspace, operator-posture overrides, and bare
 * write-tool allow rules. Mode: enforce | warn | off.
 *
 * 1:1 from SEA fn-kjv-full / EKn / tre / rBh confine block.
 */
import { lstat, realpath, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { getErrnoCode } from '../utils/errors.js'
import { expandPath } from '../utils/path.js'
import { permissionRuleValueFromString } from '../utils/permissions/permissionRuleParser.js'
import { FILE_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileWriteTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/NotebookEditTool/constants.js'

/** densable `szv` mode — keep local to avoid rootRunner cycle */
export type ConfineRepoSettings = 'enforce' | 'warn' | 'off'

/** densable `J2h` — fs op stuck timeout used by HV */
export const CONFINE_FS_TIMEOUT_MS = 5_000
/** densable `Gre` — max settings file bytes to read */
export const CONFINE_SETTINGS_MAX_BYTES = 2_097_152

/** local stuck-timeout (same semantics as rootRunner.withTimeoutMs) */
async function withTimeoutMs<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms,
        )
        if (typeof timer === 'object' && 'unref' in timer) timer.unref()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** densable write-tool names (Ol / tu / WC) */
const WRITE_TOOL_NAMES = new Set([
  FILE_EDIT_TOOL_NAME,
  FILE_WRITE_TOOL_NAME,
  NOTEBOOK_EDIT_TOOL_NAME,
])

export type ConfineEntry = {
  path: string
  sourceFile: string
  raw: string
  kind: string
}

/**
 * densable `tre` — refuse-to-spawn error with entry metadata.
 */
export class ConfineRepoSettingsError extends Error {
  entry: ConfineEntry
  detail: string
  constructor(entry: ConfineEntry, detail: string) {
    super(
      `[runner:session] repo-committed ${entry.kind} entry '${entry.raw}' in ${entry.sourceFile} ${detail} — refusing to spawn. Host-specific write-scope entries belong in the operator's user-level settings.json (userSettings source, not trust-gated — see --trust-workspace docs).`,
    )
    this.name = 'ConfineRepoSettingsError'
    this.entry = entry
    this.detail = detail
  }
}

function isNotFound(err: unknown): boolean {
  const code = getErrnoCode(err)
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/** densable `HV` — wrap fs op with stuck timeout */
async function withConfineFsTimeout<T>(
  p: Promise<T>,
  label: string,
): Promise<T> {
  return withTimeoutMs(
    p,
    CONFINE_FS_TIMEOUT_MS,
    `[runner:stuck] fs op '${label}' (check TMPDIR mount health)`,
  )
}

/**
 * densable `EKn` — refuse if per-session path overlaps child's auto-allowed write scope.
 */
export function assertNoSessionDirOverlap(
  path: string,
  label: string,
  childCwd: string,
  addDirs: string[],
): void {
  const lower = path.toLowerCase()
  const withSep = (s: string): string => (s.endsWith(sep) ? s : s + sep)
  for (const scope of [childCwd, ...addDirs]) {
    const a = scope.toLowerCase()
    if (
      lower === a ||
      lower.startsWith(withSep(a)) ||
      a.startsWith(withSep(lower))
    ) {
      throw new Error(
        `[runner:session] per-session ${label} ${path} overlaps the child's auto-allowed write scope (${scope}) — refusing to spawn`,
      )
    }
  }
}

/** densable `Bu` — UNC / double-slash absolute */
function isUncOrDoubleSlash(p: string): boolean {
  return /^[/\\]{2}/.test(p)
}

/** densable `TI` — strip trailing `/**` for path projection */
function stripGlobStar(p: string): string {
  return p.replace(/\/\*\*$/, '') || '/'
}

/** densable `Mmr`-lite — strip trailing `/` (posix) */
function stripTrailingSlash(p: string): string {
  if (process.platform === 'win32' || !p.endsWith('/')) return p
  return p.replace(/\/+$/, '') || '/'
}

/**
 * densable `ani` — split rule content into relativePattern + root.
 * root === null means relative-to-workspace (not absolute grant).
 */
export function splitPermissionPathPattern(
  pattern: string,
  workspaceRoot: string,
): { relativePattern: string; root: string | null } {
  let e = pattern
  if (
    process.platform === 'win32' &&
    (e.startsWith('~\\') ||
      (e.startsWith('\\') && e[1] !== '!' && e[1] !== '#'))
  ) {
    e = e.replaceAll('\\', '/')
  }
  if (e.startsWith('//')) {
    const n = e.slice(1)
    if (process.platform === 'win32' && n.match(/^\/[a-z]\//i)) {
      const drive = n[1]?.toUpperCase() ?? 'C'
      const rest = n.slice(2)
      return {
        relativePattern: rest.startsWith('/') ? rest : `/${rest}`,
        root: `${drive}:\\`,
      }
    }
    return { relativePattern: n, root: '/' }
  }
  if (process.platform === 'win32' && e.match(/^[A-Za-z]:[/\\]/)) {
    const drive = e[0]!.toUpperCase()
    const rest = e.slice(2).replaceAll('\\', '/')
    return {
      relativePattern: rest.startsWith('/') ? rest : `/${rest}`,
      root: `${drive}:\\`,
    }
  }
  if (e.startsWith('~/')) {
    return {
      relativePattern: e.slice(1),
      root: expandPath('~'),
    }
  }
  if (e.startsWith('/')) {
    return { relativePattern: e, root: workspaceRoot }
  }
  let r = e
  if (e.startsWith('./')) r = e.slice(2)
  return { relativePattern: r, root: null }
}

/**
 * densable `swo` — sandbox-arm path projection for permission rule content.
 */
function projectSandboxArmPath(content: string, workspaceRoot: string): string {
  if (content.startsWith('//')) return stripTrailingSlash(content.slice(1))
  if (content.startsWith('/') && !content.startsWith('//')) {
    return resolve(workspaceRoot, content.slice(1))
  }
  return stripTrailingSlash(content)
}

/**
 * densable `awo` — sandbox.filesystem allowRead/allowWrite path resolve.
 */
function projectSandboxFsPath(content: string, workspaceRoot: string): string {
  if (content.startsWith('//')) return stripTrailingSlash(content.slice(1))
  return stripTrailingSlash(expandPath(content, workspaceRoot))
}

function parseSettingsJson(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw) as unknown
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

/** densable out-bag on kjv/jjw — repo disableAllHooks:true under child workspace */
export type ScanRepoSettingsBag = {
  repoDisablesAllHooks?: boolean
}

/**
 * densable `kjv` — scan childCwd + prepared repo paths for confine entries.
 * Throws ConfineRepoSettingsError on hard fail-closed conditions (symlink
 * settings, env override, operator posture negate, unreadable non-ENOENT).
 * Returns list of write-scope paths for outside-workspace check.
 *
 * densable 2.1.229: when `outBag` is provided and a settings file under a root
 * that is childCwd (or an ancestor of childCwd) has `disableAllHooks:true`,
 * sets `outBag.repoDisablesAllHooks=true` (does not throw — only false throws).
 */
export async function scanRepoCommittedSettings(
  childCwd: string,
  preparedPaths: string[],
  outBag?: ScanRepoSettingsBag,
): Promise<ConfineEntry[]> {
  const out: ConfineEntry[] = []

  const failClosed =
    (path: string, meta: Omit<ConfineEntry, 'path'>, op: string) =>
    (err: unknown): undefined => {
      if (isNotFound(err)) return undefined
      throw new ConfineRepoSettingsError(
        { ...meta, path },
        `could not be probed (${op} failed: ${err instanceof Error ? err.message : String(err)}) — refusing rather than fold a non-ENOENT error into "does not exist" (fail-closed)`,
      )
    }

  /** densable `o` — realpath or ancestor symlink probe */
  const probeRealpath = async (
    path: string,
    meta: Omit<ConfineEntry, 'path'>,
  ): Promise<string | undefined> => {
    if (isUncOrDoubleSlash(path)) return undefined
    const rp = await withConfineFsTimeout(
      realpath(path).catch(failClosed(path, meta, 'realpath')),
      `realpath ${path}`,
    )
    if (rp !== undefined) return rp
    // nonexistent leaf: walk ancestors for dangling/out-of-tree symlink
    let cur = path
    for (let hop = 0; hop < 64; hop++) {
      const st = await withConfineFsTimeout(
        lstat(cur).catch(failClosed(path, meta, 'lstat')),
        `lstat ${cur}`,
      )
      if (st?.isSymbolicLink()) {
        throw new ConfineRepoSettingsError(
          { ...meta, path },
          `traverses a symlink at ${cur} whose target path cannot be realpath'd — a repo-shipped link (dangling, or pointing outside the workspace with a nonexistent leaf) can be retargeted at use time`,
        )
      }
      if (st !== undefined) return undefined
      const parent = dirname(cur)
      if (parent === cur) return undefined
      cur = parent
    }
    throw new ConfineRepoSettingsError(
      { ...meta, path },
      'has too many nonexistent path components (ancestor-walk hop bound exhausted) — refusing rather than skip the symlink probe',
    )
  }

  /** densable `i` — reject `..` after symlink in absolute path */
  const probeDotDotAfterSymlink = async (
    path: string,
    meta: Omit<ConfineEntry, 'path'>,
  ): Promise<void> => {
    if (!isAbsolute(path)) return
    const parts = path.split(sep).filter(p => p.length > 0)
    if (!parts.includes('..')) return
    let built = path.startsWith(sep) ? sep : ''
    for (const part of parts) {
      if (part === '.') continue
      if (part === '..') {
        built = dirname(built)
        continue
      }
      built = built === sep ? sep + part : join(built, part)
      const st = await withConfineFsTimeout(
        lstat(built).catch(failClosed(path, meta, 'lstat')),
        `lstat ${built}`,
      )
      if (st?.isSymbolicLink()) {
        throw new ConfineRepoSettingsError(
          { ...meta, path },
          `contains a '..' after symlink ${built} — the kernel resolves the symlink before the '..' at bind time, diverging from the lexically-collapsed form the confine check saw`,
        )
      }
      if (st === undefined) return
    }
  }

  const projectForChild = (p: string): string => {
    const stripped = stripGlobStar(p) || sep
    return expandPath(stripped, childCwd)
  }

  for (const root of new Set([childCwd, ...preparedPaths])) {
    const claudeDir = join(root, '.claude')
    const claudeSt = await withConfineFsTimeout(
      lstat(claudeDir).catch((err: unknown) => {
        if (isNotFound(err)) return undefined
        throw err
      }),
      `lstat ${claudeDir}`,
    )
    if (claudeSt === undefined) continue
    if (claudeSt.isSymbolicLink()) {
      throw new ConfineRepoSettingsError(
        {
          path: claudeDir,
          sourceFile: claudeDir,
          raw: '.claude',
          kind: 'permissions.additionalDirectories',
        },
        'is a symlink — refusing to follow (the settings read below would escape the workspace)',
      )
    }

    for (const name of ['settings.json', 'settings.local.json'] as const) {
      const settingsPath = join(claudeDir, name)
      const st = await withConfineFsTimeout(
        lstat(settingsPath).catch((err: unknown) => {
          if (isNotFound(err)) return undefined
          throw new ConfineRepoSettingsError(
            {
              path: settingsPath,
              sourceFile: settingsPath,
              raw: name,
              kind: 'scan-fs-error',
            },
            `could not be lstat'd (${err instanceof Error ? err.message : String(err)}) — refusing rather than skip the scan`,
          )
        }),
        `lstat ${settingsPath}`,
      )
      if (st === undefined) continue
      if (st.isSymbolicLink()) {
        throw new ConfineRepoSettingsError(
          {
            path: settingsPath,
            sourceFile: settingsPath,
            raw: name,
            kind: 'permissions.additionalDirectories',
          },
          'is a symlink — refusing to follow (the settings read below would escape the workspace; same posture as the .claude-dir lstat guard)',
        )
      }

      let content: string
      try {
        content = await withConfineFsTimeout(
          readFile(settingsPath, { encoding: 'utf8' }).then(text => {
            // densable Gre — cap read size (character-safe for JSON headers)
            if (Buffer.byteLength(text) > CONFINE_SETTINGS_MAX_BYTES) {
              return text.slice(
                0,
                Math.min(text.length, CONFINE_SETTINGS_MAX_BYTES),
              )
            }
            return text
          }),
          `readFile ${settingsPath}`,
        )
      } catch (err) {
        if (isNotFound(err)) continue
        throw new ConfineRepoSettingsError(
          {
            path: settingsPath,
            sourceFile: settingsPath,
            raw: name,
            kind: 'scan-fs-error',
          },
          `could not be read (${err instanceof Error ? err.message : String(err)}) — refusing rather than skip the scan`,
        )
      }

      const g = parseSettingsJson(content)
      if (!g) continue

      // densable: if (r && (c===e || e.startsWith(c+sep)) && y?.disableAllHooks===!0)
      // r.repoDisablesAllHooks=!0 — true is allowed (flag only); false still throws below
      if (
        outBag &&
        (root === childCwd || childCwd.startsWith(root + sep)) &&
        g.disableAllHooks === true
      ) {
        outBag.repoDisablesAllHooks = true
      }

      // env override — fail closed
      const envObj = g.env
      if (
        envObj !== undefined &&
        envObj !== null &&
        typeof envObj === 'object' &&
        !Array.isArray(envObj) &&
        Object.keys(envObj as object).length > 0
      ) {
        const keys = Object.keys(envObj as object)
        throw new ConfineRepoSettingsError(
          {
            path: settingsPath,
            sourceFile: settingsPath,
            raw: `env: {${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', …' : ''}}`,
            kind: 'operator-posture override',
          },
          'sets env vars that reach every child subprocess (BASH_ENV/LD_PRELOAD/NODE_OPTIONS/GIT_* are unsandboxed-exec inlets). Runner-level env belongs in the operator wrapper script or runner env, not repo settings',
        )
      }

      // operator posture negations
      const sandbox = (g.sandbox ?? null) as Record<string, unknown> | null
      const postureChecks: Array<[string, unknown, unknown]> = [
        ['sandbox.enabled', sandbox?.enabled, false],
        ['disableAllHooks', g.disableAllHooks, false],
        [
          'sandbox.allowUnsandboxedCommands',
          sandbox?.allowUnsandboxedCommands,
          true,
        ],
        ['sandbox.failIfUnavailable', sandbox?.failIfUnavailable, false],
      ]
      for (const [key, val, bad] of postureChecks) {
        if (val === bad) {
          throw new ConfineRepoSettingsError(
            {
              path: settingsPath,
              sourceFile: settingsPath,
              raw: `${key}: ${String(bad)}`,
              kind: 'operator-posture override',
            },
            `negates the operator's ${key} posture (projectSettings overrides userSettings in the merged read). Remove it from the repo settings; operator posture belongs in the user-level settings.json`,
          )
        }
      }

      const permissions = (g.permissions ?? null) as Record<
        string,
        unknown
      > | null
      const allow = Array.isArray(permissions?.allow)
        ? (permissions!.allow as unknown[])
        : []
      for (const rule of allow) {
        if (typeof rule !== 'string') continue
        const parsed = permissionRuleValueFromString(rule)
        if (!WRITE_TOOL_NAMES.has(parsed.toolName)) continue
        if (parsed.ruleContent === undefined) {
          out.push({
            path: sep,
            sourceFile: settingsPath,
            raw: rule,
            kind: 'permissions.allow (bare write-tool rule)',
          })
          continue
        }
        const { root: absRoot } = splitPermissionPathPattern(
          parsed.ruleContent,
          root,
        )
        {
          const meta = {
            sourceFile: settingsPath,
            raw: rule,
            kind: 'permissions.allow (sandbox-arm projection)',
          }
          const projected = projectSandboxArmPath(parsed.ruleContent, root)
          const path = projectForChild(projected)
          out.push({ ...meta, path })
          const rp = await probeRealpath(path, meta)
          if (rp !== undefined && rp !== path) {
            out.push({ ...meta, path: rp })
          }
          await probeDotDotAfterSymlink(stripGlobStar(projected) || sep, meta)
        }
        if (absRoot === null) continue
        {
          const meta = {
            sourceFile: settingsPath,
            raw: rule,
            kind: 'permissions.allow',
          }
          out.push({ ...meta, path: absRoot })
          const rp = await probeRealpath(absRoot, meta)
          if (rp !== undefined && rp !== absRoot) {
            out.push({ ...meta, path: rp })
          }
        }
      }

      const fsBox = (sandbox?.filesystem ?? null) as Record<
        string,
        unknown
      > | null
      for (const [key, arr] of [
        ['allowWrite', fsBox?.allowWrite],
        ['allowRead', fsBox?.allowRead],
      ] as const) {
        if (!Array.isArray(arr)) continue
        for (const entry of arr) {
          if (typeof entry !== 'string') continue
          const meta = {
            sourceFile: settingsPath,
            raw: entry,
            kind: `sandbox.filesystem.${key}`,
          }
          let projected: string
          let path: string
          try {
            projected = projectSandboxFsPath(entry, root)
            path = projectForChild(projected)
          } catch (err) {
            throw new ConfineRepoSettingsError(
              { ...meta, path: entry },
              `could not be resolved (${err instanceof Error ? err.message : String(err)}) — refusing rather than drop and risk sandbox-init failure child-side`,
            )
          }
          out.push({ ...meta, path })
          const rp = await probeRealpath(path, meta)
          if (rp !== undefined && rp !== path) {
            out.push({ ...meta, path: rp })
          }
          await probeDotDotAfterSymlink(stripGlobStar(projected) || sep, meta)
        }
      }

      const addDirs = permissions?.additionalDirectories
      if (!Array.isArray(addDirs)) continue
      for (const entry of addDirs) {
        if (typeof entry !== 'string') continue
        const meta = {
          sourceFile: settingsPath,
          raw: entry,
          kind: 'permissions.additionalDirectories',
        }
        let resolved: string
        try {
          resolved = resolve(expandPath(entry, childCwd))
        } catch (err) {
          throw new ConfineRepoSettingsError(
            { ...meta, path: String(entry) },
            `could not be resolved (${err instanceof Error ? err.message : String(err)}) — refusing rather than drop and risk sandbox-init failure child-side`,
          )
        }
        out.push({ ...meta, path: resolved })
        const rp = await probeRealpath(resolved, meta)
        if (rp !== undefined && rp !== resolved) {
          out.push({ ...meta, path: rp })
        }
        await probeDotDotAfterSymlink(stripGlobStar(entry) || sep, meta)
      }
    }
  }

  return out
}

export type ApplyConfineOpts = {
  mode: ConfineRepoSettings
  childCwd: string
  addDirs: string[]
  preparedPaths: string[]
  configDir: string
  stageFileRoot: string
  onStatus: (msg: string) => void
}

/** densable apply result — warned (lt) + Mt scan-abort + Pt.repoDisablesAllHooks */
export type ApplyConfineResult = {
  warned: boolean
  /** densable `Mt` — scan threw under warn mode (confine_scan_aborted) */
  confineScanAborted: boolean
  /** densable `Pt.repoDisablesAllHooks` */
  repoDisablesAllHooks: boolean
}

/**
 * densable rBh confine block after G2h:
 * EKn config/stage vs child scope → kjv scan → re-EKn with entry paths →
 * outside-workspace tre checks. warn logs + continues; enforce throws.
 */
export async function applyRepoSettingsConfine(
  opts: ApplyConfineOpts,
): Promise<ApplyConfineResult> {
  const {
    mode,
    childCwd,
    addDirs,
    preparedPaths,
    configDir,
    stageFileRoot,
    onStatus,
  } = opts

  // Always run base EKn for config/stage vs child write scope (densable pre-scan)
  assertNoSessionDirOverlap(configDir, 'config dir', childCwd, addDirs)
  assertNoSessionDirOverlap(stageFileRoot, 'stage-file root', childCwd, addDirs)

  if (mode === 'off') {
    return {
      warned: false,
      confineScanAborted: false,
      repoDisablesAllHooks: false,
    }
  }

  let entries: ConfineEntry[] = []
  let warned = false
  let confineScanAborted = false
  const bag: ScanRepoSettingsBag = {}
  try {
    entries = await scanRepoCommittedSettings(childCwd, preparedPaths, bag)
  } catch (err) {
    if (mode === 'warn') {
      const msg = err instanceof Error ? err.message : String(err)
      onStatus(`[runner:confine] WARN (would refuse): ${msg}`)
      return {
        warned: true,
        confineScanAborted: true,
        repoDisablesAllHooks: Boolean(bag.repoDisablesAllHooks),
      }
    }
    throw err
  }

  const expandedAddDirs = [...addDirs, ...entries.map(e => e.path)]
  const recheck = (): void => {
    assertNoSessionDirOverlap(
      configDir,
      'config dir',
      childCwd,
      expandedAddDirs,
    )
    assertNoSessionDirOverlap(
      stageFileRoot,
      'stage-file root',
      childCwd,
      expandedAddDirs,
    )
  }
  if (mode === 'warn') {
    try {
      recheck()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      onStatus(`[runner:confine] WARN (would refuse under enforce): ${msg}`)
      warned = true
    }
  } else {
    recheck()
  }

  if (entries.length > 0) {
    const lower = (s: string) => s.toLowerCase()
    const allowed = new Set<string>()
    for (const scope of [childCwd, ...addDirs]) {
      allowed.add(lower(scope))
      allowed.add(lower(scope.normalize('NFC')))
      try {
        const rp = await withConfineFsTimeout(
          realpath(scope).then(
            p => p as string | undefined,
            () => undefined as string | undefined,
          ),
          `realpath ${scope}`,
        )
        if (typeof rp === 'string') {
          allowed.add(lower(rp))
          allowed.add(lower(rp.normalize('NFC')))
        }
      } catch {
        /* ignore */
      }
    }
    const inScope = (p: string): boolean => {
      for (const a of allowed) {
        if (p === a || p.startsWith(a.endsWith(sep) ? a : a + sep)) return true
      }
      return false
    }
    for (const entry of entries) {
      if (inScope(lower(entry.path))) continue
      const detail =
        entry.kind === 'permissions.allow (bare write-tool rule)'
          ? `grants unbounded file-tool writes (toolAlwaysAllowedRule matches a bare ${entry.raw} rule for ANY path). defaultMode:"acceptEdits" already auto-allows in-workspace edits; drop the bare rule, or use "Edit(/**)" / "Write(/**)" for an explicit workspace-scoped rule, or move it to the operator's user-level settings.json`
          : "resolves outside this session's own workspace"
      const err = new ConfineRepoSettingsError(entry, detail)
      if (mode === 'warn') {
        onStatus(`[runner:confine] WARN (would refuse): ${err.message}`)
        warned = true
        continue
      }
      throw err
    }
  }

  return {
    warned,
    confineScanAborted,
    repoDisablesAllHooks: Boolean(bag.repoDisablesAllHooks),
  }
}
