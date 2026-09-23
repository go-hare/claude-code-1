/**
 * densable 2.1.251 #10 — Grep/Glob search root `E2t` and deny compiler `oht`.
 *
 * Opens the search root, refuses when symlink resolution left the approved
 * set, and on Linux/WSL walks the directory through /proc/self/fd. Read deny
 * rules are compiled against both the lexical and canonical roots.
 */

import { constants } from 'fs'
import { lstat, open, realpath, type FileHandle } from 'fs/promises'
import ignore from 'ignore'
import { isAbsolute, relative, resolve, sep } from 'path'
import { getCwd } from './cwd.js'
import { isENOENT } from './errors.js'
import {
  pathAncestors,
  pathIsApproved,
  refusingPathOnlyRipgrepMessage,
  refusingSearchAfterPermissionMessage,
  SymlinkResolutionChangedError,
} from './fileToolApprovedOpen.js'
import {
  getFileReadIgnorePatterns,
  normalizePatternsToPath,
} from './permissions/filesystem.js'
import { getPlatform } from './platform.js'
import { ripgrepCommand } from './ripgrep.js'
import type { ToolPermissionContext } from '../Tool.js'

export type SearchRoot = {
  lexical: string
  canonical: string
  spawnCwd: string
  target: string
  relativeOutput: boolean
  isDirectory: boolean
  recheckBeforeSpawn: () => Promise<void>
  close: () => Promise<void>
}

function searchRefusal(filePath: string): SymlinkResolutionChangedError {
  return new SymlinkResolutionChangedError(
    refusingSearchAfterPermissionMessage(filePath),
  )
}

function errnoCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

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

async function assertSearchResolution(
  lexical: string,
  approved: ReadonlySet<string>,
): Promise<string> {
  for (const ancestor of pathAncestors(lexical)) {
    if (!pathIsApproved(approved, ancestor)) throw searchRefusal(lexical)
  }
  let canonical = lexical
  try {
    const st = await lstat(lexical)
    if (st.isSymbolicLink()) {
      canonical = await realpath(lexical)
    } else {
      try {
        canonical = await realpath(lexical)
      } catch (err) {
        if (!(isENOENT(err) || errnoCode(err) === 'ENOENT')) throw err
      }
    }
  } catch (err) {
    if (err instanceof SymlinkResolutionChangedError) throw err
    if (isENOENT(err) || errnoCode(err) === 'ENOENT') throw err
    throw err
  }
  if (!pathIsApproved(approved, canonical)) throw searchRefusal(lexical)
  for (const ancestor of pathAncestors(canonical)) {
    if (!pathIsApproved(approved, ancestor)) throw searchRefusal(lexical)
  }
  return canonical
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
  const cwd = getCwd()
  assertRipgrepCanApplyReadDeny(lexical, rgPath, cwd)

  let canonical: string
  try {
    canonical = await assertSearchResolution(lexical, approved)
  } catch (err) {
    if (isENOENT(err) || errnoCode(err) === 'ENOENT') return null
    throw err
  }

  let isDirectory = false
  try {
    isDirectory = (await lstat(canonical)).isDirectory()
  } catch (err) {
    if (isENOENT(err) || errnoCode(err) === 'ENOTDIR') return null
    throw err
  }

  const platform = getPlatform()
  const useProc =
    isDirectory &&
    isAbsolute(rgPath) &&
    (platform === 'linux' || platform === 'wsl')

  let dirHandle: FileHandle | null = null
  if (useProc) {
    try {
      dirHandle = await open(
        canonical,
        constants.O_RDONLY | (constants.O_DIRECTORY ?? 0),
      )
    } catch (err) {
      const code = errnoCode(err)
      if (code === 'ENOENT' || code === 'ENOTDIR') return null
      if (code === 'EACCES' || code === 'EPERM' || code === 'ELOOP') {
        throw new SymlinkResolutionChangedError(
          `Refusing to search ${lexical}: it could not be opened (${code}) — it is unreadable, or is being replaced concurrently.`,
        )
      }
      throw err
    }
    try {
      const procTarget = await realpath(`/proc/self/fd/${dirHandle.fd}`)
      if (!pathIsApproved(approved, procTarget)) {
        throw searchRefusal(lexical)
      }
    } catch (err) {
      await dirHandle.close().catch(() => {})
      if (err instanceof SymlinkResolutionChangedError) throw err
      // /proc unavailable — fall through to the canonical directory
      dirHandle = null
    }
  }

  const procFd = dirHandle ? `/proc/self/fd/${dirHandle.fd}` : null
  const recheckBeforeSpawn = async (): Promise<void> => {
    const again = await assertSearchResolution(lexical, approved)
    if (again !== canonical) throw searchRefusal(lexical)
  }

  return {
    lexical,
    canonical,
    spawnCwd: procFd ?? canonical,
    target: procFd ? '.' : canonical,
    relativeOutput: procFd !== null,
    isDirectory,
    recheckBeforeSpawn,
    close: async () => {
      await dirHandle?.close()
    },
  }
}

function rootMatchesDeny(
  patternsByRoot: Map<string | null, string[]>,
  candidate: string,
): boolean {
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
    if (ig.ignores(posixRel) || ig.ignores(`${posixRel}/`)) return true
  }
  return false
}

function toRgDenyGlob(pattern: string): string[] {
  if (pattern === '/' || pattern === '') return ['!**']
  const glob = pattern.startsWith('/') ? `!${pattern}` : `!**/${pattern}`
  const out = [glob]
  if (glob.endsWith('/**') && glob.length > 4) {
    const trimmed = glob.slice(0, -3)
    if (trimmed !== '!**') out.push(trimmed)
  }
  return out
}

/**
 * densable `oht` — deny globs for both canonical and lexical search roots.
 * A deny that matches the directory itself becomes `['!**']`.
 */
export function compileReadDenyRgGlobs(
  toolPermissionContext: ToolPermissionContext,
  root: { lexical: string; canonical: string; isDirectory: boolean },
): string[] {
  const patternsByRoot = getFileReadIgnorePatterns(toolPermissionContext)
  if (root.isDirectory) {
    const bases = new Set([
      root.lexical,
      root.canonical,
      resolve(root.canonical),
    ])
    for (const base of bases) {
      if (rootMatchesDeny(patternsByRoot, base)) return ['!**']
    }
  }

  const merged = new Set<string>()
  for (const base of new Set([root.lexical, root.canonical])) {
    for (const pattern of normalizePatternsToPath(patternsByRoot, base)) {
      for (const glob of toRgDenyGlob(pattern)) merged.add(glob)
    }
  }
  return [...merged]
}
