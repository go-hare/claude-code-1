import { join, relative } from 'path'
import { logForDebugging } from '../debug.js'
import { isENOENT } from '../errors.js'
import { getFsImplementation, isDuplicatePath } from '../fsOperations.js'

const SKILL_MD_RE = /^skill\.md$/i
const MAX_PLUGIN_SCAN_DEPTH = 32
const MAX_PLUGIN_SCAN_DIRS = 4096

type CanonicalDirResolution = {
  resolvedPath: string
  isCanonical: boolean
}

function normalizePathForDedup(filePath: string): string {
  return process.platform === 'win32' ? filePath.toLowerCase() : filePath
}

function resolveCanonicalDir(
  fs: ReturnType<typeof getFsImplementation>,
  dir: string,
): CanonicalDirResolution {
  try {
    const resolvedPath = fs.realpathSync(dir)
    return { resolvedPath, isCanonical: true }
  } catch {
    return { resolvedPath: dir, isCanonical: false }
  }
}

function isDuplicateMarkdownPath(
  fs: ReturnType<typeof getFsImplementation>,
  dirState: { dir: string; resolution?: CanonicalDirResolution },
  fullPath: string,
  loadedPaths: Set<string>,
): boolean {
  dirState.resolution ??= resolveCanonicalDir(fs, dirState.dir)
  if (!dirState.resolution.isCanonical) {
    return isDuplicatePath(fs, fullPath, loadedPaths)
  }
  const canonical = normalizePathForDedup(
    join(dirState.resolution.resolvedPath, relative(dirState.dir, fullPath)),
  )
  if (loadedPaths.has(canonical)) {
    return true
  }
  loadedPaths.add(canonical)
  return false
}

/**
 * Recursively walk a plugin directory, invoking onFile for each .md file.
 *
 * The namespace array tracks the subdirectory path relative to the root
 * (e.g., ['foo', 'bar'] for root/foo/bar/file.md). Callers that don't need
 * namespacing can ignore the second argument.
 *
 * When stopAtSkillDir is true and a directory contains SKILL.md, onFile is
 * called for all .md files in that directory but subdirectories are not
 * scanned — skill directories are leaf containers.
 *
 * When `loadedPaths` is provided, `rootDir` is canonicalized once and each
 * discovered `.md` file is deduplicated in memory without per-file `realpath`
 * syscalls (upstream v2.1.302 `o5` / `Fur`).
 *
 * Readdir errors are swallowed with a debug log so one bad directory doesn't
 * abort a plugin load.
 */
export async function walkPluginMarkdown(
  rootDir: string,
  onFile: (fullPath: string, namespace: string[]) => Promise<void>,
  opts: {
    stopAtSkillDir?: boolean
    logLabel?: string
    /** densable dB — missing root is OK; nested scan errors still log. */
    isRootOptional?: boolean
    /** Upstream `o5` / `Fur`: deduplicate discovered files with 1 realpath per rootDir. */
    loadedPaths?: Set<string>
  } = {},
): Promise<void> {
  const fs = getFsImplementation()
  const label = opts.logLabel ?? 'plugin'
  let dirCount = 0
  let dirLimitLogged = false
  const dirState: { dir: string; resolution?: CanonicalDirResolution } = {
    dir: rootDir,
  }

  function emitFile(
    fullPath: string,
    namespace: string[],
  ): Promise<void> | undefined {
    if (
      opts.loadedPaths !== undefined &&
      isDuplicateMarkdownPath(fs, dirState, fullPath, opts.loadedPaths)
    ) {
      return undefined
    }
    return onFile(fullPath, namespace)
  }

  async function scan(dirPath: string, namespace: string[]): Promise<void> {
    if (namespace.length >= MAX_PLUGIN_SCAN_DEPTH) {
      logForDebugging(
        `Skipping ${label} directory beyond depth ${MAX_PLUGIN_SCAN_DEPTH}: ${dirPath}`,
        { level: 'error' },
      )
      return
    }
    if (++dirCount > MAX_PLUGIN_SCAN_DIRS) {
      if (!dirLimitLogged) {
        dirLimitLogged = true
        logForDebugging(
          `Stopping ${label} scan after ${MAX_PLUGIN_SCAN_DIRS} directories (root=${rootDir})`,
          { level: 'error' },
        )
      }
      return
    }

    try {
      const entries = await fs.readdir(dirPath)

      if (
        opts.stopAtSkillDir &&
        entries.some(e => e.isFile() && SKILL_MD_RE.test(e.name))
      ) {
        // Skill directory: collect .md files here, don't recurse.
        await Promise.all(
          entries.map(entry =>
            entry.isFile() && entry.name.toLowerCase().endsWith('.md')
              ? emitFile(join(dirPath, entry.name), namespace)
              : undefined,
          ),
        )
        return
      }

      await Promise.all(
        entries.map(entry => {
          const fullPath = join(dirPath, entry.name)
          if (entry.isSymbolicLink()) {
            return undefined
          }
          if (entry.isDirectory()) {
            return scan(fullPath, [...namespace, entry.name])
          }
          if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
            return emitFile(fullPath, namespace)
          }
          return undefined
        }),
      )
    } catch (error) {
      // densable dB: isRootOptional && M===e && W(K) (ENOENT)
      if (opts.isRootOptional && dirPath === rootDir && isENOENT(error)) {
        return
      }
      logForDebugging(
        `Failed to scan ${label} directory ${dirPath}: ${error}`,
        { level: 'error' },
      )
    }
  }

  await scan(rootDir, [])
}
