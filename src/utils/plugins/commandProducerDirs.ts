/**
 * densable 2.1.229 #4 residual — command-source producer-dir deny bag
 * (zvt / qvt / _qu / lDs session state).
 *
 * After a command-sourced plugin resolves, its producer directory is added so
 * sandbox / write tools can refuse mutating that tree (copy or link source).
 *
 * densable qvt: `cDs=xs()` signal; zvt with emit (default) → qvt → cDs.emit().
 * Sole densable consumer: sandbox init `cDs.subscribe(() => bHo())` (refreshConfig).
 */

import { readFileSync, statSync } from 'fs'
import { isAbsolute, join, relative, resolve } from 'path'
import { logError } from '../log.js'
import { createSignal } from '../signal.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { getPluginSeedDirs, getPluginsDirectory } from './pluginDirectories.js'
import { isWindowsUncOrDevicePath } from './pluginCommandSource.js'

/** densable gu().commandProducerDirsDenied */
const commandProducerDirsDenied = new Set<string>()

/** densable gu().commandProducerDirsComparable — null means recompute on next _qu */
let commandProducerDirsComparable: string[] | null = null

/** densable gu().commandProducerDirsScannedAt */
let commandProducerDirsScannedAt = 0

/**
 * densable cDs = xs() — pure event signal for command-producer deny bag changes.
 * densable qvt() → cDs.emit(); sandbox bHo refreshConfig is the product subscriber.
 */
const commandProducerDirsChanged = createSignal()

/**
 * densable qvt — notify subscribers that the producer-deny bag changed.
 * Errors from listeners are swallowed (densable `try{cDs.emit()}catch(e){xe(e)}`).
 */
export function emitCommandProducerDirsChanged(): void {
  try {
    commandProducerDirsChanged.emit()
  } catch (e) {
    logError(e)
  }
}

/**
 * densable cDs.subscribe — returns unsubscribe.
 */
export function subscribeCommandProducerDirsChanged(
  listener: () => void,
): () => void {
  return commandProducerDirsChanged.subscribe(listener)
}

/**
 * densable H_ / jYi — macOS /net automount prefix (skip as producer deny).
 */
export function isAutofsNetPath(p: string): boolean {
  if (!p.startsWith('/')) return false
  const parts = p.split('/').filter(s => s !== '' && s !== '.')
  if (parts.length >= 2 && parts[0]!.toLowerCase() === 'net') {
    return true
  }
  return false
}

/**
 * densable zvt — session-deny a command producer directory.
 * Skips non-absolute, UNC/device, and /net paths.
 * densable: when emit (default true) and the path is newly added → qvt().
 */
export function denyCommandProducerDir(
  producerPath: string,
  options: { emit?: boolean } = {},
): void {
  if (!isAbsolute(producerPath)) return
  if (isWindowsUncOrDevicePath(producerPath)) return
  if (isAutofsNetPath(producerPath)) return
  if (commandProducerDirsDenied.has(producerPath)) return
  commandProducerDirsDenied.add(producerPath)
  commandProducerDirsComparable = null
  if (options.emit !== false) {
    emitCommandProducerDirsChanged()
  }
}

/** densable: read-only view of the deny set (tests + sandbox callers) */
export function getCommandProducerDirsDenied(): ReadonlySet<string> {
  return commandProducerDirsDenied
}

/** Test helper — clear session bag */
export function clearCommandProducerDirsDeniedForTests(): void {
  commandProducerDirsDenied.clear()
  commandProducerDirsComparable = null
  commandProducerDirsScannedAt = 0
}

/**
 * densable kgt(path, {foldCase}) — resolve + NFC; lower-case on case-insensitive
 * platforms (darwin/win32) so _qu/DXS and sandbox BFs match densable cpe.
 * Does not invent full realpath/zee walk — product deny only needs foldCase.
 */
export function toComparablePath(
  p: string,
  options: { foldCase?: boolean } = {},
): string {
  // densable kgt default foldCase:!0 (always); product _qu/cpe use this.
  const fold = options.foldCase ?? true
  const resolved = resolve(p).normalize('NFC')
  return fold ? resolved.toLowerCase() : resolved
}

/**
 * densable cpe-ish: is `candidate` equal to or under `root`?
 * Uses densable foldCase on darwin/win32 (cpe default foldCase:!0).
 */
export function isPathEqualOrUnder(root: string, candidate: string): boolean {
  const r = toComparablePath(root)
  const c = toComparablePath(candidate)
  if (r === c) return true
  const rel = relative(r, c)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function isSafeProducerPath(p: string): boolean {
  return isAbsolute(p) && !isWindowsUncOrDevicePath(p) && !isAutofsNetPath(p)
}

/** densable Ms_ — max installed_plugins.json size for lDs scan */
const MAX_INSTALLED_PLUGINS_SCAN_BYTES = 4_194_304

/**
 * densable RPo — roots whose installed_plugins.json may carry producer paths.
 * plugins + cowork_plugins under config home, active plugins dir, seed dirs.
 */
export function getCommandProducerScanRoots(): string[] {
  const home = getClaudeConfigHomeDir()
  const roots = [
    resolve(home, 'plugins'),
    resolve(home, 'cowork_plugins'),
    resolve(getPluginsDirectory()),
    ...getPluginSeedDirs().map(d => resolve(d)),
  ]
  return [...new Set(roots)]
}

/**
 * densable lDs — fold sourceProducerPath / previousProducerPaths from
 * installed_plugins.json under each scan root into the session deny bag.
 * Returns the full deny list after the scan.
 */
export function scanInstalledCommandProducerDirs(
  scanRoots: readonly string[],
): string[] {
  const denied = commandProducerDirsDenied
  commandProducerDirsScannedAt = Date.now()
  commandProducerDirsComparable = null

  for (const root of new Set(scanRoots)) {
    let raw: string
    try {
      const filePath = join(root, 'installed_plugins.json')
      // densable lDs is sync on the write-permission hot path
      const st = statSync(filePath)
      if (!st.isFile() || st.size > MAX_INSTALLED_PLUGINS_SCAN_BYTES) continue
      raw = readFileSync(filePath, 'utf8')
    } catch {
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('plugins' in parsed)
    ) {
      continue
    }
    const plugins = (parsed as { plugins?: unknown }).plugins
    if (typeof plugins !== 'object' || plugins === null) continue

    for (const installations of Object.values(
      plugins as Record<string, unknown>,
    )) {
      if (!Array.isArray(installations)) continue
      for (const entry of installations) {
        if (typeof entry !== 'object' || entry === null) continue
        const rec = entry as {
          sourceCommand?: unknown
          sourceProducerPath?: unknown
          previousProducerPaths?: unknown
        }
        const candidates: string[] = []
        if (
          rec.sourceCommand !== undefined &&
          typeof rec.sourceProducerPath === 'string'
        ) {
          candidates.push(rec.sourceProducerPath)
        }
        if (Array.isArray(rec.previousProducerPaths)) {
          for (const p of rec.previousProducerPaths) {
            if (typeof p === 'string') candidates.push(p)
          }
        }
        for (const c of candidates) {
          if (isSafeProducerPath(c)) {
            denied.add(c)
          }
        }
      }
    }
  }

  return [...denied]
}

/**
 * densable _qu: is `targetPath` under any denied producer dir?
 *
 * Rebuilds the comparable list when:
 * - never built, or
 * - maxAgeMs elapsed since last lDs scan (when scanRoots provided), or
 * - zvt invalidated the cache.
 *
 * When `scanRoots` is non-empty, runs densable lDs to fold disk producers into
 * the session bag before the check.
 */
export function isPathUnderDeniedCommandProducer(
  targetPath: string,
  scanRoots: readonly string[] = [],
  options: { maxAgeMs?: number } = {},
): boolean {
  const maxAgeMs = options.maxAgeMs ?? 0
  const now = Date.now()
  const scanFresh =
    maxAgeMs > 0 && now - commandProducerDirsScannedAt < maxAgeMs

  if (!scanFresh || commandProducerDirsComparable === null) {
    if (scanRoots.length > 0) {
      scanInstalledCommandProducerDirs(scanRoots)
    } else {
      // No disk scan — still rebuild comparable from session bag only
      commandProducerDirsScannedAt = now
    }

    const roots = [...commandProducerDirsDenied].filter(isSafeProducerPath)
    // densable also folds scan-root paths outside home; keep producer bag only
    // for product deny (writing into ~/.claude/plugins cache is already gated
    // by other rules). Session zvt + lDs producers are the product surface.
    // Store foldCase-comparable roots (densable kgt) for _qu.
    commandProducerDirsComparable = roots.map(d => toComparablePath(d))
  }

  if (
    !commandProducerDirsComparable ||
    commandProducerDirsComparable.length === 0
  ) {
    return false
  }

  const target = toComparablePath(targetPath)
  // Comparable roots already foldCase-normalized; compare without re-fold.
  return commandProducerDirsComparable.some(root => {
    if (root === target) return true
    const rel = relative(root, target)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  })
}
