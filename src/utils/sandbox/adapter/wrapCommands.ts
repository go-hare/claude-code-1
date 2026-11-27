/**
 * Command wrapping and platform-specific sandbox post-processing:
 * - macOS Seatbelt `process-info*` hardening
 * - Linux/WSL bwrap `--tmpfs` / `--ro-bind` / `--bind` mount-order fix &
 *   `SRT_ALLOW_NESTED_USERNS` env propagation
 * - Windows native `srt-win.exe` argv wrapping, CRT quoting, multi-line
 *   encoding, and preflight NTFS deny application
 */

import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime'
import { SandboxManager as BaseSandboxManager } from '@anthropic-ai/sandbox-runtime'
import { existsSync, readdirSync, realpathSync } from 'fs'
import { homedir } from 'os'
import { win32 as win32Path } from 'path'
import {
  getAdditionalDirectoriesForClaudeMd,
  getOriginalCwd,
} from '../../../bootstrap/state.js'
import { getCwd } from '../../cwd.js'
import { getPlatform } from '../../platform.js'
import { getSettings_DEPRECATED } from '../../settings/settings.js'
import { recheckReadDenyAndCredentialMasksBeforeWrap } from '../readDenyRecheck.js'
import {
  promoteDenyLiteralSymlinkTargets,
  recordWrapWriteRoots,
} from '../symlinkedDenyScrub.js'
import {
  areWindowsLocalConnectionsOn,
  ensureDefaultWindowsSandboxNativeProvider,
  getWindowsSandboxNativeProvider,
  isWindowsBackendUnset,
  isWindowsCommandLineTooLong,
  WINDOWS_BACKEND_UNSET_MESSAGE,
  WindowsSandboxError,
  windowsArgvTooLongError,
} from '../windowsSandbox.js'
import {
  ensureAtomicWriteStagingDirs,
  ensureBridgeSpawnRootDirForWrap,
} from '../wrapPreflight.js'
import {
  convertToSandboxRuntimeConfig,
  resolveTrustedSandboxSettings,
} from './configConversion.js'
import { SRT_ALLOW_NESTED_USERNS_ENV } from './constants.js'
import { isSandboxingEnabled } from './diagnostics.js'
import { snapshotGitDirBeforeSandboxWrap } from './gitDirGuard.js'
import { hasMultipleStartedSandboxHosts } from './hostState.js'
import { ensureInitializedForWrap } from './lifecycle.js'
import {
  ensureUpdaterStagingDir,
  precreateMissingLinuxAddDirs,
  resolveSandboxFilesystemDisabled,
} from './pathPolicy.js'

/**
 * Official 2.1.323 #2207: harden macOS Seatbelt profile in the wrapped
 * `sandbox-exec -p '...'` command so `process-info*` is denied by default and
 * only allowed for `(target same-sandbox)` plus `process-info-listpids` when
 * defined — matching official SEA `@285714858` without modifying `node_modules/`.
 */
export function hardenMacOsSeatbeltProcessInfo(wrappedCommand: string): string {
  if (!wrappedCommand.includes('(allow process-info* (target same-sandbox))')) {
    return wrappedCommand
  }
  if (wrappedCommand.includes('(deny process-info*')) {
    return wrappedCommand
  }
  const logTagMatch = /; LogTag: ([^\n'"\\]+)/.exec(wrappedCommand)
  const logTag = logTagMatch?.[1]
  // Inside single-quoted shell-quote arguments, a literal `'` must be escaped as `'\''`.
  const isSingleQuoted =
    wrappedCommand.includes("sandbox-exec -p '") ||
    /sandbox-exec\s+-p\s+'/.test(wrappedCommand)
  // Inside double-quoted (or backslash-escaped) shell-quote arguments (e.g. when a path
  // contains `'`), literal `"` must be escaped as `\"` so it does not close the outer quote.
  const isDoubleQuoted =
    /sandbox-exec\s+-p\s+"/.test(wrappedCommand) ||
    (!isSingleQuoted && wrappedCommand.includes('\\"'))
  const denyLine = logTag
    ? isDoubleQuoted
      ? `(deny process-info* (with message \\"${logTag}\\"))`
      : `(deny process-info* (with message "${logTag}"))`
    : '(deny process-info*)'
  const listPidsLine = isSingleQuoted
    ? "(if (defined? '\\''process-info-listpids) (allow process-info-listpids))"
    : "(if (defined? 'process-info-listpids) (allow process-info-listpids))"
  return wrappedCommand.replace(
    '(allow process-info* (target same-sandbox))',
    `${denyLine}\n(allow process-info* (target same-sandbox))\n${listPidsLine}`,
  )
}

/**
 * Tokenize a POSIX shell command string preserving original token slices so
 * we can inspect and reorder bwrap mount flags without altering shell quoting.
 */
function tokenizeShellCommandPreservingRaw(
  cmd: string,
): Array<{ raw: string; value: string; sep: string }> {
  const tokens: Array<{ raw: string; value: string; sep: string }> = []
  let i = 0
  const n = cmd.length
  while (i < n) {
    const sepStart = i
    while (i < n && /\s/.test(cmd[i]!)) i++
    const sep = cmd.slice(sepStart, i)
    if (i >= n) break
    const rawStart = i
    let value = ''
    while (i < n && !/\s/.test(cmd[i]!)) {
      const ch = cmd[i]!
      if (ch === "'") {
        i++
        while (i < n && cmd[i] !== "'") {
          value += cmd[i++]
        }
        if (i < n) i++
      } else if (ch === '"') {
        i++
        while (i < n && cmd[i] !== '"') {
          if (cmd[i] === '\\' && i + 1 < n) {
            i++
            value += cmd[i++]
          } else {
            value += cmd[i++]
          }
        }
        if (i < n) i++
      } else if (ch === '\\' && i + 1 < n) {
        i++
        value += cmd[i++]
      } else {
        value += cmd[i++]
      }
    }
    tokens.push({ raw: cmd.slice(rawStart, i), value, sep })
  }
  return tokens
}

function isSameOrChildPath(parent: string, child: string): boolean {
  const normParent = parent === '/' ? '/' : parent.replace(/\/+$/, '')
  const normChild = child === '/' ? '/' : child.replace(/\/+$/, '')
  if (normParent === normChild) return true
  const prefix = normParent === '/' ? '/' : `${normParent}/`
  return normChild.startsWith(prefix)
}

function tryCanonicalPath(p: string): string {
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- wrap post-process
    return realpathSync(p)
  } catch {
    return p
  }
}

/**
 * Official 2.1.325 #2340 (SEA `gj`):
 * Fix Linux/WSL `bwrap: Can't create file` when the working directory (an
 * allowed write path) is below an `allowRead` folder inside a `denyRead`
 * (such as under a symlinked home directory).
 *
 * `@anthropic-ai/sandbox-runtime@0.0.73` emits `--bind <writePath>` BEFORE
 * `--ro-bind <allowRead>` right after `--tmpfs <denyDir>`, so an `allowRead`
 * ancestor overwrites the writable child mount read-only and subsequent
 * `--ro-bind /dev/null <stub>` mounts fail with `Can't create file`.
 *
 * Reordering each `--tmpfs` restore block to emit `--ro-bind` restore mounts
 * BEFORE `--bind` restore mounts (matching 2.1.325 `gj()`) keeps the child
 * write path writable on top of the read-only `allowRead` ancestor.
 */
export function fixLinuxBwrapAllowReadMountOrder(
  wrappedCommand: string,
): string {
  if (!wrappedCommand.includes('--tmpfs')) {
    return wrappedCommand
  }
  const tokens = tokenizeShellCommandPreservingRaw(wrappedCommand)
  let changed = false

  let idx = 0
  while (idx < tokens.length) {
    if (tokens[idx]?.value === '--tmpfs' && idx + 1 < tokens.length) {
      const denyDir = tokens[idx + 1]!.value
      const denyDirReal = tryCanonicalPath(denyDir)
      const blockStart = idx + 2
      let cursor = blockStart
      const roRestoreMounts: Array<typeof tokens> = []
      const rwRestoreMounts: Array<typeof tokens> = []
      const rwRestorePaths: Array<{ raw: string; real: string }> = []

      while (cursor + 2 < tokens.length) {
        const flag = tokens[cursor]!.value
        if (flag !== '--bind' && flag !== '--ro-bind') break
        const src = tokens[cursor + 1]!.value
        const dst = tokens[cursor + 2]!.value
        // Stop if this is a /dev/null file mask or sentinel bind (src !== dst)
        if (src === '/dev/null' || src !== dst) break
        const dstReal = tryCanonicalPath(dst)
        const underDeny =
          isSameOrChildPath(denyDir, dst) ||
          isSameOrChildPath(denyDirReal, dstReal)
        if (!underDeny) break
        const group = tokens.slice(cursor, cursor + 3)
        if (flag === '--ro-bind') {
          // Only treat a `--ro-bind` as an `allowRead` restore mount if it is NOT
          // the same path as or a child of any already-collected `--bind` mount.
          // A `--ro-bind` at or below a writable `--bind` (e.g. `.git/hooks`,
          // `.claude/settings.json`) is a `denyWrite` protection and MUST stay
          // after `--bind` — stop scanning the block immediately.
          const isDenyWriteUnderRw = rwRestorePaths.some(
            rw =>
              isSameOrChildPath(rw.raw, dst) ||
              isSameOrChildPath(rw.real, dstReal),
          )
          if (isDenyWriteUnderRw) break
          roRestoreMounts.push(group)
        } else {
          rwRestoreMounts.push(group)
          rwRestorePaths.push({ raw: dst, real: dstReal })
        }
        cursor += 3
      }

      if (roRestoreMounts.length > 0 && rwRestoreMounts.length > 0) {
        // Check if any --bind appeared before a --ro-bind in the original order
        let seenBind = false
        let needsReorder = false
        for (let k = blockStart; k < cursor; k += 3) {
          if (tokens[k]!.value === '--bind') {
            seenBind = true
          } else if (tokens[k]!.value === '--ro-bind' && seenBind) {
            needsReorder = true
            break
          }
        }
        if (needsReorder) {
          // Emit --ro-bind restore mounts first (shallow-first), then --bind restore mounts
          const reordered = [...roRestoreMounts, ...rwRestoreMounts].flat()
          // Preserve original leading separators for each slot
          const originalSeps = tokens
            .slice(blockStart, cursor)
            .map(t => t.sep || ' ')
          for (let k = 0; k < reordered.length; k++) {
            tokens[blockStart + k] = {
              ...reordered[k]!,
              sep: originalSeps[k] ?? ' ',
            }
          }
          changed = true
        }
      }
      idx = cursor
    } else {
      idx++
    }
  }

  if (!changed) return wrappedCommand
  return tokens.map(t => `${t.sep}${t.raw}`).join('')
}

/**
 * Official 2.1.328 `Gq(e)` (`chunk@290312616.js@740798, 757066`):
 * Propagate `SRT_ALLOW_NESTED_USERNS=0|1` on Linux/WSL wrapped sandbox commands
 * so seccomp filters receive the official default-deny signal even when running
 * `@anthropic-ai/sandbox-runtime@0.0.73`.
 */
export function applyLinuxNestedUsernsEnv(
  wrappedCommand: string,
  allowNestedUserNamespaces: boolean,
): string {
  const value = allowNestedUserNamespaces ? '1' : '0'
  const assignment = `${SRT_ALLOW_NESTED_USERNS_ENV}=${value}`
  if (wrappedCommand.includes(`${SRT_ALLOW_NESTED_USERNS_ENV}=`)) {
    return wrappedCommand.replace(/SRT_ALLOW_NESTED_USERNS=[01]/g, assignment)
  }
  if (/(?:^|\s)(?:\S*\/)?bwrap\s/.test(wrappedCommand)) {
    const withSetenv = wrappedCommand.includes(' -- ')
      ? wrappedCommand.replace(
          ' -- ',
          ` --setenv ${SRT_ALLOW_NESTED_USERNS_ENV} ${value} -- `,
        )
      : wrappedCommand
    return `${assignment} ${withSetenv}`
  }
  return `${assignment} ${wrappedCommand}`
}

function quoteWindowsCommandArg(arg: string): string {
  if (arg.length === 0) {
    return '""'
  }
  if (!/[\s"]/.test(arg)) {
    return arg
  }
  let out = '"'
  let pendingBackslashes = 0
  for (let i = 0; i < arg.length; i++) {
    const ch = arg[i]
    if (ch === '\\') {
      pendingBackslashes++
    } else if (ch === '"') {
      out += '\\'.repeat(pendingBackslashes * 2 + 1) + '"'
      pendingBackslashes = 0
    } else {
      if (pendingBackslashes > 0) {
        out += '\\'.repeat(pendingBackslashes)
        pendingBackslashes = 0
      }
      out += ch
    }
  }
  if (pendingBackslashes > 0) {
    out += '\\'.repeat(pendingBackslashes * 2)
  }
  out += '"'
  return out
}

function buildWindowsNativeWrapArgv(
  command: string,
  binShell?: string,
  cwd?: string,
): { argv: string[]; env: NodeJS.ProcessEnv } {
  const provider =
    getWindowsSandboxNativeProvider() ??
    ensureDefaultWindowsSandboxNativeProvider()
  if (!provider) {
    throw new WindowsSandboxError(
      'wrap_unsupported',
      'Windows sandbox wrapping requires a registered Windows native provider (srt-win.exe); use SandboxManager.wrapWithSandboxArgv() or SandboxManager.spawnSandboxedOnWindows().',
      'run',
    )
  }
  const spec = provider.srtWinCommand ?? {
    exe: 'srt-win.exe',
    prependArgs: [],
  }
  const args: string[] = [...spec.prependArgs, 'run']
  if (cwd) {
    args.push('--cwd', cwd)
  }
  const proxyPort = BaseSandboxManager.getProxyPort?.()
  if (typeof proxyPort === 'number' && proxyPort >= 1024) {
    args.push('--proxy-port', String(proxyPort))
  }
  if (!areWindowsLocalConnectionsOn()) {
    args.push('--no-allow-loopback')
  }
  const hasNewline = /[\r\n]/.test(command)
  let shellExe = binShell ?? 'cmd.exe'
  let lowerShell = shellExe.toLowerCase()
  const isCmdShell = lowerShell.endsWith('cmd.exe') || lowerShell === 'cmd'
  if (isCmdShell && hasNewline) {
    if (binShell === undefined) {
      shellExe = 'powershell.exe'
      lowerShell = 'powershell.exe'
    } else {
      throw new WindowsSandboxError(
        'wrap_unsupported',
        'Multi-line commands cannot be passed to cmd.exe under Windows sandbox (CR/LF rejected by srt-win); use PowerShell or bash.',
        'run',
      )
    }
  }
  const isPowerShell =
    lowerShell.includes('pwsh') || lowerShell.includes('powershell')
  let shellArgs: string[]
  if (lowerShell.endsWith('cmd.exe') || lowerShell === 'cmd') {
    shellArgs = ['/d', '/s', '/c', command]
  } else if (isPowerShell) {
    if (hasNewline) {
      // E5-P1-2: Encode multi-line PowerShell scripts via UTF-16LE base64
      // -EncodedCommand so CR/LF never triggers srt-win security.rs:349 rejection.
      const encoded = Buffer.from(command, 'utf16le').toString('base64')
      shellArgs = ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded]
    } else {
      shellArgs = ['-NoProfile', '-NonInteractive', '-Command', command]
    }
  } else if (hasNewline) {
    // E5-P1-2: Encode multi-line bash/sh scripts via single-line base64 eval
    // so CR/LF never triggers srt-win security.rs:349 rejection.
    const encoded = Buffer.from(command, 'utf8').toString('base64')
    shellArgs = ['-c', `eval "$(printf '%s' '${encoded}' | base64 -d)"`]
  } else {
    shellArgs = ['-c', command]
  }
  args.push('--', shellExe, ...shellArgs)
  if (isWindowsCommandLineTooLong(spec.exe, args)) {
    throw windowsArgvTooLongError()
  }
  return {
    argv: [spec.exe, ...args],
    env: { ...process.env },
  }
}

export type WindowsDeniesConfigInput = {
  denyRead?: readonly string[]
  denyWrite?: readonly string[]
  allowWrite?: readonly string[]
}

export type WindowsDeniesConfigNormalized = {
  denyRead: string[]
  denyWrite: string[]
  allowWrite: string[]
}

const WIN_DRIVE_ROOT_RE = /^[A-Za-z]:[\\/]/
const TRAILING_DIR_GLOB_RE = /[\\/]\*\*?$/

function hasAsciiControlChar(p: string): boolean {
  for (let i = 0; i < p.length; i++) {
    const code = p.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) {
      return true
    }
  }
  return false
}

function isWindowsDriveRootedPath(p: string): boolean {
  return WIN_DRIVE_ROOT_RE.test(p)
}

function isUncOrDeviceNamespacePath(p: string): boolean {
  const norm = p.replace(/\//g, '\\')
  return norm.startsWith('\\\\') || norm.startsWith('\\??\\')
}

function isPosixRootOnlyPath(p: string): boolean {
  return (
    (p.startsWith('/') && !p.startsWith('//')) ||
    (p.startsWith('\\') && !p.startsWith('\\\\'))
  )
}

function hasGlobWildcard(p: string): boolean {
  return p.includes('*') || p.includes('?')
}

function isSafeSrtWinAbsolutePath(p: string): boolean {
  if (!p || hasAsciiControlChar(p)) return false
  if (isUncOrDeviceNamespacePath(p)) return false
  if (!isWindowsDriveRootedPath(p)) return false
  if (hasGlobWildcard(p)) return false
  if (p.slice(2).includes(':')) return false
  const segments = p.replace(/\//g, '\\').split('\\')
  if (segments.some(seg => seg === '..')) return false
  return true
}

function globPatternToRegExp(glob: string): RegExp {
  let out = '^'
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?'
          i += 2
        } else {
          out += '.*'
          i += 1
        }
      } else {
        out += '[^/]*'
      }
    } else if (ch === '?') {
      out += '[^/]'
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      out += `\\${ch}`
    } else {
      out += ch
    }
  }
  out += '$'
  return new RegExp(out, 'i')
}

function collectRelativeFilesUnderRoot(
  root: string,
  maxDepth = 6,
  maxEntries = 2000,
): string[] {
  const files: string[] = []
  let visited = 0
  const walk = (dir: string, relPrefix: string, depth: number): void => {
    if (depth > maxDepth || visited >= maxEntries) return
    let entries: Array<{
      name: string | Buffer
      isSymbolicLink: () => boolean
      isDirectory: () => boolean
      isFile: () => boolean
    }>
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (visited >= maxEntries) break
      const name = String(entry.name)
      if (entry.isSymbolicLink()) continue
      visited++
      const rel = relPrefix ? `${relPrefix}/${name}` : name
      if (entry.isDirectory()) {
        if (name === 'node_modules' || rel === '.git/objects') continue
        walk(`${dir}/${name}`, rel, depth + 1)
      } else if (entry.isFile()) {
        files.push(rel)
      }
    }
  }
  walk(root, '', 0)
  return files
}

/**
 * P0-3: Normalize and filter a sandbox filesystem config before passing it to
 * Windows `srt-win.exe denies` (`EXIT_VALIDATION=3` rejects relative paths like
 * `'.'`, POSIX-root paths like `'/tmp/...'`, and `*`/`?` glob wildcards):
 * - Resolves relative paths (e.g. `'.'`, `'./out'`, `'.git/config'`) against `cwd`.
 * - Filters out POSIX-root-only paths (`'/tmp/...'`, `'/run/...'`) and UNC/device paths.
 * - Normalizes simple trailing directory globs (`C:\foo\**`, `C:\foo\*`) to concrete dirs.
 * - Materializes supported wildcard deny globs (e.g. `**\/.env`, `**\/.env*`) against
 *   concrete files under `cwd` and strips any remaining raw `*`/`?` patterns.
 * - Preserves all concrete Windows drive-rooted paths and deduplicates case-insensitively.
 */
export function normalizeWindowsDeniesConfig(
  fs: WindowsDeniesConfigInput | undefined,
  cwd: string,
  options?: {
    existingRelativeFiles?: readonly string[]
    homeDir?: string
  },
): WindowsDeniesConfigNormalized {
  const trimmedCwd = cwd.trim()
  const cwdIsWin = isWindowsDriveRootedPath(trimmedCwd)
  const normalizedCwd = cwdIsWin ? win32Path.normalize(trimmedCwd) : trimmedCwd
  const cwdForward = normalizedCwd.replace(/\\/g, '/').replace(/\/+$/, '')
  const cwdForwardLower = cwdForward.toLowerCase()

  const rawHome = options?.homeDir ?? process.env.USERPROFILE ?? homedir()
  const winHome =
    rawHome && isWindowsDriveRootedPath(rawHome)
      ? win32Path.normalize(rawHome)
      : undefined

  let cachedRelFiles: string[] | undefined
  const getRelativeFiles = (): readonly string[] => {
    if (options?.existingRelativeFiles !== undefined) {
      return options.existingRelativeFiles
    }
    if (cachedRelFiles === undefined) {
      cachedRelFiles =
        trimmedCwd && existsSync(trimmedCwd)
          ? collectRelativeFilesUnderRoot(trimmedCwd)
          : []
    }
    return cachedRelFiles
  }

  const expandHomePrefix = (entry: string): string | null => {
    if (entry === '~') return winHome ?? null
    if (entry.startsWith('~/') || entry.startsWith('~\\')) {
      if (!winHome) return null
      return win32Path.join(winHome, entry.slice(2))
    }
    return entry
  }

  const resolveConcreteWinPath = (entry: string): string | null => {
    const expanded = expandHomePrefix(entry)
    if (expanded === null) return null
    if (isPosixRootOnlyPath(expanded) || isUncOrDeviceNamespacePath(expanded)) {
      return null
    }
    let resolved: string
    if (isWindowsDriveRootedPath(expanded)) {
      resolved = win32Path.normalize(expanded)
    } else if (cwdIsWin) {
      resolved = win32Path.resolve(normalizedCwd, expanded)
    } else {
      return null
    }
    return isSafeSrtWinAbsolutePath(resolved) ? resolved : null
  }

  const dedupePush = (
    target: string[],
    seen: Set<string>,
    candidate: string,
  ) => {
    const key = candidate.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      target.push(candidate)
    }
  }

  const normalizeDenyList = (
    entries: readonly string[] | undefined,
  ): string[] => {
    const out: string[] = []
    const seen = new Set<string>()
    for (const raw of entries ?? []) {
      const trimmed = raw.trim()
      if (!trimmed || hasAsciiControlChar(trimmed)) continue
      if (isPosixRootOnlyPath(trimmed) || isUncOrDeviceNamespacePath(trimmed)) {
        continue
      }

      if (!hasGlobWildcard(trimmed)) {
        const concrete = resolveConcreteWinPath(trimmed)
        if (concrete) dedupePush(out, seen, concrete)
        continue
      }

      // Simple trailing directory glob (e.g. `C:\Users\alice\.ssh\**` or `.git/*`)
      if (TRAILING_DIR_GLOB_RE.test(trimmed)) {
        const base = trimmed.replace(TRAILING_DIR_GLOB_RE, '')
        if (base && !hasGlobWildcard(base)) {
          const concrete = resolveConcreteWinPath(base)
          if (concrete) dedupePush(out, seen, concrete)
          continue
        }
      }

      // General wildcard glob (e.g. `**/.env`, `**/.env*`, `C:\work\**\*.pem`):
      // materialize concrete matching files under cwd and strip the raw wildcard.
      if (!cwdIsWin) continue
      const expandedGlob = expandHomePrefix(trimmed)
      if (expandedGlob === null) continue
      let relGlob = expandedGlob.replace(/\\/g, '/')
      if (isWindowsDriveRootedPath(expandedGlob)) {
        const lower = relGlob.toLowerCase()
        if (lower.startsWith(`${cwdForwardLower}/`)) {
          relGlob = relGlob.slice(cwdForward.length + 1)
        } else {
          // Wildcard rooted outside cwd cannot be safely expanded without full-disk walk
          continue
        }
      } else {
        relGlob = relGlob.replace(/^\.\//, '')
      }
      if (!relGlob) continue

      const re = globPatternToRegExp(relGlob)
      for (const relFile of getRelativeFiles()) {
        const cleanRel = relFile.replace(/\\/g, '/').replace(/^\.\//, '')
        if (!cleanRel || !re.test(cleanRel)) continue
        const abs = win32Path.resolve(normalizedCwd, cleanRel)
        if (isSafeSrtWinAbsolutePath(abs)) {
          dedupePush(out, seen, abs)
        }
      }
    }
    return out
  }

  const normalizeAllowList = (
    entries: readonly string[] | undefined,
  ): string[] => {
    const out: string[] = []
    const seen = new Set<string>()
    for (const raw of entries ?? []) {
      let trimmed = raw.trim()
      if (!trimmed || hasAsciiControlChar(trimmed)) continue
      if (isPosixRootOnlyPath(trimmed) || isUncOrDeviceNamespacePath(trimmed)) {
        continue
      }
      if (TRAILING_DIR_GLOB_RE.test(trimmed)) {
        trimmed = trimmed.replace(TRAILING_DIR_GLOB_RE, '')
      }
      if (!trimmed || hasGlobWildcard(trimmed)) continue
      const concrete = resolveConcreteWinPath(trimmed)
      if (concrete) dedupePush(out, seen, concrete)
    }
    return out
  }

  return {
    denyRead: normalizeDenyList(fs?.denyRead),
    denyWrite: normalizeDenyList(fs?.denyWrite),
    allowWrite: normalizeAllowList(fs?.allowWrite),
  }
}

export async function wrapWithSandboxArgv(
  command: string,
  binShell?: string,
  customConfig?: Partial<SandboxRuntimeConfig>,
  abortSignal?: AbortSignal,
  cwd?: string,
  wrapOptions?: { keepsSandboxOn?: boolean },
): Promise<{ argv: string[]; env: NodeJS.ProcessEnv }> {
  const plat = getPlatform()
  if (plat === 'windows') {
    if (isWindowsBackendUnset()) {
      throw new WindowsSandboxError(
        'backend_unset',
        WINDOWS_BACKEND_UNSET_MESSAGE,
        'run',
      )
    }
    const effectiveCwd = cwd ?? getCwd()
    let hostScopedConfig: SandboxRuntimeConfig | undefined
    let activeConfigAfterPreflight: SandboxRuntimeConfig | undefined

    // E5-P1-2: Run full sandbox initialization, `.git` snapshot, read-deny /
    // credential-mask recheck, and Windows NTFS `provider.applyDenies(...)`
    // (failing closed on unguarded denies) BEFORE building the wrap argv.
    if (isSandboxingEnabled()) {
      await ensureInitializedForWrap(wrapOptions)
      await ensureBridgeSpawnRootDirForWrap()
      ensureAtomicWriteStagingDirs()
      if (!resolveSandboxFilesystemDisabled()) {
        ensureUpdaterStagingDir()
      }
      const configuredAddDirs = Array.from(
        new Set([
          ...(getSettings_DEPRECATED()?.permissions?.additionalDirectories ??
            []),
          ...getAdditionalDirectoriesForClaudeMd(),
        ]),
      )
      snapshotGitDirBeforeSandboxWrap(getOriginalCwd(), [
        effectiveCwd,
        ...configuredAddDirs,
      ])
      hostScopedConfig =
        customConfig === undefined && hasMultipleStartedSandboxHosts()
          ? convertToSandboxRuntimeConfig(getSettings_DEPRECATED())
          : undefined
      const getActiveConfig = (): SandboxRuntimeConfig | undefined =>
        hostScopedConfig ?? BaseSandboxManager.getConfig?.()
      const updateActiveConfig = (cfg: SandboxRuntimeConfig): void => {
        if (hostScopedConfig !== undefined) {
          hostScopedConfig = cfg
        } else {
          BaseSandboxManager.updateConfig(cfg)
        }
      }
      promoteDenyLiteralSymlinkTargets({
        getConfig: getActiveConfig,
        updateConfig: updateActiveConfig,
      })
      recheckReadDenyAndCredentialMasksBeforeWrap({
        getConfig: getActiveConfig,
        updateConfig: updateActiveConfig,
      })
      activeConfigAfterPreflight = getActiveConfig()
      recordWrapWriteRoots(activeConfigAfterPreflight)
    }

    const effectiveCustomConfig =
      customConfig ??
      hostScopedConfig ??
      (hasMultipleStartedSandboxHosts()
        ? convertToSandboxRuntimeConfig(getSettings_DEPRECATED())
        : undefined)

    if (isSandboxingEnabled()) {
      const baseFs =
        activeConfigAfterPreflight?.filesystem ??
        effectiveCustomConfig?.filesystem ??
        convertToSandboxRuntimeConfig(getSettings_DEPRECATED()).filesystem
      const mergedFs = customConfig?.filesystem
        ? { ...baseFs, ...customConfig.filesystem }
        : baseFs
      if (mergedFs?.disabled !== true) {
        const provider =
          getWindowsSandboxNativeProvider() ??
          ensureDefaultWindowsSandboxNativeProvider()
        if (provider?.applyDenies) {
          // P0-3: Normalize/filter relative paths, POSIX-only paths, and raw
          // wildcards before invoking srt-win (EXIT_VALIDATION=3).
          const normalizedDenies = normalizeWindowsDeniesConfig(
            mergedFs,
            effectiveCwd,
          )
          // Fail closed: any error applying NTFS denies aborts command wrap.
          await provider.applyDenies(normalizedDenies)
        }
      }
    }

    if (
      process.platform === 'win32' &&
      typeof BaseSandboxManager.wrapWithSandboxArgv === 'function'
    ) {
      return BaseSandboxManager.wrapWithSandboxArgv(
        command,
        binShell,
        effectiveCustomConfig,
        abortSignal,
        effectiveCwd,
      )
    }
    return buildWindowsNativeWrapArgv(command, binShell, effectiveCwd)
  }
  const wrapped = await wrapWithSandbox(
    command,
    binShell,
    customConfig,
    abortSignal,
    wrapOptions,
  )
  return {
    argv: [binShell ?? '/bin/sh', '-c', wrapped],
    env: { ...process.env },
  }
}

/**
 * Wrap command with sandbox, optionally specifying the shell to use
 */
export async function wrapWithSandbox(
  command: string,
  binShell?: string,
  customConfig?: Partial<SandboxRuntimeConfig>,
  abortSignal?: AbortSignal,
  wrapOptions?: { keepsSandboxOn?: boolean },
): Promise<string> {
  const plat = getPlatform()
  // R3-P0-6: BaseSandboxManager.wrapWithSandbox() throws on Windows because
  // Windows wraps to an argv array rather than a POSIX shell string. Route
  // Windows cleanly through wrapWithSandboxArgv() and CRT-quote the argv.
  if (plat === 'windows') {
    const { argv } = await wrapWithSandboxArgv(
      command,
      binShell,
      customConfig,
      abortSignal,
      getCwd(),
      wrapOptions,
    )
    return argv.map(quoteWindowsCommandArg).join(' ')
  }

  let hostScopedConfig: SandboxRuntimeConfig | undefined
  // If sandboxing is enabled, ensure initialization is complete
  if (isSandboxingEnabled()) {
    await ensureInitializedForWrap(wrapOptions)
    // densable wrap: await fN(), pN(), VZ(), FZ(), Ahe()
    await ensureBridgeSpawnRootDirForWrap()
    ensureAtomicWriteStagingDirs()
    if (!resolveSandboxFilesystemDisabled()) {
      ensureUpdaterStagingDir()
    }
    // Official 2.1.326 #302 / #301: collect `--add-dir` / additional working
    // directories, snapshot `.git` across cwd + additionalWorkingDirectories,
    // and pre-create missing Linux/WSL add-dirs before bwrap bind-mounts.
    const configuredAddDirs = Array.from(
      new Set([
        ...(getSettings_DEPRECATED()?.permissions?.additionalDirectories ?? []),
        ...getAdditionalDirectoriesForClaudeMd(),
      ]),
    )
    snapshotGitDirBeforeSandboxWrap(getOriginalCwd(), [
      getCwd(),
      ...configuredAddDirs,
    ])
    if (configuredAddDirs.length > 0) {
      precreateMissingLinuxAddDirs(configuredAddDirs)
    }
    hostScopedConfig =
      customConfig === undefined && hasMultipleStartedSandboxHosts()
        ? convertToSandboxRuntimeConfig(getSettings_DEPRECATED())
        : undefined
    const getActiveConfig = (): SandboxRuntimeConfig | undefined =>
      hostScopedConfig ?? BaseSandboxManager.getConfig?.()
    const updateActiveConfig = (cfg: SandboxRuntimeConfig): void => {
      if (hostScopedConfig !== undefined) {
        hostScopedConfig = cfg
      } else {
        BaseSandboxManager.updateConfig(cfg)
      }
    }
    promoteDenyLiteralSymlinkTargets({
      getConfig: getActiveConfig,
      updateConfig: updateActiveConfig,
    })
    recheckReadDenyAndCredentialMasksBeforeWrap({
      getConfig: getActiveConfig,
      updateConfig: updateActiveConfig,
    })
    recordWrapWriteRoots(getActiveConfig())
  }

  // densable Bou / sandbox-runtime@0.0.70: package wrapWithSandbox itself
  // applies filesystem.disabled precedence (override.filesystem present →
  // override.disabled??false, else session). When disabled, package skips FS
  // mounts while still applying credentials.envVars unset/set (Vzi). No host
  // rewrite of path lists needed.
  const effectiveCustomConfig =
    customConfig ??
    hostScopedConfig ??
    (hasMultipleStartedSandboxHosts()
      ? convertToSandboxRuntimeConfig(getSettings_DEPRECATED())
      : undefined)
  const wrapped = await BaseSandboxManager.wrapWithSandbox(
    command,
    binShell,
    effectiveCustomConfig,
    abortSignal,
  )
  // 2.1.323 #2207: Harden macOS Seatbelt profile so `lsof` and similar tools
  // cannot inspect processes outside the sandbox.
  if (plat === 'macos') {
    return hardenMacOsSeatbeltProcessInfo(wrapped)
  }
  // 2.1.325 #2340: Ensure `--ro-bind` allowRead mounts precede `--bind`
  // writePath mounts after `--tmpfs <denyRead>` so bwrap does not fail with
  // `Can't create file` when cwd is below an `allowRead` inside a `denyRead`.
  // 2.1.328 (`chunk@290312616.js@740798, 757066`): propagate default-deny
  // `SRT_ALLOW_NESTED_USERNS=0|1` so Linux/WSL seccomp filters enforce userns policy.
  if (plat === 'linux' || plat === 'wsl') {
    const fixed = fixLinuxBwrapAllowReadMountOrder(wrapped)
    const customAllowNested = (
      customConfig as { allowNestedUserNamespaces?: boolean } | undefined
    )?.allowNestedUserNamespaces
    const allowNested =
      customAllowNested === false
        ? false
        : resolveTrustedSandboxSettings(getSettings_DEPRECATED())
            .allowNestedUserNamespaces === true
    return applyLinuxNestedUsernsEnv(fixed, allowNested)
  }
  return wrapped
}
