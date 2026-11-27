/**
 * Pure sandbox path normalization, filesystem/network policy resolution, and
 * credential merge helpers.
 */

import type {
  FsReadRestrictionConfig,
  FsWriteRestrictionConfig,
  SandboxRuntimeConfig,
} from '@anthropic-ai/sandbox-runtime'
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
} from 'fs'
import { homedir } from 'os'
import { dirname, isAbsolute, join, resolve } from 'path'
import {
  getInlinePlugins,
  getInlinePluginsNoMcp,
  getOriginalCwd,
} from '../../../bootstrap/state.js'
import { logForDebugging } from '../../debug.js'
import { errorMessage, getErrnoCode } from '../../errors.js'
import { expandPath } from '../../path.js'
import { getPlatform, type Platform } from '../../platform.js'
import {
  isSettingSourceEnabled,
  SETTING_SOURCES,
  type SettingSource,
} from '../../settings/constants.js'
import {
  getSettingsForSource,
  getSettingsRootPathForSource,
} from '../../settings/settings.js'
import type { SettingsJson } from '../../settings/types.js'
import { recordSymlinkedDenyPath } from '../symlinkedDenyScrub.js'
import {
  DEFAULT_SENSITIVE_HOME_DENY_WRITE_PATHS,
  stripTrailingSlashForSandbox,
} from './constants.js'

/**
 * Official 2.1.326 #22 (`ivr` / `Phl` / `X3`):
 * Detect Linux `/net/...` autofs paths. When the home or config directory is
 * reached through a symlink into `/net` and sandbox settings deny reads of it,
 * bwrap fails to start if `/net` or the symlink target is blindly ro-bound/denied.
 */
export function isLinuxNetAutofsPath(
  p: string,
  platform: Platform = getPlatform(),
): boolean {
  if (platform !== 'linux' && platform !== 'wsl') return false
  const normalized = p.replace(/\/+$/, '')
  return normalized === '/net' || normalized.startsWith('/net/')
}

/**
 * Official 2.1.326 #22: filter/adjust Linux `denyRead` entries when `home` or
 * `configDir` is reached via a symlink into `/net` so bwrap does not fail on
 * autofs mounts while keeping literal home/config deny protection intact.
 */
export function filterLinuxNetSymlinkDenyRead(
  denyRead: readonly string[],
  home: string,
  configDir: string,
  platform: Platform = getPlatform(),
): string[] {
  if (platform !== 'linux' && platform !== 'wsl') return [...denyRead]
  const resolvedNetRoots = new Set<string>()
  for (const base of [home, configDir]) {
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- refreshConfig() must be sync
      const real = realpathSync(base)
      if (real !== base && isLinuxNetAutofsPath(real, platform)) {
        resolvedNetRoots.add(real)
      }
    } catch {
      // ignore unresolvable home/configDir
    }
  }
  if (resolvedNetRoots.size === 0) return [...denyRead]
  return denyRead.filter(entry => {
    if (!isLinuxNetAutofsPath(entry, platform)) return true
    for (const root of resolvedNetRoots) {
      if (entry === '/net' || root === entry || root.startsWith(`${entry}/`)) {
        logForDebugging(
          `[Sandbox] Skipping Linux /net autofs denyRead ancestor "${entry}" for symlinked home/config root "${root}"`,
        )
        return false
      }
    }
    return true
  })
}

export function collectSensitiveHomeDenyWritePaths(
  home: string,
  trustedAllowWrite: readonly string[],
): string[] {
  const normalizedTrusted = trustedAllowWrite.map(p =>
    resolve(p.startsWith('~/') ? join(home, p.slice(2)) : p).replace(
      /\/+$/,
      '',
    ),
  )
  const out: string[] = []
  for (const segments of DEFAULT_SENSITIVE_HOME_DENY_WRITE_PATHS) {
    const full = resolve(home, ...segments)
    // Never allow project/local settings to override; only trusted user/flag/policy
    // allowWrite entries matching this path or a parent folder exempt non-Claude paths.
    const isClaudeState = segments[0] === '.claude'
    const explicitlyAllowed =
      !isClaudeState &&
      normalizedTrusted.some(
        allowed =>
          allowed === full ||
          (allowed.startsWith(`${home}/`) && full.startsWith(`${allowed}/`)),
      )
    if (!explicitlyAllowed) {
      out.push(full)
    }
  }
  return out
}

/**
 * Official 2.1.326 #302: on Linux and WSL, pre-create missing `--add-dir`
 * folders before each sandboxed command so bwrap bind-mounts work cleanly.
 * Skips paths whose existing ancestor is a symlink/network mount or unreadable.
 */
export function precreateMissingLinuxAddDirs(
  additionalDirs: readonly string[],
  platform: Platform = getPlatform(),
): string[] {
  if (platform !== 'linux' && platform !== 'wsl') return []
  const created: string[] = []
  for (const rawDir of additionalDirs) {
    if (!rawDir || !isAbsolute(rawDir)) continue
    const dir = resolve(rawDir)
    if (isLinuxNetAutofsPath(dir, platform) || dir === '/') continue
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- pre-wrap setup
      lstatSync(dir)
      continue // already exists (file, dir, or symlink)
    } catch (err) {
      if (getErrnoCode(err) !== 'ENOENT') continue
    }
    // Verify nearest existing ancestor is a real directory (not a symlink)
    let ancestor = dirname(dir)
    let ancestorSafe = false
    while (ancestor && ancestor !== dirname(ancestor)) {
      try {
        // eslint-disable-next-line custom-rules/no-sync-fs -- pre-wrap setup
        const st = lstatSync(ancestor)
        ancestorSafe = st.isDirectory() && !st.isSymbolicLink()
        break
      } catch (err) {
        if (getErrnoCode(err) !== 'ENOENT') break
        ancestor = dirname(ancestor)
      }
    }
    if (!ancestorSafe) continue
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- pre-wrap setup
      mkdirSync(dir, { recursive: true })
      created.push(dir)
    } catch {
      // Best-effort pre-create
    }
  }
  return created
}

/**
 * Official 2.1.326 #235: check whether a folder contains any symlink pointing
 * to an unreadable or network path (`/net`, UNC `//...`, dangling/ELOOP).
 * Used to tighten sandbox write grants and mods-folder edit permissions.
 */
export function directoryHasUnreadableOrNetworkSymlink(dir: string): boolean {
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- sync check
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const ent of entries) {
      if (!ent.isSymbolicLink()) continue
      const full = join(dir, ent.name)
      try {
        // eslint-disable-next-line custom-rules/no-sync-fs -- sync check
        const target = readlinkSync(full)
        if (
          target.startsWith('/net/') ||
          target === '/net' ||
          target.startsWith('//') ||
          target.startsWith('\\\\') ||
          target.startsWith('/Network/')
        ) {
          return true
        }
        // Verify target is readable/stat-able
        // eslint-disable-next-line custom-rules/no-sync-fs -- sync check
        statSync(full)
      } catch {
        return true
      }
    }
  } catch {
    return false
  }
  return false
}

/**
 * Official 2.1.323 #2175 (`N3`): on macOS, Linux, and WSL, ignore write access
 * granted via an `allowWrite` entry that passes through a symlink inside a
 * writable folder leading elsewhere (outside its own spelling) or to a missing
 * target. Users must grant the real path instead.
 */
export function isAllowWriteSymlinkEscapingOrDangling(
  entry: string,
  platform: Platform = getPlatform(),
): boolean {
  if (platform === 'windows') return false
  if (entry === '.' || entry === '..') return false
  // Strip trailing glob suffix if any (e.g. `/path/**` -> `/path`)
  const stripped = entry.replace(/\/\*+$/, '')
  if (!stripped || !isAbsolute(stripped)) return false
  const isMac = platform === 'macos'
  const macPrivateAlias =
    isMac && (stripped.startsWith('/tmp/') || stripped.startsWith('/var/'))
  const normalizeCmp = (p: string) => {
    const clean = p.replace(/\/+$/, '') || '/'
    return isMac ? clean.toLowerCase() : clean
  }
  const sameSpelling = (a: string, b: string) => {
    const na = normalizeCmp(a)
    const nb = normalizeCmp(b)
    if (na === nb) return true
    if (macPrivateAlias && normalizeCmp('/private' + a) === nb) return true
    return false
  }
  // Walk path components from root to leaf looking for any symlink
  const parts = stripped.split('/').filter(Boolean)
  let current = '/'
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    const next = current === '/' ? `/${part}` : `${current}/${part}`
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- config build must be sync
      const st = lstatSync(next)
      if (st.isSymbolicLink()) {
        // Skip system macOS root symlinks (`/tmp`, `/var`, `/etc`)
        if (
          isMac &&
          i === 0 &&
          (part === 'tmp' || part === 'var' || part === 'etc')
        ) {
          current = next
          continue
        }
        try {
          // eslint-disable-next-line custom-rules/no-sync-fs -- config build must be sync
          const resolved = realpathSync(next)
          if (!sameSpelling(next, resolved)) {
            return true
          }
        } catch {
          // Dangling symlink pointing to a missing path -> ignore grant
          return true
        }
      }
      current = next
    } catch (err) {
      const code = getErrnoCode(err)
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        // Non-existent path without a symlink along its existing prefix is fine
        return false
      }
      return true
    }
  }
  return false
}

/**
 * Official 2.1.325 #2333 (`D5n`): native updater download staging directory
 * (`$XDG_CACHE_HOME/claude/staging` or `~/.cache/claude/staging`).
 */
export function getUpdaterStagingDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const cacheBase = env.XDG_CACHE_HOME ?? join(home, '.cache')
  const root = isAbsolute(cacheBase) ? cacheBase : join(home, '.cache')
  return join(root, 'claude', 'staging')
}

/**
 * Official 2.1.325 #2333 (`Ahe`): materialize the updater staging directory
 * (0o700) before wrap on non-Windows so bwrap/Seatbelt deny an existing folder.
 */
export function ensureUpdaterStagingDir(): void {
  if (getPlatform() === 'windows') return
  const stagingDir = getUpdaterStagingDir()
  if (!isAbsolute(stagingDir)) return
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- pre-wrap setup
    mkdirSync(stagingDir, { recursive: true, mode: 0o700 })
  } catch (err) {
    logForDebugging(
      `[sandbox] could not create the update staging folder, which is denied all the same: ${errorMessage(err)}`,
      { level: 'error' },
    )
  }
}

/**
 * Official 2.1.325 #2334 & #2358 (`_o` / `fs` / `jf`):
 * Protect `.claude` settings, skills, agents, commands, hooks, workflows,
 * routines, output-styles, launch/scheduled_tasks/loop configs, and `.mcp.json`
 * inside a project, worktree, or added directory (`additionalDirectories`).
 */
export function pushProtectedClaudeDirEntries(
  denyWrite: string[],
  dir: string,
): void {
  denyWrite.push(
    recordSymlinkedDenyPath(resolve(dir, '.claude', 'settings.json')),
    recordSymlinkedDenyPath(resolve(dir, '.claude', 'settings.local.json')),
    resolve(dir, '.claude', 'skills'),
    resolve(dir, '.claude', 'commands'),
    resolve(dir, '.claude', 'agents'),
    resolve(dir, '.claude', 'hooks'),
    resolve(dir, '.claude', 'launch.json'),
    resolve(dir, '.claude', 'workflows'),
    resolve(dir, '.claude', 'routines'),
    resolve(dir, '.claude', 'output-styles'),
    resolve(dir, '.claude', 'scheduled_tasks.json'),
    resolve(dir, '.claude', 'loop.md'),
    resolve(dir, '.mcp.json'),
  )
}

const GLOB_META_RE = /[*?[\]{}]/

/**
 * Official 325 `tk(e)` / `nk(n, e)` (#1119): for macOS Seatbelt `denyWrite`
 * glob patterns whose folder is reached through a symlink, also emit the
 * realpath-resolved glob pattern so `@anthropic-ai/sandbox-runtime`
 * `generateWriteRules` denies writes at the real location.
 */
export function expandSymlinkedDenyWriteGlobs(
  patterns: readonly string[],
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (p: string) => {
    if (!seen.has(p)) {
      seen.add(p)
      out.push(p)
    }
  }
  for (const pattern of patterns) {
    add(pattern)
    const idx = pattern.search(GLOB_META_RE)
    if (idx <= 0) continue
    const prefix = pattern.slice(0, idx)
    const suffix = pattern.slice(idx)
    const lastSep = prefix.lastIndexOf('/')
    const anchor =
      lastSep === -1 ? '' : lastSep === 0 ? '/' : prefix.slice(0, lastSep)
    const restPrefix = lastSep === -1 ? prefix : prefix.slice(lastSep + 1)
    if (!anchor || anchor === '/' || anchor.startsWith('/dev')) continue
    const missing: string[] = []
    let cur = anchor
    let realAnchor: string | null = null
    while (true) {
      try {
        const real = realpathSync(cur)
        realAnchor = missing.length === 0 ? real : join(real, ...missing)
        break
      } catch {
        const parent = dirname(cur)
        if (parent === cur) break
        missing.unshift(cur.slice(parent === '/' ? 1 : parent.length + 1))
        cur = parent
      }
    }
    if (
      realAnchor !== null &&
      realAnchor !== anchor &&
      !realAnchor.startsWith('/dev')
    ) {
      add(`${realAnchor}/${restPrefix}${suffix}`)
    }
  }
  return out
}

/**
 * Resolve Claude Code-specific path patterns for sandbox-runtime.
 *
 * Claude Code uses special path prefixes in permission rules:
 * - `//path` → absolute from filesystem root (becomes `/path`)
 * - `/path` → relative to settings file directory (becomes `$SETTINGS_DIR/path`)
 * - `~/path` → passed through (sandbox-runtime handles this)
 * - `./path` or `path` → passed through (sandbox-runtime handles this)
 *
 * This function only handles CC-specific conventions (`//` and `/`).
 * Standard path patterns like `~/` and relative paths are passed through
 * for sandbox-runtime's normalizePathForSandbox to handle.
 *
 * densable `swo`/`ZEo`: after resolve, apply Mmr trailing-slash strip.
 *
 * @param pattern The path pattern from a permission rule
 * @param source The settings source this pattern came from (needed to resolve `/path` patterns)
 */
export function resolvePathPatternForSandbox(
  pattern: string,
  source: SettingSource,
): string {
  // Handle // prefix - absolute from root (CC-specific convention)
  if (pattern.startsWith('//')) {
    return stripTrailingSlashForSandbox(pattern.slice(1)) // "//.aws/**" → "/.aws/**"
  }

  // Handle / prefix - relative to settings file directory (CC-specific convention)
  // Note: ~/path and relative paths are passed through for sandbox-runtime to handle
  if (pattern.startsWith('/') && !pattern.startsWith('//')) {
    const root = getSettingsRootPathForSource(source)
    // Pattern like "/foo/**" becomes "${root}/foo/**"
    return stripTrailingSlashForSandbox(resolve(root, pattern.slice(1)))
  }

  // Other patterns (~/path, ./path, path) pass through as-is
  // sandbox-runtime's normalizePathForSandbox will handle them
  return stripTrailingSlashForSandbox(pattern)
}

/**
 * Resolve paths from sandbox.filesystem.* settings (allowWrite, denyWrite, etc).
 *
 * Unlike permission rules (Edit/Read), these settings use standard path semantics:
 * - `/path` → absolute path (as written, NOT settings-relative)
 * - `~/path` → expanded to home directory
 * - `./path` or `path` → relative to settings file directory
 * - `//path` → absolute (legacy permission-rule syntax, accepted for compat)
 *
 * Fix for #30067: resolvePathPatternForSandbox treats `/Users/foo/.cargo` as
 * settings-relative (permission-rule convention). Users reasonably expect
 * absolute paths in sandbox.filesystem.allowWrite to work as-is.
 *
 * Also expands `~` here rather than relying on sandbox-runtime, because
 * sandbox-runtime's getFsWriteConfig() does not call normalizePathForSandbox
 * on allowWrite paths (it only strips trailing glob suffixes).
 *
 * densable `awo`/`c2t` (2.1.224 #10): expand then Mmr strip trailing slash so
 * `denyRead: "~/.aws/"` is not silently bypassable on Linux/macOS.
 */
export function resolveSandboxFilesystemPath(
  pattern: string,
  source: SettingSource,
): string {
  // Legacy permission-rule escape: //path → /path. Kept for compat with
  // users who worked around #30067 by writing //Users/foo/.cargo in config.
  if (pattern.startsWith('//')) {
    return stripTrailingSlashForSandbox(pattern.slice(1))
  }
  return stripTrailingSlashForSandbox(
    expandPath(pattern, getSettingsRootPathForSource(source)),
  )
}

/**
 * Check if only managed sandbox domains should be used.
 * This is true when policySettings has sandbox.network.allowManagedDomainsOnly: true
 */
export function shouldAllowManagedSandboxDomainsOnly(): boolean {
  return (
    getSettingsForSource('policySettings')?.sandbox?.network
      ?.allowManagedDomainsOnly === true
  )
}

export function shouldAllowManagedReadPathsOnly(): boolean {
  return (
    getSettingsForSource('policySettings')?.sandbox?.filesystem
      ?.allowManagedReadPathsOnly === true
  )
}

/**
 * densable 2.1.216 — managed lock for sandbox.filesystem.disabled.
 * If policySettings configures sandbox.filesystem at all, or lists any
 * sandbox.credentials.files entry, only managed settings may set disabled.
 * credentials.envVars does not pin (env scrubbing is independent of FS layer).
 */
export function isSandboxFilesystemDisabledLockedByManaged(): boolean {
  const managedSandbox = getSettingsForSource('policySettings')?.sandbox
  if (!managedSandbox) {
    return false
  }
  if (managedSandbox.filesystem !== undefined) {
    return true
  }
  // densable: managed lock when credentials.files has any entry (envVars do not pin).
  const files = managedSandbox.credentials?.files
  return Array.isArray(files) && files.length > 0
}

/**
 * densable 2.1.216 Gvg/Wvg gate — effective sandbox.filesystem.disabled.
 *
 * - Native Windows: always false (isolation must stay on).
 * - projectSettings / localSettings: ignored for this flag.
 * - Honored only from userSettings, flagSettings (`--settings`), policySettings.
 * - When managed locks filesystem (or credentials.files), only policySettings.disabled.
 * - Unset → false (FS isolation on).
 */
export function resolveSandboxFilesystemDisabled(): boolean {
  // densable: ignored on native Windows (separate-user sandbox has no grants
  // to loosen by dropping FS rules).
  if (getPlatform() === 'windows') {
    return false
  }

  if (isSandboxFilesystemDisabledLockedByManaged()) {
    return (
      getSettingsForSource('policySettings')?.sandbox?.filesystem?.disabled ===
      true
    )
  }

  // Later sources win among allowed sources (user < flag). policy is only
  // consulted when it does not lock; if it sets filesystem.disabled without
  // "configuring filesystem" it can't happen — lock checks filesystem !== undefined.
  // Allowed sources when unlocked: userSettings, flagSettings.
  // densable also honors managed when unlocked — if managed has disabled without
  // filesystem object it can't; if managed has only other sandbox keys, user/flag apply.
  const flagDisabled =
    getSettingsForSource('flagSettings')?.sandbox?.filesystem?.disabled
  if (flagDisabled !== undefined) {
    return flagDisabled === true
  }

  const userDisabled =
    getSettingsForSource('userSettings')?.sandbox?.filesystem?.disabled
  if (userDisabled !== undefined) {
    return userDisabled === true
  }

  // policySettings without locking filesystem object: still allow explicit true
  // if somehow present under a partial shape (defensive; lock covers normal path).
  const policyDisabled =
    getSettingsForSource('policySettings')?.sandbox?.filesystem?.disabled
  if (policyDisabled !== undefined) {
    return policyDisabled === true
  }

  return false
}

/** densable Gvg when disabled — enforcement unrestricted (empty deny). */
export function getDisabledSandboxFsReadConfig(): FsReadRestrictionConfig {
  return { denyOnly: [], allowWithinDeny: [] }
}

/** densable Wvg when disabled — enforcement unrestricted write via root allowOnly. */
export function getDisabledSandboxFsWriteConfig(): FsWriteRestrictionConfig {
  return { allowOnly: ['/'], denyWithinAllow: [] }
}

/**
 * Official 325 `i3n()` — deduplicated resolved roots for `--plugin-dir` and
 * `--plugin-dir-no-mcp` flags.
 */
export function getInlinePluginRoots(baseDir = getOriginalCwd()): string[] {
  const seen = new Set<string>()
  const roots: string[] = []
  for (const p of [...getInlinePlugins(), ...getInlinePluginsNoMcp()]) {
    const resolved = resolve(baseDir, p)
    if (!seen.has(resolved)) {
      seen.add(resolved)
      roots.push(resolved)
    }
  }
  return roots
}

/**
 * densable host credentials merge for SandboxRuntimeConfig.credentials.
 *
 * - files: path-resolved via resolveSandboxFilesystemPath; densable 2.1.221
 *   accepts mode "deny"|"mask" + extract/onExtractNoMatch/maskDuplicates/injectHosts.
 * - envVars: later sources win, but mode "deny" is sticky (not overwritten).
 * - mask (files + envVars) from projectSettings/localSettings is skipped
 *   (untrusted repo).
 * - mask from userSettings is skipped when userSettings source is disabled
 *   (densable `ug("userSettings")` / isSettingSourceEnabled).
 * - allowPlaintextInject only from trusted sources (not project/local, not
 *   disabled user).
 * - Package Vzi/Anu/vnu turns this into unsetEnvVars/setEnvVars/maskedFileBinds.
 */
export function mergeSandboxCredentialsForRuntime():
  | SandboxRuntimeConfig['credentials']
  | undefined {
  type Cred = NonNullable<SandboxRuntimeConfig['credentials']>
  const files: NonNullable<Cred['files']> = []
  const envByName = new Map<string, NonNullable<Cred['envVars']>[number]>()
  const awsPairs: NonNullable<Cred['awsPairs']> = []
  let seen = false
  let allowPlaintextInject: boolean | undefined
  let sigv4: Cred['sigv4'] | undefined

  for (const source of SETTING_SOURCES) {
    const cred = getSettingsForSource(source)?.sandbox?.credentials
    if (!cred) {
      continue
    }
    seen = true
    const isProjectLocal =
      source === 'projectSettings' || source === 'localSettings'
    const isUntrustedUser =
      source === 'userSettings' && !isSettingSourceEnabled('userSettings')
    const isTrustedSource = !isProjectLocal && !isUntrustedUser

    for (const entry of cred.files ?? []) {
      if (!entry?.path) {
        continue
      }
      // densable 2.1.221: skip file mask from untrusted project/local or disabled user
      if (entry.mode === 'mask' && (isProjectLocal || isUntrustedUser)) {
        continue
      }
      const resolved: NonNullable<Cred['files']>[number] = {
        path: resolveSandboxFilesystemPath(entry.path, source),
        mode: entry.mode,
      }
      if (entry.mode === 'mask') {
        if (entry.extract !== undefined) {
          resolved.extract = entry.extract
        }
        if (entry.onExtractNoMatch !== undefined) {
          resolved.onExtractNoMatch = entry.onExtractNoMatch
        }
        // densable 2.1.224 #6 — jwt decode + claim-level mask
        if (entry.decode !== undefined) {
          resolved.decode = entry.decode
        }
        if (entry.maskClaims !== undefined) {
          resolved.maskClaims = [...entry.maskClaims]
        }
        if (entry.maskDuplicates !== undefined) {
          resolved.maskDuplicates = entry.maskDuplicates
        }
        if (entry.injectHosts !== undefined) {
          resolved.injectHosts = [...entry.injectHosts]
        }
      }
      files.push(resolved)
    }

    for (const entry of cred.envVars ?? []) {
      if (!entry?.name) {
        continue
      }
      // densable: skip mask from untrusted project/local or disabled user
      if (entry.mode === 'mask' && (isProjectLocal || isUntrustedUser)) {
        continue
      }
      // deny sticky — densable does not let a later entry replace deny
      if (envByName.get(entry.name)?.mode === 'deny') {
        continue
      }
      const envResolved: NonNullable<Cred['envVars']>[number] = {
        name: entry.name,
        mode: entry.mode,
      }
      if (entry.mode === 'mask') {
        // densable 2.1.224 #6 — structured env masking (extract/decode/maskClaims)
        if (entry.extract !== undefined) {
          envResolved.extract = entry.extract
        }
        if (entry.onExtractNoMatch !== undefined) {
          envResolved.onExtractNoMatch = entry.onExtractNoMatch
        }
        if (entry.decode !== undefined) {
          envResolved.decode = entry.decode
        }
        if (entry.maskClaims !== undefined) {
          envResolved.maskClaims = [...entry.maskClaims]
        }
        if (entry.injectHosts !== undefined) {
          envResolved.injectHosts = [...entry.injectHosts]
        }
      }
      envByName.set(entry.name, envResolved)
    }

    if (isTrustedSource && cred.allowPlaintextInject !== undefined) {
      allowPlaintextInject = cred.allowPlaintextInject
    }

    // densable 2.1.224 #6 — awsPairs/sigv4: user/managed/CLI only
    if (isTrustedSource) {
      for (const pair of cred.awsPairs ?? []) {
        if (!pair?.accessKeyIdVar || !pair?.secretAccessKeyVar) {
          continue
        }
        awsPairs.push({
          accessKeyIdVar: pair.accessKeyIdVar,
          secretAccessKeyVar: pair.secretAccessKeyVar,
          ...(pair.sessionTokenVar !== undefined
            ? { sessionTokenVar: pair.sessionTokenVar }
            : {}),
        })
      }
      if (cred.sigv4 !== undefined) {
        sigv4 = {
          ...(cred.sigv4.streaming !== undefined
            ? { streaming: cred.sigv4.streaming }
            : {}),
          ...(cred.sigv4.presigned !== undefined
            ? { presigned: cred.sigv4.presigned }
            : {}),
          ...(cred.sigv4.sigv4a !== undefined
            ? { sigv4a: cred.sigv4.sigv4a }
            : {}),
        }
      }
    }
  }

  if (!seen) {
    return undefined
  }
  return {
    files,
    envVars: [...envByName.values()],
    ...(allowPlaintextInject !== undefined ? { allowPlaintextInject } : {}),
    ...(awsPairs.length > 0 ? { awsPairs } : {}),
    ...(sigv4 !== undefined ? { sigv4 } : {}),
  }
}

/**
 * densable FQt / GDt sources for network fields honored only from
 * managed/policy, flag (`--settings`), and enabled userSettings.
 * Project/local ignored.
 */
export function trustedSandboxNetworkSources(): Array<
  SettingsJson | null | undefined
> {
  return [
    getSettingsForSource('policySettings'),
    getSettingsForSource('flagSettings'),
    isSettingSourceEnabled('userSettings')
      ? getSettingsForSource('userSettings')
      : null,
  ]
}

export const SANDBOX_NETWORK_BYPASS_KEYS = [
  'allowUnixSockets',
  'allowAllUnixSockets',
  'allowLocalBinding',
  'allowMachLookup',
  'httpProxyPort',
  'socksProxyPort',
] as const

export const SANDBOX_PROXY_PORT_KEYS = [
  'httpProxyPort',
  'socksProxyPort',
] as const

export function pickTrustedSandboxValue<T>(
  getter: (sandbox: NonNullable<SettingsJson['sandbox']>) => T | undefined,
): T | undefined {
  for (const src of trustedSandboxNetworkSources()) {
    const val = src?.sandbox ? getter(src.sandbox) : undefined
    if (val !== undefined) return val
  }
  return undefined
}

export function pickPolicySandboxValue<T>(
  getter: (sandbox: NonNullable<SettingsJson['sandbox']>) => T | undefined,
): T | undefined {
  const policySandbox = getSettingsForSource('policySettings')?.sandbox
  return policySandbox ? getter(policySandbox) : undefined
}

export function mergeTrustedSandboxArray<T>(
  getter: (
    sandbox: NonNullable<SettingsJson['sandbox']>,
  ) => readonly T[] | undefined,
): T[] {
  const out: T[] = []
  const seen = new Set<T>()
  for (const src of trustedSandboxNetworkSources()) {
    const arr = src?.sandbox ? getter(src.sandbox) : undefined
    if (!arr) continue
    for (const item of arr) {
      if (!seen.has(item)) {
        seen.add(item)
        out.push(item)
      }
    }
  }
  return out
}

export function mergeTrustedIgnoreViolations():
  | Record<string, string[]>
  | undefined {
  const merged = new Map<string, string[]>()
  for (const src of trustedSandboxNetworkSources()) {
    const entries = src?.sandbox?.ignoreViolations
    if (!entries) continue
    for (const [cmd, paths] of Object.entries(entries)) {
      const existing = merged.get(cmd) ?? []
      merged.set(cmd, Array.from(new Set([...existing, ...paths])))
    }
  }
  return merged.size > 0 ? Object.fromEntries(merged) : undefined
}

/**
 * Official 2.1.328 `Xo()` (`chunk@290312616.js@1092764`) + admin sandbox
 * mandate (`policySettings.sandbox.enabled`): true when enterprise policy or
 * CLI flag mandates the sandbox.
 */
export function isSandboxAdminMandated(): boolean {
  if (shouldAllowManagedSandboxDomainsOnly()) return true
  const policySandbox = getSettingsForSource('policySettings')?.sandbox
  if (
    policySandbox?.enabled === true ||
    policySandbox?.failIfUnavailable === true ||
    policySandbox?.allowUnsandboxedCommands === false
  ) {
    return true
  }
  const flagSandbox = getSettingsForSource('flagSettings')?.sandbox
  if (flagSandbox?.allowUnsandboxedCommands === false) {
    return true
  }
  return false
}

/**
 * densable FQt slice for network.tlsTerminate — managed/policy, flag, then
 * userSettings only when that source is enabled. Project/local ignored.
 */
export function resolveSandboxTlsTerminate():
  | NonNullable<SandboxRuntimeConfig['network']['tlsTerminate']>
  | undefined {
  return trustedSandboxNetworkSources()
    .map(s => s?.sandbox?.network?.tlsTerminate)
    .find(v => v !== undefined)
}

/**
 * densable 2.1.219 GDt().some(K => K?.sandbox?.network?.strictAllowlist === true)
 * — user / managed / CLI only; project settings ignored.
 */
export function resolveSandboxStrictAllowlist(): boolean {
  return trustedSandboxNetworkSources().some(
    s => s?.sandbox?.network?.strictAllowlist === true,
  )
}

/**
 * Official 2.1.328 `$me()` (`chunk@290312616.js@1093867`): true when a trusted
 * network restriction is active (admin mandate, strict allowlist, or trusted
 * denied domains / WebFetch domain deny rules).
 */
export function hasTrustedSandboxNetworkRestriction(): boolean {
  if (isSandboxAdminMandated() || resolveSandboxStrictAllowlist()) {
    return true
  }
  const sources = [
    getSettingsForSource('policySettings'),
    getSettingsForSource('flagSettings'),
  ]
  return sources.some(
    s =>
      (s?.sandbox?.network?.deniedDomains?.length ?? 0) > 0 ||
      (s?.permissions?.deny ?? []).some(
        rule =>
          typeof rule === 'string' &&
          /^WebFetch\(\s*domain:/i.test(rule.trim()),
      ),
  )
}

/**
 * densable 2.1.232 #48 — sandbox.ripgrep via rkt() layers:
 * policy tiers + flagSettings + enabled userSettings; project/local ignored.
 * First defined wins (policy → flag → user), matching densable `.find`.
 */
export function resolveSandboxRipgrep():
  | { command: string; args?: string[] }
  | undefined {
  const raw = trustedSandboxNetworkSources()
    .map(s => s?.sandbox?.ripgrep)
    .find(v => v !== undefined && v !== null)
  if (!raw || typeof raw !== 'object') return undefined
  const command = (raw as { command?: unknown }).command
  if (typeof command !== 'string' || command.length === 0) return undefined
  const argsRaw = (raw as { args?: unknown }).args
  const args = Array.isArray(argsRaw)
    ? argsRaw.filter((a): a is string => typeof a === 'string')
    : undefined
  return args !== undefined ? { command, args } : { command }
}

/**
 * densable XEn — sandbox.bwrapPath from managed/policy tiers only.
 * Project/user/flag ignored (schema: admin-controlled managed settings).
 */
export function resolveSandboxBwrapPath(): string | undefined {
  const v = getSettingsForSource('policySettings')?.sandbox?.bwrapPath
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/**
 * densable Mad — sandbox.socatPath from managed/policy tiers only.
 */
export function resolveSandboxSocatPath(): string | undefined {
  const v = getSettingsForSource('policySettings')?.sandbox?.socatPath
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/**
 * densable `tuu` — pure warning when envVars mask is configured but neither
 * network.tlsTerminate nor credentials.allowPlaintextInject is set.
 * Exported for tests / doctor; package Anu still masks to sentinels either way.
 */
export function maskCredentialInjectionWarning(
  config: SandboxRuntimeConfig | undefined | null,
): string | undefined {
  if (!config) {
    return undefined
  }
  const maskNames = (config.credentials?.envVars ?? [])
    .filter(r => r.mode === 'mask')
    .map(r => r.name)
  if (maskNames.length === 0) {
    return undefined
  }
  if (
    config.network.tlsTerminate !== undefined ||
    config.credentials?.allowPlaintextInject
  ) {
    return undefined
  }
  return (
    `sandbox.credentials mask entries (${maskNames.join(', ')}) are configured ` +
    'but TLS termination is unavailable — sandboxed commands see only a ' +
    'sentinel value and the proxy cannot substitute the real credential on egress, so tools needing these will fail to authenticate. Enable sandbox.network.tlsTerminate, or remove the mask entries'
  )
}
