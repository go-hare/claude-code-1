import { execFileSync, spawn, type ChildProcess } from 'child_process'
import { constants as fsConstants, readFileSync } from 'fs'
import { type FileHandle, mkdir, open, realpath, stat } from 'fs/promises'
import memoize from 'lodash-es/memoize.js'
import { tmpdir } from 'os'
import {
  delimiter as pathDelimiter,
  isAbsolute,
  join as nativeJoin,
  resolve,
  sep as pathSep,
} from 'path'
import { join as posixJoin } from 'path/posix'
import { logEvent } from 'src/services/analytics/index.js'
import {
  getOriginalCwd,
  getSessionId,
  setCwdState,
} from '../bootstrap/state.js'
import { generateTaskId } from '../Task.js'
import {
  appendPluginBinPathsToPath,
  CLEAR_UNSETENV_COMMAND,
  CLEAR_WHICH_COMMAND,
  getCapturedShellExports,
  STRIPPED_EXPORTED_FUNC_ENV_KEYS,
} from './bash/ShellSnapshot.js'
import { buildMacOsGitGrepCLocaleWrapper } from './bash/gitGrepLocale.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import {
  checkAgentWorktreeCwdEscape,
  checkAgentWorktreeGoneRecovery,
  resolveIsolationRoot,
} from './bgIsolationContainment.js'
import { getCwdOverride, pwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { errorMessage, getErrnoCode, isENOENT } from './errors.js'
import { getFsImplementation } from './fsOperations.js'
import { logError } from './log.js'
import {
  createAbortedCommand,
  createFailedCommand,
  type ShellCommand,
  wrapSpawn,
} from './ShellCommand.js'
import { getTaskOutputDir } from './task/diskOutput.js'
import { TaskOutput } from './task/TaskOutput.js'
import { which } from './which.js'
import { checkZRuGitRedirectCommand } from './worktreeGitIsolation.js'

export type { ExecResult } from './ShellCommand.js'

import { accessSync } from 'fs'
import { onCwdChangedForHooks } from './hooks/fileChangedWatcher.js'
import { getClaudeTempDirName } from './permissions/filesystem.js'
import { getPlatform } from './platform.js'
import {
  hasPathDotSegment,
  isNetworkUncPath,
  isNtObjectNamespacePath,
} from './path.js'
import { stripDaemonForceColorFromEnv } from './envUtils.js'
import { SandboxManager } from './sandbox/sandbox-adapter.js'
import {
  getSessionEnvironmentVariables,
  invalidateSessionEnvCache,
} from './sessionEnvironment.js'
import { createBashShellProvider } from './shell/bashProvider.js'
import { getCachedPowerShellPath } from './shell/powershellDetection.js'
import { createPowerShellProvider } from './shell/powershellProvider.js'
import type { ShellProvider, ShellType } from './shell/shellProvider.js'
import {
  attachPidToToolMemoryCgroup,
  resolveToolMemoryCgroupForSpawn,
} from './shell/toolMemoryCgroup.js'
import { subprocessEnv } from './subprocessEnv.js'
import { posixPathToWindowsPath } from './windowsPaths.js'

const DEFAULT_TIMEOUT = 30 * 60 * 1000 // 30 minutes

/**
 * densable `fe>0` user copy after deleted-cwd recovery to homedir (or a
 * later candidate). `fe===0` (original cwd) continues without this message.
 */
/**
 * Official 2.1.323 `Nls` (#2024): harden bash/zsh shell options so non-default
 * zsh options (`EXTENDED_GLOB`, `BARE_GLOB_QUAL`, `BRACE_CCL`,
 * `MAGIC_EQUAL_SUBST`, `EQUALS`) cannot alter command parsing relative to how
 * permission checks evaluated the command.
 */
export function getShellOptionHardeningCommand(
  shellPath: string,
): string | null {
  if (process.env.CLAUDE_CODE_SHELL_PREFIX) {
    return '{ \\builtin shopt -u extglob || \\builtin setopt NO_EXTENDED_GLOB NO_BARE_GLOB_QUAL NO_BRACE_CCL NO_MAGIC_EQUAL_SUBST NO_EQUALS; } >/dev/null 2>&1 || true'
  }
  if (shellPath.includes('bash')) {
    return '\\builtin shopt -u extglob 2>/dev/null || true'
  }
  if (shellPath.includes('zsh')) {
    return '\\builtin setopt NO_EXTENDED_GLOB NO_BARE_GLOB_QUAL NO_BRACE_CCL NO_MAGIC_EQUAL_SUBST NO_EQUALS 2>/dev/null || true'
  }
  return null
}

/**
 * Official 2.1.323 #2137 (`Gdi`/`f`): check whether a working directory is
 * genuinely gone (ENOENT/ENOTDIR) vs a drive/filesystem where `realpath`
 * cannot resolve the path (e.g. Windows Dokan/ImDisk/subst/WinFsp returning
 * EINVAL/UNKNOWN/EUNKNOWN/EISDIR/ENOSYS/EPERM/EACCES while `stat` succeeds).
 */
export async function verifyWorkingDirectoryExists(
  dir: string,
  deps?: {
    realpathFn?: (p: string) => Promise<string>
    statFn?: (p: string) => Promise<{ isDirectory: () => boolean }>
  },
): Promise<{ exists: boolean; resolved: string }> {
  const realpathImpl = deps?.realpathFn ?? (p => realpath(p))
  const statImpl = deps?.statFn ?? (p => stat(p))
  try {
    const resolved = await realpathImpl(dir)
    return { exists: true, resolved }
  } catch (err) {
    const code = getErrnoCode(err)
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { exists: false, resolved: dir }
    }
    // Non-deletion realpath failure (common on Windows virtual/subst drives):
    // confirm via stat() that the directory exists and proceed without failing.
    try {
      const s = await statImpl(dir)
      if (s.isDirectory()) {
        return { exists: true, resolved: dir }
      }
      return { exists: false, resolved: dir }
    } catch (statErr) {
      const statCode = getErrnoCode(statErr)
      if (statCode === 'ENOENT' || statCode === 'ENOTDIR') {
        return { exists: false, resolved: dir }
      }
      // On Windows, if even stat returns a non-ENOENT driver error (e.g.
      // EPERM/EACCES/UNKNOWN/EINVAL), do not falsely claim it was deleted.
      if (getPlatform() === 'windows') {
        return { exists: true, resolved: dir }
      }
      return { exists: false, resolved: dir }
    }
  }
}

export function shellCwdRecoveredReissueMessage(
  goneCwd: string,
  recovered: string,
): string {
  return `Working directory "${goneCwd}" was deleted; shell cwd recovered to "${recovered}". Re-issue your command (it will run from the recovered directory).`
}

/**
 * densable `$0f` — async unlink of `/tmp/claude-*-cwd`. ENOENT is silent;
 * anything else warns. Call immediately if the child already exited, else
 * `once('exit')` so kill/timeout/interrupt still clean up.
 */
async function unlinkCwdTrackingFile(path: string): Promise<void> {
  try {
    await getFsImplementation().unlink(path)
  } catch (e) {
    if (!isENOENT(e)) {
      logForDebugging(
        `Failed to remove shell cwd-tracking file: ${errorMessage(e)}`,
        { level: 'warn' },
      )
    }
  }
}

/** densable `$0f` gate: defer unlink until the child actually exits. */
export function shouldDeferCwdTrackingUnlink(child: {
  pid?: number
  exitCode: number | null
  signalCode: NodeJS.Signals | null
}): boolean {
  return (
    child.pid !== undefined &&
    child.exitCode === null &&
    child.signalCode === null
  )
}

export type ShellConfig = {
  provider: ShellProvider
}

function isExecutable(shellPath: string): boolean {
  try {
    accessSync(shellPath, fsConstants.X_OK)
    return true
  } catch (_err) {
    // Fallback for Nix and other environments where X_OK check might fail
    try {
      // Try to execute the shell with --version, which should exit quickly
      // Use execFileSync to avoid shell injection vulnerabilities
      execFileSync(shellPath, ['--version'], {
        timeout: 1000,
        stdio: 'ignore',
        // LOCAL: bash --version is a CUI child; without windowsHide each
        // isExecutable probe can flash a console on Windows (official
        // densable also omits this flag here).
        windowsHide: true,
      })
      return true
    } catch {
      return false
    }
  }
}

/**
 * Determines the best available shell to use.
 */
export async function findSuitableShell(): Promise<string> {
  // Check for explicit shell override first
  const shellOverride = process.env.CLAUDE_CODE_SHELL
  if (shellOverride) {
    // Validate it's a supported shell type
    const isSupported =
      shellOverride.includes('bash') || shellOverride.includes('zsh')
    if (isSupported && isExecutable(shellOverride)) {
      logForDebugging(`Using shell override: ${shellOverride}`)
      return shellOverride
    } else {
      // Note, if we ever want to add support for new shells here we'll need to update or Bash tool parsing to account for this
      logForDebugging(
        `CLAUDE_CODE_SHELL="${shellOverride}" is not a valid bash/zsh path, falling back to detection`,
      )
    }
  }

  // Check user's preferred shell from environment
  const env_shell = process.env.SHELL
  // Only consider SHELL if it's bash or zsh
  const isEnvShellSupported =
    env_shell && (env_shell.includes('bash') || env_shell.includes('zsh'))
  const preferBash = env_shell?.includes('bash')

  // Try to locate shells using which (uses Bun.which when available)
  const [zshPath, bashPath] = await Promise.all([which('zsh'), which('bash')])

  // Populate shell paths from which results and fallback locations
  const shellPaths = ['/bin', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin']

  // Order shells based on user preference
  const shellOrder = preferBash ? ['bash', 'zsh'] : ['zsh', 'bash']
  const supportedShells = shellOrder.flatMap(shell =>
    shellPaths.map(path => `${path}/${shell}`),
  )

  // Add discovered paths to the beginning of our search list
  // Put the user's preferred shell type first
  if (preferBash) {
    if (bashPath) supportedShells.unshift(bashPath)
    if (zshPath) supportedShells.push(zshPath)
  } else {
    if (zshPath) supportedShells.unshift(zshPath)
    if (bashPath) supportedShells.push(bashPath)
  }

  // Always prioritize SHELL env variable if it's a supported shell type
  if (isEnvShellSupported && isExecutable(env_shell)) {
    supportedShells.unshift(env_shell)
  }

  const shellPath = supportedShells.find(shell => shell && isExecutable(shell))

  // If no valid shell found, throw a helpful error
  if (!shellPath) {
    const errorMsg =
      'No suitable shell found. Claude CLI requires a Posix shell environment. ' +
      'Please ensure you have a valid shell installed and the SHELL environment variable set.'
    logError(new Error(errorMsg))
    throw new Error(errorMsg)
  }

  return shellPath
}

const PLUGIN_BIN_STAT_TIMEOUT_MS = 2000

/**
 * densable `kAs` / `r5n` (#904): collect `bin/` directories of enabled
 * non-builtin plugins, drop paths with shell metacharacters on POSIX, and
 * verify each directory via stat (keeping on non-ENOENT/ENOTDIR failures).
 */
export async function resolvePluginBinPaths(): Promise<string[]> {
  try {
    const { loadAllPluginsCacheOnly } = await import(
      './plugins/pluginLoader.js'
    )
    const { enabled } = await loadAllPluginsCacheOnly()
    const candidates = enabled
      .filter(p => !p.isBuiltin && p.path)
      .map(p => nativeJoin(p.path, 'bin'))
      .filter(p => {
        if (pathSep !== '\\' && /[:"'$`\\\n\r]/.test(p)) {
          logForDebugging(
            `Dropping plugin bin path with shell metacharacters: ${p}`,
          )
          return false
        }
        return true
      })
    const results = await Promise.all(
      candidates.map(async p => {
        try {
          const stats = await Promise.race([
            stat(p),
            new Promise<never>((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error(
                      `stat timed out after ${PLUGIN_BIN_STAT_TIMEOUT_MS}ms`,
                    ),
                  ),
                PLUGIN_BIN_STAT_TIMEOUT_MS,
              ),
            ),
          ])
          return stats.isDirectory()
        } catch (err) {
          const code = getErrnoCode(err)
          if (code === 'ENOENT' || code === 'ENOTDIR') return false
          logForDebugging(
            `Keeping plugin bin path on PATH despite a failed stat (${code ?? errorMessage(err)}): ${p}`,
          )
          return true
        }
      }),
    )
    return candidates.filter((_, idx) => results[idx])
  } catch (err) {
    logForDebugging(
      `Shell: leaving plugin bin/ dirs off PATH: ${errorMessage(err)}`,
      { level: 'warn' },
    )
    logError(err)
    return []
  }
}

export const getPowerShellPluginBinPaths = memoize(resolvePluginBinPaths)

/**
 * densable `J6n` (#981): return captured shell startup exports only for
 * unsandboxed bash commands.
 */
export function resolveCapturedShellExportsForSpawn(
  shellType: ShellType,
  shouldUseSandbox: boolean,
): Record<string, string> | undefined {
  return shellType === 'bash' && !shouldUseSandbox
    ? getCapturedShellExports()
    : undefined
}

/**
 * densable `dSo` (#904, #981): assemble subprocess env from defaults
 * (captured shell exports), subprocessEnv, overrides, and plugin bin/ PATH.
 */
export function buildShellSpawnEnv({
  shellType,
  binShell,
  envOverrides,
  spawnEnvPluginBinPaths = [],
  envDefaults,
  shouldUseSandbox = false,
}: {
  shellType: ShellType
  binShell: string
  envOverrides: Record<string, string | undefined>
  spawnEnvPluginBinPaths?: readonly string[]
  envDefaults?: Record<string, string>
  shouldUseSandbox?: boolean
}): Record<string, string | undefined> {
  const baseSubprocessEnv: Record<string, string | undefined> = {
    ...(envDefaults ?? {}),
    ...subprocessEnv(),
  }
  // #383 SEA: Strip daemon-injected FORCE_COLOR=3 before merging overrides
  stripDaemonForceColorFromEnv(baseSubprocessEnv)
  // #1482: Strip SHELLOPTS so parent shell options (e.g. errexit/pipefail)
  // do not leak into spawned child shells.
  delete baseSubprocessEnv.SHELLOPTS
  // #1118 SEA: Prevent outer sandboxed shell from sourcing BASH_ENV / ENV
  // outside the sandbox before executing the sandboxed command.
  if (shouldUseSandbox) {
    delete baseSubprocessEnv.BASH_ENV
    delete baseSubprocessEnv.ENV
  }
  const env: Record<string, string | undefined> = {
    ...baseSubprocessEnv,
    SHELL: shellType === 'bash' ? binShell : undefined,
    GIT_EDITOR: 'true',
    // LOCAL (not official densable): skip interactive pager (less) so short
    // git log/diff/show don't open a pager process.
    GIT_PAGER: 'cat',
    CLAUDECODE: '1',
    // densable TCt: always stamp session id + child marker + CLAUDE_PID
    // so snapshot pkill self-guard (K2g) can refuse patterns matching us.
    CLAUDE_CODE_SESSION_ID: getSessionId(),
    CLAUDE_CODE_CHILD_SESSION: '1',
    CLAUDE_PID: String(process.pid),
    ...envOverrides,
  }
  // #1440 (official T6n / x6n): strip exported which/unsetenv functions when tengu_swirling_koala is on
  if (getFeatureValue_CACHED_MAY_BE_STALE('tengu_swirling_koala', true)) {
    for (const key of STRIPPED_EXPORTED_FUNC_ENV_KEYS) {
      delete env[key]
    }
  }
  if (spawnEnvPluginBinPaths.length > 0) {
    const pathKey =
      Object.keys(env).find(k => k.toUpperCase() === 'PATH') ?? 'PATH'
    const { appended, path } = appendPluginBinPathsToPath(
      env[pathKey],
      spawnEnvPluginBinPaths,
      pathDelimiter,
    )
    if (appended.length > 0) {
      env[pathKey] = path
    }
  }
  return env
}

async function getShellConfigImpl(): Promise<ShellConfig> {
  const [binShell, pluginBinPaths] = await Promise.all([
    findSuitableShell(),
    resolvePluginBinPaths(),
  ])
  const provider = await createBashShellProvider(binShell, { pluginBinPaths })
  return { provider }
}

// Memoize the entire shell config so it only happens once per session
export const getShellConfig = memoize(getShellConfigImpl)

/**
 * Official 2.1.326 #244 (`Aqs` / `l0s` @298076800):
 * Head-start Bash shell snapshot creation before the first Bash command runs
 * (saving ~1s on Windows and Unix). If more than 20s elapse before the first
 * Bash command consumes it, invalidate the stale snapshot and rebuild fresh.
 */
export const SNAPSHOT_HEAD_START_MAX_AGE_MS = 20_000
let snapshotStartedAheadAt: number | null = null
let snapshotSettled = false
let snapshotHeadStartSkipReason: string | null = null

export function startBashSnapshotHeadStart(now: () => number = Date.now): void {
  if (snapshotSettled) return
  snapshotStartedAheadAt = now()
  snapshotHeadStartSkipReason = null
  void getShellConfig()
    .then(() => {
      snapshotSettled = true
    })
    .catch(() => {
      // Non-fatal: clear memoized rejected promise and head-start timestamp so
      // next exec() retries fresh instead of reusing a poisoned promise.
      getShellConfig.cache.clear?.()
      snapshotStartedAheadAt = null
    })
}

export function consumeBashSnapshotHeadStart(now: () => number = Date.now): {
  startedAhead: boolean
  discardedStale: boolean
} {
  const startedAt = snapshotStartedAheadAt
  if (startedAt === null) {
    return { startedAhead: false, discardedStale: false }
  }
  snapshotStartedAheadAt = null
  if (now() - startedAt > SNAPSHOT_HEAD_START_MAX_AGE_MS) {
    snapshotHeadStartSkipReason = 'too_old'
    snapshotSettled = false
    getShellConfig.cache.clear?.()
    return { startedAhead: true, discardedStale: true }
  }
  return { startedAhead: true, discardedStale: false }
}

export function getBashSnapshotHeadStartState(): {
  snapshotStartedAheadAt: number | null
  snapshotSettled: boolean
  skipReason: string | null
} {
  return {
    snapshotStartedAheadAt,
    snapshotSettled,
    skipReason: snapshotHeadStartSkipReason,
  }
}

export function resetBashSnapshotHeadStartForTesting(): void {
  snapshotStartedAheadAt = null
  snapshotSettled = false
  snapshotHeadStartSkipReason = null
  getShellConfig.cache.clear?.()
}

export const getPsProvider = memoize(async (): Promise<ShellProvider> => {
  const psPath = await getCachedPowerShellPath()
  if (!psPath) {
    throw new Error('PowerShell is not available')
  }
  return createPowerShellProvider(psPath)
})

const resolveProvider: Record<ShellType, () => Promise<ShellProvider>> = {
  bash: async () => (await getShellConfig()).provider,
  powershell: getPsProvider,
}

export type ExecOptions = {
  timeout?: number
  onProgress?: (
    lastLines: string,
    allLines: string,
    totalLines: number,
    totalBytes: number,
    isIncomplete: boolean,
  ) => void
  preventCwdChanges?: boolean
  shouldUseSandbox?: boolean
  shouldAutoBackground?: boolean
  /** When provided, stdout is piped (not sent to file) and this callback fires on each data chunk. */
  onStdout?: (data: string) => void
  /**
   * densable 2.1.217 `agentWorktree` — agent isolation worktree path.
   * densable 2.1.222: VRu/ZRu also run when Qgt falls back to session
   * EnterWorktree path (`resolveIsolationRoot` = agentWorktree || session).
   * context_lost / worktree_gone still require agentWorktree (p) only.
   */
  agentWorktree?: string
  /**
   * densable `isolationRoot` (f) — optional explicit Qgt override. When
   * omitted, Shell computes `f ?? p` via resolveIsolationRoot.
   */
  isolationRoot?: string
  /**
   * densable 2.1.233 `useToolMemoryCgroup` — when true, place the child into
   * the tool memory cgroup (Qfp / CLAUDE_CODE_TOOL_MEMORY_LIMIT).
   * BashTool + PowerShellTool pass true; other callers leave off.
   */
  useToolMemoryCgroup?: boolean
}

/**
 * Execute a shell command using the environment snapshot
 * Creates a new shell process for each command execution
 */
export async function exec(
  command: string,
  abortSignal: AbortSignal,
  shellType: ShellType,
  options?: ExecOptions,
): Promise<ShellCommand> {
  const {
    timeout,
    onProgress,
    preventCwdChanges,
    shouldUseSandbox,
    shouldAutoBackground,
    onStdout,
    agentWorktree,
    isolationRoot: isolationRootOpt,
    useToolMemoryCgroup,
  } = options ?? {}
  const commandTimeout = timeout || DEFAULT_TIMEOUT

  // Official 2.1.326 #244 (`PXe` @298077500): if a head-started snapshot is
  // older than SNAPSHOT_HEAD_START_MAX_AGE_MS (20s), discard it and rebuild.
  if (shellType === 'bash') {
    consumeBashSnapshotHeadStart()
  }

  const provider = await resolveProvider[shellType]()
  if (shellType === 'bash') {
    snapshotSettled = true
  }

  const id = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, '0')

  // Sandbox temp directory - use per-user directory name to prevent multi-user permission conflicts.
  // tmpdir() honors $TMPDIR so non-/tmp environments (Termux/Android, containers) work out of the box.
  const sandboxTmpDir = posixJoin(
    process.env.CLAUDE_CODE_TMPDIR || tmpdir(),
    getClaudeTempDirName(),
  )

  const { commandString: builtCommand, cwdFilePath } =
    await provider.buildExecCommand(command, {
      id,
      sandboxTmpDir: shouldUseSandbox ? sandboxTmpDir : undefined,
      useSandbox: shouldUseSandbox ?? false,
    })

  let commandString = builtCommand
  // Official 2.1.323 #2024: upgrade bashProvider's extglob line (placed right
  // after snapshot sourcing) to disable all dangerous non-default zsh options
  // (`NO_EXTENDED_GLOB NO_BARE_GLOB_QUAL NO_BRACE_CCL NO_MAGIC_EQUAL_SUBST
  // NO_EQUALS`) via `\builtin setopt` / `\builtin shopt`.
  if (shellType === 'bash') {
    const hardened = getShellOptionHardeningCommand(provider.shellPath)
    if (hardened !== null) {
      if (
        commandString.includes(
          '{ shopt -u extglob || setopt NO_EXTENDED_GLOB; } >/dev/null 2>&1 || true',
        )
      ) {
        commandString = commandString.replace(
          '{ shopt -u extglob || setopt NO_EXTENDED_GLOB; } >/dev/null 2>&1 || true',
          hardened,
        )
      } else if (
        commandString.includes('setopt NO_EXTENDED_GLOB 2>/dev/null || true')
      ) {
        commandString = commandString.replace(
          'setopt NO_EXTENDED_GLOB 2>/dev/null || true',
          hardened,
        )
      } else if (
        commandString.includes('shopt -u extglob 2>/dev/null || true')
      ) {
        commandString = commandString.replace(
          'shopt -u extglob 2>/dev/null || true',
          hardened,
        )
      } else {
        commandString = `${hardened} && ${commandString}`
      }
    }
  }
  if (shellType === 'bash' && !process.env.CLAUDE_CODE_SHELL_PREFIX) {
    const preludeParts: string[] = []
    if (getFeatureValue_CACHED_MAY_BE_STALE('tengu_swirling_koala', true)) {
      preludeParts.push(CLEAR_WHICH_COMMAND)
    }
    preludeParts.push(CLEAR_UNSETENV_COMMAND)
    const gitGrepWrapper = await buildMacOsGitGrepCLocaleWrapper(command)
    if (gitGrepWrapper !== null) {
      preludeParts.push(gitGrepWrapper)
    }
    commandString = `${preludeParts.join(' && ')} && ${commandString}`
  }

  let cwd = pwd()

  // densable shell isolation stack (2.1.222):
  // p = agentWorktree; f = isolationRoot opt; k = f ?? p ?? Qgt(session)
  // 1) context_lost — p && !GZe() (cwd ALS override missing) — before recovery
  // 2) worktree_gone — p && cwd missing and recovery only hits sn() (index 0)
  // 3) VRu/qRu — k set: cwd touches shared roots && !inside worktree
  // 4) ZRu — k set && bash only, full AST git-redirect guard
  if (agentWorktree && !getCwdOverride()) {
    // densable GZe() ≈ getCwdOverride() (ALS store present)
    logForDebugging(
      `[worktree] blocked shell exec after cwd-override loss: agentWorktree=${agentWorktree}`,
      { level: 'warn' },
    )
    // densable: O("tengu_agent_worktree_cwd_escape_blocked", {reason: context_lost})
    logEvent('tengu_agent_worktree_cwd_escape_blocked', {
      context_lost: true,
    })
    return createFailedCommand(
      `The working-directory isolation context for this agent was lost, so this command would run in the parent session's directory instead of this agent's worktree (${agentWorktree}). Refusing to run it. Retry the command; if this keeps failing, report that worktree isolation was lost.`,
    )
  }

  // Recover if the current working directory no longer exists on disk.
  // This can happen when a command deletes its own CWD (e.g., temp dir cleanup).
  // Official 2.1.323 #2137: on Windows drives where `realpath` cannot resolve a
  // folder's real path (e.g. Dokan/subst/WinFsp), do not treat non-ENOENT
  // errors as a deleted working directory.
  const cwdCheck = await verifyWorkingDirectoryExists(cwd)
  if (!cwdCheck.exists) {
    const candidates: string[] = [getOriginalCwd()]
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { homedir } = require('os') as typeof import('os')
      candidates.push(homedir())
    } catch {
      // ignore
    }
    let recovered: string | null = null
    let recoveredIdx = -1
    for (let i = 0; i < candidates.length; i++) {
      const candidateCheck = await verifyWorkingDirectoryExists(candidates[i]!)
      if (candidateCheck.exists) {
        recovered = candidateCheck.resolved
        recoveredIdx = i
        break
      }
    }
    if (recovered === null) {
      return createFailedCommand(
        `Working directory "${cwd}" no longer exists. Please restart Claude from an existing directory.`,
      )
    }
    if (agentWorktree && recoveredIdx === 0) {
      logForDebugging(
        `[worktree] blocked shell exec: cwd "${cwd}" is gone and recovery targets the shared checkout; agentWorktree=${agentWorktree}`,
        { level: 'warn' },
      )
      // densable: O("tengu_agent_worktree_cwd_escape_blocked", {reason: worktree_gone})
      logEvent('tengu_agent_worktree_cwd_escape_blocked', {
        worktree_gone: true,
      })
      return createFailedCommand(
        checkAgentWorktreeGoneRecovery(cwd, agentWorktree),
      )
    }
    logForDebugging(
      `Shell CWD "${cwd}" no longer exists, recovering to "${recovered}"`,
    )
    setCwdState(recovered)
    // Official 2.1.325 #2267: never silently run the command in the recovered
    // launch/home directory after the working directory was deleted — fail
    // with a message so the command can be re-issued from the recovered directory.
    return createFailedCommand(shellCwdRecoveredReissueMessage(cwd, recovered))
  }

  // If already aborted, don't spawn the process at all
  if (abortSignal.aborted) {
    return createAbortedCommand()
  }

  // densable: let k = f ?? p (then Qgt falls back to session worktreePath)
  const isolationRoot =
    isolationRootOpt ?? agentWorktree ?? resolveIsolationRoot({ agentWorktree })
  if (isolationRoot) {
    // densable hSd/VRu — isolationRoot cwd must not resolve to shared checkout
    const cwdBlock = checkAgentWorktreeCwdEscape(cwd, isolationRoot)
    if (cwdBlock) {
      logForDebugging(
        `[worktree] blocked shell exec outside isolation worktree: cwd=${cwd} isolationRoot=${isolationRoot}`,
        { level: 'warn' },
      )
      // densable: O("tengu_agent_worktree_cwd_escape_blocked", {reason: shared_checkout})
      logEvent('tengu_agent_worktree_cwd_escape_blocked', {
        shared_checkout: true,
      })
      return createFailedCommand(cwdBlock)
    }

    // densable: r==="bash"?QEd/ZRu(...):null — PowerShell gets VRu only
    if (shellType === 'bash') {
      const gitRedirectBlock = await checkZRuGitRedirectCommand(
        command,
        cwd,
        isolationRoot,
      )
      if (gitRedirectBlock) {
        logForDebugging(
          `[worktree] blocked shell exec: command redirects git into the shared checkout: cwd=${cwd} isolationRoot=${isolationRoot}`,
          { level: 'warn' },
        )
        // densable: O("tengu_agent_worktree_cwd_escape_blocked", {reason: command_redirect})
        logEvent('tengu_agent_worktree_cwd_escape_blocked', {
          command_redirect: true,
        })
        return createFailedCommand(gitRedirectBlock)
      }
    }
  }

  const binShell = provider.shellPath

  // Sandboxed PowerShell: wrapWithSandbox hardcodes `<binShell> -c '<cmd>'` —
  // using pwsh there would lose -NoProfile -NonInteractive (profile load
  // inside sandbox → delays, stray output, may hang on prompts). Instead:
  //   • powershellProvider.buildExecCommand (useSandbox) pre-wraps as
  //     `pwsh -NoProfile -NonInteractive -EncodedCommand <base64>` — base64
  //     survives the runtime's shellquote.quote() layer
  //   • pass /bin/sh as the sandbox's inner shell to exec that invocation
  //   • outer spawn is also /bin/sh -c to parse the runtime's POSIX output
  // /bin/sh exists on every platform where sandbox is supported.
  const isSandboxedPowerShell = shouldUseSandbox && shellType === 'powershell'
  const sandboxBinShell = isSandboxedPowerShell ? '/bin/sh' : binShell

  if (shouldUseSandbox) {
    commandString = await SandboxManager.wrapWithSandbox(
      commandString,
      sandboxBinShell,
      undefined,
      abortSignal,
    )
    // Create sandbox temp directory for sandboxed processes with secure permissions
    try {
      const fs = getFsImplementation()
      await fs.mkdir(sandboxTmpDir, { mode: 0o700 })
    } catch (error) {
      logForDebugging(`Failed to create ${sandboxTmpDir} directory: ${error}`)
    }
  }

  const spawnBinary = isSandboxedPowerShell ? '/bin/sh' : binShell
  const rawShellArgs = isSandboxedPowerShell
    ? ['-c', commandString]
    : provider.getSpawnArgs(commandString)
  // #1118 SEA: when sandboxed, the outer shell spawns outside the sandbox;
  // strip login flags (-l / --login) so it does not run startup files outside.
  const shellArgs = shouldUseSandbox
    ? rawShellArgs.filter(arg => arg !== '-l' && arg !== '--login')
    : rawShellArgs
  const envOverrides = await provider.getEnvironmentOverrides(command)
  if (shellType === 'powershell') {
    const sessionEnvVars = await getSessionEnvironmentVariables()
    if (sessionEnvVars.size > 0) {
      if (
        sessionEnvVars.has('FORCE_COLOR') &&
        process.env.NO_COLOR === undefined
      ) {
        delete envOverrides.NO_COLOR
      }
      for (const [k, v] of sessionEnvVars) {
        envOverrides[k] = v
      }
    }
  }

  // When onStdout is provided, use pipe mode: stdout flows through
  // StreamWrapper → TaskOutput in-memory buffer instead of a file fd.
  // This lets callers receive real-time stdout callbacks.
  const usePipeMode = !!onStdout
  const taskId = generateTaskId('local_bash')
  const taskOutput = new TaskOutput(taskId, onProgress ?? null, !usePipeMode)
  let outputHandle: FileHandle | undefined
  let childProcess: ChildProcess | undefined

  try {
    await mkdir(getTaskOutputDir(), { recursive: true })

    // In file mode, both stdout and stderr go to the same file fd.
    // On POSIX, O_APPEND makes each write atomic (seek-to-end + write), so
    // stdout and stderr are interleaved chronologically without tearing.
    // densable 2.1.251 Que/nt exclusive create: O_CREAT|O_EXCL|O_NOFOLLOW
    // (windows 'wx'). O_EXCL refuses a pre-planted symlink/hardlink leaf;
    // O_NOFOLLOW blocks follow-on open races from the sandbox.
    // On Windows, numeric flags can produce EINVAL through libuv — use 'wx'.
    // 'wx' grants FILE_WRITE_DATA (unlike 'a'), so MSYS2/Cygwin does not
    // discard inherited-handle output. Atomicity is preserved because
    // duplicated handles share the same FILE_OBJECT with
    // FILE_SYNCHRONOUS_IO_NONALERT.
    if (!usePipeMode) {
      const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0
      outputHandle = await open(
        taskOutput.path,
        process.platform === 'win32'
          ? 'wx'
          : fsConstants.O_WRONLY |
              fsConstants.O_APPEND |
              fsConstants.O_CREAT |
              fsConstants.O_EXCL |
              O_NOFOLLOW,
      )
    }

    // densable 2.1.233: yhp.spawn(..., { cgroup: y ? Qfp() : void 0 }).
    // Bun's child_process.spawn accepts `cgroup` (atomic at process create).
    // Pure Node has no cgroup option → post-spawn cgroup.procs attach only.
    const cgroupDir = resolveToolMemoryCgroupForSpawn(useToolMemoryCgroup)
    const useAtomicCgroup =
      typeof Bun !== 'undefined' && cgroupDir !== undefined

    const powerShellPluginBinPaths =
      shellType === 'powershell' && !shouldUseSandbox
        ? await getPowerShellPluginBinPaths()
        : []

    childProcess = spawn(spawnBinary, shellArgs, {
      env: buildShellSpawnEnv({
        shellType,
        binShell,
        envOverrides,
        spawnEnvPluginBinPaths: powerShellPluginBinPaths,
        envDefaults: resolveCapturedShellExportsForSpawn(
          shellType,
          shouldUseSandbox ?? false,
        ),
        shouldUseSandbox: shouldUseSandbox ?? false,
      }),
      cwd,
      // densable 2.1.214 #21: PowerShell provider.stdin === 'ignore' so children
      // waiting on stdin do not hang until tool timeout. Bash keeps 'pipe'.
      stdio: usePipeMode
        ? [provider.stdin ?? 'pipe', 'pipe', 'pipe']
        : [provider.stdin ?? 'pipe', outputHandle?.fd, outputHandle?.fd],
      // Don't pass the signal - we'll handle termination ourselves with tree-kill
      detached: provider.detached,
      // Prevent visible console window on Windows (no-op on other platforms)
      windowsHide: true,
      // densable SEA: cgroup:y?Qfp():void 0 — Bun child_process only
      ...(useAtomicCgroup ? ({ cgroup: cgroupDir } as { cgroup: string }) : {}),
    })

    // Node fallback only — densable does not post-attach when cgroup: is set.
    if (useToolMemoryCgroup && !useAtomicCgroup) {
      attachPidToToolMemoryCgroup(childProcess.pid)
    }

    const shellCommand = wrapSpawn(
      childProcess,
      abortSignal,
      commandTimeout,
      taskOutput,
      shouldAutoBackground,
    )

    // Close our copy of the fd — the child has its own dup.
    // Must happen after wrapSpawn attaches 'error' listener, since the await
    // yields and the child's ENOENT 'error' event can fire in that window.
    // Fire-and-forget (official pHe) so concurrent spawns on macOS do not
    // serialize or stall on FileHandle.close() before returning shellCommand.
    if (outputHandle !== undefined) {
      void outputHandle.close().catch(() => {
        // fd may already be closed by the child; safe to ignore
      })
    }

    // In pipe mode, attach the caller's callbacks alongside StreamWrapper.
    // Both listeners receive the same data chunks (Node.js ReadableStream supports
    // multiple 'data' listeners). StreamWrapper feeds TaskOutput for persistence;
    // these callbacks give the caller real-time access.
    if (childProcess.stdout && onStdout) {
      childProcess.stdout.on('data', (chunk: string | Buffer) => {
        onStdout(typeof chunk === 'string' ? chunk : chunk.toString())
      })
    }

    // Attach cleanup to the command result
    // NOTE: readFileSync is intentional here — cwd must be visible in the
    // same microtask to callers who `await shellCommand.result`. densable
    // `$0f` unlinks asynchronously (and may wait for child `exit`).

    // On Windows, cwdFilePath is a POSIX path (for bash's `pwd -P >| $path`),
    // but Node.js needs a native Windows path for readFileSync/unlinkSync.
    // Similarly, `pwd -P` outputs a POSIX path that must be converted before setCwd.
    const nativeCwdFilePath =
      getPlatform() === 'windows'
        ? posixPathToWindowsPath(cwdFilePath)
        : cwdFilePath

    shellCommand.result = shellCommand.result.then(async result => {
      // On Linux, bwrap creates 0-byte mount-point files on the host to deny
      // writes to non-existent paths (.bashrc, HEAD, etc.). These persist after
      // bwrap exits as ghost dotfiles in cwd. Cleanup is synchronous and a no-op
      // on macOS. Keep before any await so callers awaiting .result see a clean
      // working tree in the same microtask.
      if (shouldUseSandbox) {
        SandboxManager.cleanupAfterCommand()
      }
      // Only foreground tasks update the cwd
      if (result && !preventCwdChanges && !result.backgroundTaskId) {
        try {
          let newCwd = readFileSync(nativeCwdFilePath, {
            encoding: 'utf8',
          }).trim()
          if (getPlatform() === 'windows') {
            newCwd = preserveWindowsDriveLetterCase(
              posixPathToWindowsPath(newCwd),
              cwd,
            )
          }
          // densable lMp: reject unsafe shell cwd read-back before setCwd
          if (!isSafeShellCwdReadBack(newCwd, cwd)) {
            // already logged inside helper
          } else if (newCwd.normalize('NFC') !== cwd) {
            // cwd is NFC-normalized (setCwdState); newCwd from `pwd -P` may be
            // NFD on macOS APFS. Normalize before comparing so Unicode paths
            // don't false-positive as "changed" on every command.
            setCwd(newCwd, cwd)
            invalidateSessionEnvCache()
            void onCwdChangedForHooks(cwd, newCwd)
          }
        } catch {
          logEvent('tengu_shell_set_cwd', { success: false })
        }
      }
      // densable `$0f`: if the child is still running, unlink on exit so
      // kill/timeout/interrupt still remove `/tmp/claude-*-cwd`.
      if (childProcess && shouldDeferCwdTrackingUnlink(childProcess)) {
        childProcess.once('exit', () => {
          void unlinkCwdTrackingFile(nativeCwdFilePath)
        })
      } else {
        await unlinkCwdTrackingFile(nativeCwdFilePath)
      }
      return result
    })

    return shellCommand
  } catch (error) {
    // Close the fd if spawn failed (child never got its dup)
    if (outputHandle !== undefined) {
      try {
        await outputHandle.close()
      } catch {
        // May already be closed
      }
    }
    taskOutput.clear()

    logForDebugging(`Shell exec error: ${errorMessage(error)}`)

    const preSpawnDiskFull = formatPreSpawnDiskFullError(error, childProcess)
    if (preSpawnDiskFull !== undefined) {
      return createAbortedCommand(undefined, {
        code: 1,
        stderr: preSpawnDiskFull,
      })
    }

    return createAbortedCommand(undefined, {
      code: 126, // Standard Unix code for execution errors
      stderr: errorMessage(error),
    })
  }
}

/**
 * densable `oj` / `Lxe` (#1039): format friendly pre-spawn ENOSPC/EDQUOT
 * message when output-file creation fails before the child process spawns.
 */
export function formatPreSpawnDiskFullError(
  error: unknown,
  childProcess: ChildProcess | undefined,
): string | undefined {
  const code = getErrnoCode(error)
  if (childProcess !== undefined || (code !== 'ENOSPC' && code !== 'EDQUOT')) {
    return undefined
  }
  const reason =
    code === 'EDQUOT'
      ? `the user's disk quota is used up (${code})`
      : `this computer's disk is full (${code})`
  const tempRoot = nativeJoin(
    process.env.CLAUDE_CODE_TMPDIR || tmpdir(),
    getClaudeTempDirName(),
  )
  return `The command was not started: ${reason} on the volume holding ${tempRoot} (Claude Code's temporary directory), so the file that captures command output could not be created there and nothing ran. Free space on that volume, or set CLAUDE_CODE_TMPDIR to a directory on another one, then try again.`
}

/**
 * densable `lMp` — validate shell cwd read-back before applying setCwd.
 * Rejects NT-namespace / network UNC / dot-segment spellings (warn + ignore).
 * densable also checks foreign automount (`Q8`) and network symlink (`C2`);
 * local `bu`/`wwo` stubs make those no-ops — skip inventing them.
 */
/**
 * Official 2.1.321 #1857:
 * On Windows, Git Bash `pwd -P` returns `/c/...` which `posixPathToWindowsPath`
 * turns into `C:\...`. If the session's original `cwd` had a lowercase drive
 * letter (e.g. `c:\repo`), preserve that drive-letter case so `setCwd` doesn't
 * treat the first shell command as a cwd change and tear down `FileChanged`
 * watchPaths hooks.
 */
export function preserveWindowsDriveLetterCase(
  newCwd: string,
  prevCwd: string,
): string {
  if (
    newCwd.length >= 2 &&
    prevCwd.length >= 2 &&
    newCwd[1] === ':' &&
    prevCwd[1] === ':' &&
    /[A-Za-z]/.test(newCwd[0]!) &&
    newCwd[0]!.toLowerCase() === prevCwd[0]!.toLowerCase()
  ) {
    return `${prevCwd[0]!}${newCwd.slice(1)}`
  }
  return newCwd
}

export function isSafeShellCwdReadBack(
  readBack: string,
  previousCwd: string,
): boolean {
  void previousCwd
  const candidates =
    getPlatform() === 'windows' ? [readBack] : [readBack.replace(/^\/+/, '/')]
  for (const candidate of candidates) {
    if (hasPathDotSegment(candidate)) {
      logForDebugging('shell cwd read-back contains a dot-segment; ignoring', {
        level: 'warn',
      })
      return false
    }
    if (isNtObjectNamespacePath(candidate)) {
      logForDebugging(
        'shell cwd read-back is an NT-namespace device path; ignoring',
        { level: 'warn' },
      )
      return false
    }
    // densable: o&&qh(i)&&wwr(i,r) — network path differing from prior host
    if (getPlatform() === 'windows' && isNetworkUncPath(candidate)) {
      logForDebugging('shell cwd read-back is a network path; ignoring', {
        level: 'warn',
      })
      return false
    }
  }
  if (!isAbsolute(readBack)) {
    logForDebugging('shell cwd read-back is not an absolute path; ignoring', {
      level: 'warn',
    })
    return false
  }
  return true
}

/**
 * Set the current working directory
 */
export function setCwd(path: string, relativeTo?: string): void {
  const resolved = isAbsolute(path)
    ? path
    : resolve(relativeTo || getFsImplementation().cwd(), path)
  // Resolve symlinks to match the behavior of pwd -P.
  // realpathSync throws ENOENT if the path doesn't exist - convert to a
  // friendlier error message instead of a separate existsSync pre-check (TOCTOU).
  let physicalPath: string
  try {
    physicalPath = getFsImplementation().realpathSync(resolved)
  } catch (e) {
    if (isENOENT(e)) {
      throw new Error(`Path "${resolved}" does not exist`)
    }
    throw e
  }

  setCwdState(physicalPath)
  if (process.env.NODE_ENV !== 'test') {
    try {
      logEvent('tengu_shell_set_cwd', {
        success: true,
      })
    } catch (_error) {
      // Ignore logging errors to prevent test failures
    }
  }
}
