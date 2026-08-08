/**
 * densable 2.1.219 register_repo_root (He / lxm / axm / sxm) — pure helpers
 * for the SDK control_request. Scope: strict subdirectory of session cwd, or
 * of a launch-time --add-dir / additionalDirectories root (source === 'cliArg').
 */
import { realpath, stat } from 'fs/promises'
import type { ToolPermissionContext } from '../../Tool.js'
import type { AdditionalWorkingDirectory } from '../../types/permissions.js'
import { pathInWorkingPath } from '../../utils/permissions/filesystem.js'

export type RegisterRepoRootAllowed = { allowed: true }
export type RegisterRepoRootDenied = { allowed: false; reason: string }
export type RegisterRepoRootGate =
  | RegisterRepoRootAllowed
  | RegisterRepoRootDenied

/** densable lxm — target must exist and be a directory. */
export async function isRegisterRepoRootDirectory(
  absolutePath: string,
): Promise<RegisterRepoRootGate> {
  try {
    const stats = await stat(absolutePath)
    if (!stats.isDirectory()) {
      return { allowed: false, reason: 'is not a directory' }
    }
    return { allowed: true }
  } catch {
    return { allowed: false, reason: 'is not a directory' }
  }
}

/** densable axm — realpath each additional working directory entry. */
export async function resolveAdditionalWorkingDirectories(
  directories:
    | ReadonlyMap<string, AdditionalWorkingDirectory>
    | Map<string, AdditionalWorkingDirectory>,
): Promise<
  Array<{ source: AdditionalWorkingDirectory['source']; resolved: string }>
> {
  return Promise.all(
    [...directories.values()].map(async entry => ({
      source: entry.source,
      resolved: await realpath(entry.path).catch(() => entry.path),
    })),
  )
}

/**
 * densable sxm(e, t, r, n):
 *   e = candidate realpath
 *   t = session cwd realpath
 *   r = launch-time --add-dir roots (cliArg) realpaths
 *   n = all registered additional dir realpaths
 *
 * Allowed only as a *strict* subdirectory of cwd or of a cliArg root
 * (pathInWorkingPath with equality excluded). Already-registered denied.
 */
export function isWithinRegisterRepoRootScope(
  candidate: string,
  cwdRealpath: string,
  launchAddDirRoots: string[],
  allRegisteredRoots: string[],
): RegisterRepoRootGate {
  if (candidate === cwdRealpath) {
    return {
      allowed: false,
      reason:
        "is the current working directory, which is already registered; pass the cloned repo's own directory instead",
    }
  }
  if (allRegisteredRoots.includes(candidate)) {
    return {
      allowed: false,
      reason: 'is already a registered working directory',
    }
  }
  // densable p1 with caseFold:false — pathInWorkingPath uses case-fold on
  // macOS/Windows via normalizeCaseForComparison; equality already excluded.
  const underCwd =
    pathInWorkingPath(candidate, cwdRealpath) && candidate !== cwdRealpath
  const underLaunchRoot = launchAddDirRoots.some(
    root => candidate !== root && pathInWorkingPath(candidate, root),
  )
  if (!underCwd && !underLaunchRoot) {
    return {
      allowed: false,
      reason: 'is not a subdirectory of cwd or of a launch-time --add-dir root',
    }
  }
  return { allowed: true }
}

export type HandleRegisterRepoRootRequest = {
  directory: string
  reload_claude_md?: boolean
  reload_plugins?: boolean
  reload_skills?: boolean
}

export type HandleRegisterRepoRootDeps = {
  getCwd: () => string
  getToolPermissionContext: () => ToolPermissionContext
  applyAddDirectory: (canonicalPath: string) => void
  getBootstrapAdditionalDirs: () => string[]
  setBootstrapAdditionalDirs: (dirs: string[]) => void
  refreshSandbox: () => void
  clearMemoryFileCaches: () => void
  clearCommandsCache: () => void
  reloadPlugins?: () => Promise<void>
  logDebug: (msg: string, opts?: { level?: 'error' | 'warn' | 'info' }) => void
  /**
   * densable bs() — start a keep_alive interval while DirectoryAdded hooks run;
   * returns a disposer. Optional (no-op when omitted).
   */
  startKeepAlive?: () => () => void
  executeDirectoryAddedHooks: (
    directory: string,
    source: 'register_repo_root',
  ) => Promise<{
    results: Array<{
      succeeded?: boolean
      output?: string
      systemMessage?: string | null
    }>
    systemMessages: string[]
  }>
}

export type HandleRegisterRepoRootResult =
  | { ok: true; directory: string }
  | { ok: false; error: string }

/**
 * densable He(ur, sn) body — pure of transport; returns success payload or
 * densable wire-safe error strings.
 */
export async function handleRegisterRepoRoot(
  req: HandleRegisterRepoRootRequest,
  deps: HandleRegisterRepoRootDeps,
): Promise<HandleRegisterRepoRootResult> {
  const cwdRealpath = await realpath(deps.getCwd())
  const requestedRealpath = await realpath(req.directory).catch(async () => {
    // densable realpath fails → still try isDirectory gate on expanded path
    return req.directory
  })

  const isDir = await isRegisterRepoRootDirectory(requestedRealpath)
  if (!isDir.allowed) {
    return { ok: false, error: 'register_repo_root: target is not a directory' }
  }

  const resolved = await resolveAdditionalWorkingDirectories(
    deps.getToolPermissionContext().additionalWorkingDirectories,
  )
  const launchRoots = resolved
    .filter(e => e.source === 'cliArg')
    .map(e => e.resolved)
  const allRoots = resolved.map(e => e.resolved)

  const scope = isWithinRegisterRepoRootScope(
    requestedRealpath,
    cwdRealpath,
    launchRoots,
    allRoots,
  )
  if (!scope.allowed) {
    // densable: outside scope uses fixed wire message (not the detailed reason).
    // Already-registered inside sxm also uses fixed message via separate throw —
    // but densable checks Map.has after sxm for the exact key path.
    if (scope.reason === 'is already a registered working directory') {
      return {
        ok: false,
        error:
          'register_repo_root: directory is already a registered working directory',
      }
    }
    return {
      ok: false,
      error:
        'register_repo_root: directory is outside the allowed registration scope',
    }
  }

  // densable: a().toolPermissionContext.additionalWorkingDirectories.has(oo)
  // Map key is the realpath string used at registration time.
  if (
    deps
      .getToolPermissionContext()
      .additionalWorkingDirectories.has(requestedRealpath)
  ) {
    return {
      ok: false,
      error:
        'register_repo_root: directory is already a registered working directory',
    }
  }

  deps.applyAddDirectory(requestedRealpath)

  const bootstrapDirs = deps.getBootstrapAdditionalDirs()
  if (!bootstrapDirs.includes(requestedRealpath)) {
    deps.setBootstrapAdditionalDirs([...bootstrapDirs, requestedRealpath])
  }
  deps.refreshSandbox()

  const stopKeepAlive = deps.startKeepAlive?.()
  void deps
    .executeDirectoryAddedHooks(requestedRealpath, 'register_repo_root')
    .then(({ results, systemMessages }) => {
      for (const sm of systemMessages) {
        deps.logDebug(`DirectoryAdded hook: ${sm}`)
      }
      for (const r of results) {
        if (r.succeeded === false && r.output) {
          deps.logDebug(`DirectoryAdded hook failed: ${r.output}`, {
            level: 'error',
          })
        }
      }
    })
    .catch(err => {
      deps.logDebug(`DirectoryAdded hook exec failed: ${err}`, {
        level: 'error',
      })
    })
    .finally(() => {
      stopKeepAlive?.()
    })

  if (req.reload_claude_md) {
    deps.clearMemoryFileCaches()
  }
  if (req.reload_skills) {
    deps.clearCommandsCache()
  }
  if (req.reload_plugins && deps.reloadPlugins) {
    await deps.reloadPlugins()
  }

  return { ok: true, directory: requestedRealpath }
}
