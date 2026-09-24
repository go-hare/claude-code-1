/**
 * densable 2.1.251 #10 — Grep/Glob search root `E2t` and deny compiler `oht`.
 *
 * Opens the search root, refuses when symlink resolution left the approved
 * set, and on Linux/WSL searches through /proc/self/fd when readlink works.
 * Read deny rules are compiled against both the lexical and canonical roots.
 *
 * Gold body is contract. Do NOT invent a `/proc/self/fd` ancestor walk.
 */

import { constants } from 'fs'
import { access, open, readlink, stat, type FileHandle } from 'fs/promises'
import ignore from 'ignore'
import { isAbsolute, relative, sep } from 'path'
import type { ToolPermissionContext } from '../Tool.js'
import { getCwd } from './cwd.js'
import { getErrnoCode } from './errors.js'
import {
  collectSymlinkHops,
  refusingPathOnlyRipgrepMessage,
  refusingSearchAfterPermissionMessage,
  SymlinkResolutionChangedError,
} from './fileToolApprovedOpen.js'
import { getFsImplementation, safeResolvePath } from './fsOperations.js'
import {
  isNtObjectNamespacePath,
  isUncOrNtObjectPath,
  isWslUncPath,
} from './path.js'
import {
  getFileReadIgnorePatterns,
  normalizePatternsToPath,
} from './permissions/filesystem.js'
import { getPlatform } from './platform.js'
import { ripgrepCommand } from './ripgrep.js'

export type SearchRoot = {
  lexical: string
  canonical: string
  spawnCwd: string
  target: string
  relativeOutput: boolean
  isDirectory: boolean
  /** densable N() network/automount path — judge each hit. */
  judgeEveryResult?: boolean
  recheckBeforeSpawn: () => void | Promise<void>
  /** densable recheckByPath — always re-walk approved set + canonical pin. */
  recheckByPath: () => void | Promise<void>
  close: () => Promise<void>
}

function searchRefusal(filePath: string): SymlinkResolutionChangedError {
  return new SymlinkResolutionChangedError(
    refusingSearchAfterPermissionMessage(filePath),
  )
}

/** densable `jn(e)&&!Ds(e)||yr(e)` — network UNC (non-WSL) or NT-namespace. */
function isNetworkOrNtSearchRoot(searchPath: string): boolean {
  return (
    (isUncOrNtObjectPath(searchPath) && !isWslUncPath(searchPath)) ||
    isNtObjectNamespacePath(searchPath)
  )
}

/**
 * densable `Oi(path, rgPath)` — spawn cwd when not on the absolute-rg
 * relativeOutput path. PATH-only rg must stay under the working directory.
 */
function ripgrepSpawnCwd(_searchPath: string, _rgPath: string): string {
  return getCwd()
}

/** densable `np(search, spawnCwd)` — search stays under spawn cwd. */
export function searchIsOutsideWorkingDirectory(
  searchPath: string,
  cwd: string,
): boolean {
  const rel = relative(cwd, searchPath)
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
}

/**
 * densable E2t — PATH-only rg cannot apply Read deny rules outside cwd.
 */
export function assertRipgrepCanApplyReadDeny(
  searchPath: string,
  rgPath: string,
  cwd: string,
): void {
  if (isAbsolute(rgPath)) return
  if (!searchIsOutsideWorkingDirectory(searchPath, cwd)) return
  throw new SymlinkResolutionChangedError(
    refusingPathOnlyRipgrepMessage(searchPath),
  )
}

/**
 * densable `d` / `ao(e)` — hop membership against the permission snapshot.
 * Gold uses exact `o.has(O)` (approved is already the hop set from
 * `approvedPathSetFor` = `ao`).
 */
function assertApprovedHops(
  lexical: string,
  approved: ReadonlySet<string>,
): void {
  for (const hop of collectSymlinkHops(lexical)) {
    if (!approved.has(hop)) throw searchRefusal(lexical)
  }
}

/** densable `Jo` canonical resolve for recheck pin. */
function resolveCanonicalOrThrow(lexical: string): string {
  const { resolvedPath, isCanonical } = safeResolvePath(
    getFsImplementation(),
    lexical,
  )
  if (!isCanonical) throw searchRefusal(lexical)
  return resolvedPath
}

/** densable `_Y` — exists check (ENOENT/ENOTDIR → false). */
async function pathExistsForSearch(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch (err) {
    const code = getErrnoCode(err)
    if (code === 'ENOENT' || code === 'ENOTDIR') return false
    throw err
  }
}

/**
 * densable `N` — network / non-canonical short circuit: judge every result,
 * no held fd.
 */
async function openNetworkStyleSearchRoot(
  lexical: string,
  canonical: string,
  rgPath: string,
  approved: ReadonlySet<string>,
): Promise<SearchRoot | null> {
  const pathOnly = !isAbsolute(rgPath)
  const spawnCwd = ripgrepSpawnCwd(lexical, rgPath)
  if (pathOnly && searchIsOutsideWorkingDirectory(lexical, spawnCwd)) {
    throw new SymlinkResolutionChangedError(
      refusingPathOnlyRipgrepMessage(lexical),
    )
  }
  let isDirectory: boolean
  try {
    isDirectory = (await stat(lexical)).isDirectory()
  } catch (err) {
    const code = getErrnoCode(err)
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    throw err
  }
  const recheck = (): void => {
    assertApprovedHops(lexical, approved)
  }
  return {
    lexical,
    canonical,
    spawnCwd,
    target: lexical,
    relativeOutput: false,
    isDirectory,
    judgeEveryResult: true,
    recheckBeforeSpawn: recheck,
    recheckByPath: recheck,
    close: async () => {},
  }
}

/**
 * densable `E2t`. Returns null when the root is missing (ENOENT/ENOTDIR).
 */
export async function openSearchRoot(
  searchPath: string,
  approved: ReadonlySet<string>,
): Promise<SearchRoot | null> {
  const lexical = searchPath
  const rgPath = ripgrepCommand().rgPath
  const platform = getPlatform()

  // Initial approved-set walk (densable `d()`).
  assertApprovedHops(lexical, approved)

  // Network / NT short-circuit (densable `jn&&!Ds||yr` → `N()`).
  if (isNetworkOrNtSearchRoot(lexical)) {
    return openNetworkStyleSearchRoot(lexical, lexical, rgPath, approved)
  }

  // Windows branch — Jo + pin, no /proc/self/fd.
  if (platform === 'windows') {
    const resolved = safeResolvePath(getFsImplementation(), lexical)
    if (!resolved.isCanonical) {
      if (resolved.isSymlink) {
        // densable: o.has && jn && !Ds — UNC non-WSL only (not yr)
        if (
          approved.has(resolved.resolvedPath) &&
          isUncOrNtObjectPath(resolved.resolvedPath) &&
          !isWslUncPath(resolved.resolvedPath)
        ) {
          return openNetworkStyleSearchRoot(
            lexical,
            resolved.resolvedPath,
            rgPath,
            approved,
          )
        }
        throw searchRefusal(lexical)
      }
      if (!(await pathExistsForSearch(lexical))) return null
      throw searchRefusal(lexical)
    }
    const canonical = resolved.resolvedPath
    if (!approved.has(canonical)) throw searchRefusal(lexical)

    const recheck = (): void => {
      assertApprovedHops(lexical, approved)
      if (resolveCanonicalOrThrow(lexical) !== canonical) {
        throw searchRefusal(lexical)
      }
    }

    let isDirectory: boolean
    try {
      isDirectory = (await stat(canonical)).isDirectory()
    } catch (err) {
      const code = getErrnoCode(err)
      if (code === 'ENOENT' || code === 'ENOTDIR') return null
      if (code === 'EACCES' || code === 'EPERM') throw searchRefusal(lexical)
      throw err
    }

    const spawnCwd = ripgrepSpawnCwd(canonical, rgPath)
    if (
      isDirectory &&
      !isAbsolute(rgPath) &&
      searchIsOutsideWorkingDirectory(canonical, spawnCwd)
    ) {
      throw new SymlinkResolutionChangedError(
        refusingPathOnlyRipgrepMessage(lexical),
      )
    }

    return {
      lexical,
      canonical,
      spawnCwd,
      target: canonical,
      relativeOutput: false,
      isDirectory,
      recheckBeforeSpawn: recheck,
      recheckByPath: recheck,
      close: async () => {},
    }
  }

  // Non-Windows: open the path, then on linux/wsl prefer /proc/self/fd readlink.
  let handle: FileHandle
  try {
    handle = await open(
      lexical,
      constants.O_RDONLY | (constants.O_NONBLOCK ?? 0),
    )
  } catch (err) {
    const code = getErrnoCode(err)
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    if (code === 'EACCES' || code === 'EPERM' || code === 'ELOOP') {
      throw new SymlinkResolutionChangedError(
        `Refusing to search ${lexical}: it could not be opened (${code}) — it is unreadable, or is being replaced concurrently.`,
      )
    }
    throw err
  }

  try {
    const st = await handle.stat()
    let procReal: string | null = null
    if (platform === 'linux' || platform === 'wsl') {
      try {
        procReal = await readlink(`/proc/self/fd/${handle.fd}`)
      } catch {
        procReal = null
      }
    }
    const usedProc = procReal !== null
    const canonical = procReal ?? resolveCanonicalOrThrow(lexical)
    if (!approved.has(canonical)) throw searchRefusal(lexical)

    const recheckByPath = (): void => {
      assertApprovedHops(lexical, approved)
      if (resolveCanonicalOrThrow(lexical) !== canonical) {
        throw searchRefusal(lexical)
      }
    }
    // densable: recheckBeforeSpawn is no-op when spawn uses /proc/self/fd.
    const recheckBeforeSpawn = usedProc ? (): void => {} : recheckByPath

    if (st.isDirectory()) {
      try {
        await access(
          usedProc ? `/proc/self/fd/${handle.fd}` : canonical,
          constants.X_OK,
        )
      } catch {
        throw new SymlinkResolutionChangedError(
          `Cannot search ${lexical}: the directory is not traversable (no execute permission).`,
        )
      }
    }

    if (st.isDirectory() && isAbsolute(rgPath)) {
      const held = handle
      return {
        lexical,
        canonical,
        spawnCwd: usedProc ? `/proc/self/fd/${held.fd}` : canonical,
        target: '.',
        relativeOutput: true,
        isDirectory: true,
        recheckBeforeSpawn,
        recheckByPath,
        close: () => held.close(),
      }
    }

    if (st.isDirectory()) {
      const spawnCwd = ripgrepSpawnCwd(canonical, rgPath)
      if (searchIsOutsideWorkingDirectory(canonical, spawnCwd)) {
        throw new SymlinkResolutionChangedError(
          refusingPathOnlyRipgrepMessage(lexical),
        )
      }
      const held = handle
      return {
        lexical,
        canonical,
        spawnCwd,
        target: canonical,
        relativeOutput: false,
        isDirectory: true,
        recheckBeforeSpawn: recheckByPath,
        recheckByPath,
        close: () => held.close(),
      }
    }

    // File search root.
    const held = handle
    return {
      lexical,
      canonical,
      spawnCwd: ripgrepSpawnCwd(canonical, rgPath),
      target: usedProc ? `/proc/${process.pid}/fd/${held.fd}` : canonical,
      relativeOutput: false,
      isDirectory: false,
      recheckBeforeSpawn,
      recheckByPath,
      close: () => held.close(),
    }
  } catch (err) {
    await handle.close().catch(() => {})
    throw err
  }
}

/** densable `q0(t)` — lexical + canonical bases for oht. */
function searchRootBases(root: {
  lexical: string
  canonical: string
}): Set<string> {
  return new Set([root.lexical, root.canonical])
}

/**
 * densable `oht` — deny globs for both canonical and lexical search roots.
 * A deny that matches the directory itself becomes `['!**']`.
 */
export function compileReadDenyRgGlobs(
  toolPermissionContext: ToolPermissionContext,
  root: { lexical: string; canonical: string; isDirectory: boolean },
  opts?: { depthAgnostic?: boolean },
): string[] {
  const patternsByRoot = getFileReadIgnorePatterns(toolPermissionContext)
  const bases = searchRootBases(root)

  if (root.isDirectory) {
    for (const candidate of new Set([...bases, root.canonical, root.lexical])) {
      for (const [patternRoot, patterns] of patternsByRoot) {
        if (patterns.length === 0) continue
        const from = patternRoot ?? getCwd()
        const rel = relative(from, candidate)
        if (
          rel === '' ||
          rel === '..' ||
          rel.startsWith(`..${sep}`) ||
          isAbsolute(rel)
        ) {
          continue
        }
        const posixRel = rel.replaceAll('\\', '/')
        const ig = ignore().add(patterns)
        if (ig.ignores(posixRel) || ig.ignores(`${posixRel}/`)) {
          return ['!**']
        }
      }
    }
  }

  const seen = new Set<string>()
  const out: string[] = []
  for (const base of bases) {
    for (const pattern of normalizePatternsToPath(patternsByRoot, base)) {
      // densable oht: skip bracket-character class patterns.
      if (pattern.includes('[')) continue
      const normalized = pattern
      if (normalized === '/' || normalized === '') {
        if (!seen.has('!**')) {
          seen.add('!**')
          out.push('!**')
        }
        continue
      }
      const glob = normalized.startsWith('/')
        ? opts?.depthAgnostic
          ? `!**${normalized}`
          : `!${normalized}`
        : `!**/${normalized}`
      if (!seen.has(glob)) {
        seen.add(glob)
        out.push(glob)
      }
      if (glob.endsWith('/**') && glob.length > 4) {
        const trimmed = glob.slice(0, -3)
        if (trimmed !== '!**' && !seen.has(trimmed)) {
          seen.add(trimmed)
          out.push(trimmed)
        }
      }
    }
  }
  return out
}
