import { getIsNonInteractiveSession } from '../../../bootstrap/state.js'
import { logForDebugging } from '../../../utils/debug.js'
import { isEnvTruthy } from '../../../utils/envUtils.js'
import { errorMessage } from '../../../utils/errors.js'
import { leftoverM, leftoverY } from '../../../utils/leftoverOt.js'
import { getPlatform } from '../../../utils/platform.js'
import {
  getBootstrapSessionHost,
  HostSlot,
} from '../../../utils/sessionHost.js'
import {
  getInitialSettings,
  getSettingsForSource,
} from '../../../utils/settings/settings.js'
import {
  isInITerm2,
  isInWindowsTerminal,
  isInsideTmux,
  isInsideTmuxSync,
  isIt2CliAvailable,
  isTmuxAvailable,
  isWindowsTerminalAvailable,
} from './detection.js'
import { createInProcessBackend } from './InProcessBackend.js'
import { getPreferTmuxOverIterm2 } from './it2Setup.js'
import { createPaneBackendExecutor } from './PaneBackendExecutor.js'
import { getTeammateModeFromSnapshot } from './teammateModeSnapshot.js'
import type {
  BackendDetectionResult,
  PaneBackend,
  PaneBackendType,
  TeammateExecutor,
} from './types.js'

type BackendRegistryHostState = {
  /** Cached backend detection result for this host. */
  cachedBackend: PaneBackend | null
  /** Cached detection result with additional metadata. */
  cachedDetectionResult: BackendDetectionResult | null
  /** Cached in-process backend instance. */
  cachedInProcessBackend: TeammateExecutor | null
  /** Cached pane backend executor instance wrapping the detected PaneBackend. */
  cachedPaneBackendExecutor: TeammateExecutor | null
  /**
   * Tracks whether spawn fell back to in-process mode because no pane backend
   * was available (e.g., iTerm2 without it2 or tmux installed). Once set,
   * isInProcessEnabled() returns true so UI (banner, teams menu) reflects reality.
   */
  inProcessFallbackActive: boolean
}

const backendRegistryHostSlot = new HostSlot<BackendRegistryHostState>(() => ({
  cachedBackend: null,
  cachedDetectionResult: null,
  cachedInProcessBackend: null,
  cachedPaneBackendExecutor: null,
  inProcessFallbackActive: false,
}))

function getRegistryState(): BackendRegistryHostState {
  return backendRegistryHostSlot.of(getBootstrapSessionHost())
}

/**
 * Flag to track if backends have been registered.
 */
let backendsRegistered = false

/**
 * Placeholder for TmuxBackend - will be replaced with actual implementation.
 * This allows the registry to compile before the backend implementations exist.
 */
let TmuxBackendClass: (new () => PaneBackend) | null = null

/**
 * Placeholder for ITermBackend - will be replaced with actual implementation.
 * This allows the registry to compile before the backend implementations exist.
 */
let ITermBackendClass: (new () => PaneBackend) | null = null

/**
 * Placeholder for WindowsTerminalBackend.
 */
let WindowsTerminalBackendClass: (new () => PaneBackend) | null = null

/**
 * Ensures backend classes are dynamically imported so getBackendByType() can
 * construct them. Unlike detectAndGetBackend(), this never spawns subprocesses
 * and never throws — it's the lightweight option when you only need class
 * registration (e.g., killing a pane by its stored backendType).
 */
export async function ensureBackendsRegistered(): Promise<void> {
  if (backendsRegistered) return
  await import('./TmuxBackend.js')
  await import('./ITermBackend.js')
  await import('./WindowsTerminalBackend.js')
  backendsRegistered = true
}

/**
 * Registers the TmuxBackend class with the registry.
 * Called by TmuxBackend.ts to avoid circular dependencies.
 */
export function registerTmuxBackend(backendClass: new () => PaneBackend): void {
  TmuxBackendClass = backendClass
}

/**
 * Registers the ITermBackend class with the registry.
 * Called by ITermBackend.ts to avoid circular dependencies.
 */
export function registerITermBackend(
  backendClass: new () => PaneBackend,
): void {
  logForDebugging(
    `[registry] registerITermBackend called, class=${backendClass?.name || 'undefined'}`,
  )
  ITermBackendClass = backendClass
}

export function registerWindowsTerminalBackend(
  backendClass: new () => PaneBackend,
): void {
  WindowsTerminalBackendClass = backendClass
}

/**
 * Creates a TmuxBackend instance.
 * Throws if TmuxBackend hasn't been registered.
 */
function createTmuxBackend(): PaneBackend {
  if (!TmuxBackendClass) {
    throw new Error(
      'TmuxBackend not registered. Import TmuxBackend.ts before using the registry.',
    )
  }
  return new TmuxBackendClass()
}

/**
 * Creates an ITermBackend instance.
 * Throws if ITermBackend hasn't been registered.
 */
function createITermBackend(): PaneBackend {
  if (!ITermBackendClass) {
    throw new Error(
      'ITermBackend not registered. Import ITermBackend.ts before using the registry.',
    )
  }
  return new ITermBackendClass()
}

function createWindowsTerminalBackend(): PaneBackend {
  if (!WindowsTerminalBackendClass) {
    throw new Error(
      'WindowsTerminalBackend not registered. Import WindowsTerminalBackend.ts before using the registry.',
    )
  }
  return new WindowsTerminalBackendClass()
}

/**
 * Detection priority flow:
 * 1. If inside tmux, always use tmux (even in iTerm2)
 * 2. If in iTerm2 with it2 available, use iTerm2 backend
 * 3. If in iTerm2 without it2, return result indicating setup needed
 * 4. If tmux available, use tmux (creates external session)
 * 5. Otherwise, throw error with instructions
 */
export async function detectAndGetBackend(): Promise<BackendDetectionResult> {
  // Ensure backends are registered before detection
  await ensureBackendsRegistered()

  const state = getRegistryState()
  // Return cached result if available
  if (state.cachedDetectionResult) {
    logForDebugging(
      `[BackendRegistry] Using cached backend: ${state.cachedDetectionResult.backend.type}`,
    )
    return state.cachedDetectionResult
  }

  logForDebugging('[BackendRegistry] Starting backend detection...')

  // Check explicit teammateMode === 'iterm2' BEFORE tmux detection
  // (Official `Hjr` in chunk@312276971.js @4100-4700).
  const inITerm2 = isInITerm2()
  if (getTeammateMode() === 'iterm2') {
    if (!inITerm2) {
      leftoverM('swarm_backend_detect', 'iterm2_explicit_not_in_iterm2')
      throw new Error(
        'teammateMode is set to "iterm2" but this session is not running inside iTerm2. Launch Claude from iTerm2, or change teammateMode in settings.',
      )
    }
    const it2Available = await isIt2CliAvailable()
    if (!it2Available) {
      leftoverM('swarm_backend_detect', 'iterm2_explicit_no_it2')
      throw new Error(
        'teammateMode is set to "iterm2" but the it2 CLI is not reachable. Install it with `pip install it2` and enable the Python API in iTerm2 (Preferences > General > Magic > Enable Python API).',
      )
    }
    logForDebugging(
      '[BackendRegistry] Selected: iterm2 (explicit teammateMode)',
    )
    const backend = createITermBackend()
    state.cachedBackend = backend
    state.cachedDetectionResult = {
      backend,
      isNative: true,
      needsIt2Setup: false,
    }
    leftoverY('swarm_backend_detect')
    return state.cachedDetectionResult
  }

  // Check all environment conditions upfront for logging
  const insideTmux = await isInsideTmux()
  const inWindowsTerminal = isInWindowsTerminal()

  logForDebugging(
    `[BackendRegistry] Environment: insideTmux=${insideTmux}, inITerm2=${inITerm2}, inWindowsTerminal=${inWindowsTerminal}`,
  )

  if (getTeammateMode() === 'windows-terminal') {
    if (getPlatform() !== 'windows') {
      throw new Error(
        'Windows Terminal teammate mode is only available on Windows',
      )
    }
    const wtAvailable = await isWindowsTerminalAvailable()
    if (!wtAvailable) {
      throw new Error('Windows Terminal teammate mode requires wt.exe in PATH')
    }
    const backend = createWindowsTerminalBackend()
    state.cachedBackend = backend
    state.cachedDetectionResult = {
      backend,
      isNative: inWindowsTerminal,
      needsIt2Setup: false,
    }
    return state.cachedDetectionResult
  }

  // Priority 1: If inside tmux, always use tmux
  if (insideTmux) {
    logForDebugging(
      '[BackendRegistry] Selected: tmux (running inside tmux session)',
    )
    const backend = createTmuxBackend()
    state.cachedBackend = backend
    state.cachedDetectionResult = {
      backend,
      isNative: true,
      needsIt2Setup: false,
    }
    return state.cachedDetectionResult
  }

  // Priority 2: If in iTerm2, try to use native panes
  if (inITerm2) {
    // Check if user previously chose to prefer tmux over iTerm2
    const preferTmux = getPreferTmuxOverIterm2()
    if (preferTmux) {
      logForDebugging(
        '[BackendRegistry] User prefers tmux over iTerm2, skipping iTerm2 detection',
      )
    } else {
      const it2Available = await isIt2CliAvailable()
      logForDebugging(
        `[BackendRegistry] iTerm2 detected, it2 CLI available: ${it2Available}`,
      )

      if (it2Available) {
        logForDebugging(
          '[BackendRegistry] Selected: iterm2 (native iTerm2 with it2 CLI)',
        )
        const backend = createITermBackend()
        state.cachedBackend = backend
        state.cachedDetectionResult = {
          backend,
          isNative: true,
          needsIt2Setup: false,
        }
        return state.cachedDetectionResult
      }
    }

    // In iTerm2 but it2 not available - check if tmux can be used as fallback
    const tmuxAvailable = await isTmuxAvailable()
    logForDebugging(
      `[BackendRegistry] it2 not available, tmux available: ${tmuxAvailable}`,
    )

    if (tmuxAvailable) {
      logForDebugging(
        '[BackendRegistry] Selected: tmux (fallback in iTerm2, it2 setup recommended)',
      )
      // Return tmux as fallback. Only signal it2 setup if the user hasn't already
      // chosen to prefer tmux - otherwise they'd be re-prompted on every spawn.
      const backend = createTmuxBackend()
      state.cachedBackend = backend
      state.cachedDetectionResult = {
        backend,
        isNative: false,
        needsIt2Setup: !preferTmux,
      }
      return state.cachedDetectionResult
    }

    // In iTerm2 with no it2 and no tmux - it2 setup is required
    logForDebugging(
      '[BackendRegistry] ERROR: iTerm2 detected but no it2 CLI and no tmux',
    )
    throw new Error(
      'iTerm2 detected but it2 CLI not installed. Install it2 with: pip install it2',
    )
  }

  // Priority 3: Native Windows Terminal panes/tabs — only when actually
  // running INSIDE Windows Terminal. If running in VS Code's integrated
  // terminal or another non-WT environment, fall through to in-process
  // mode instead of opening an external Windows Terminal window.
  if (getPlatform() === 'windows' && inWindowsTerminal) {
    const wtAvailable = await isWindowsTerminalAvailable()
    logForDebugging(
      `[BackendRegistry] Inside Windows Terminal, wt.exe available: ${wtAvailable}`,
    )

    if (wtAvailable) {
      logForDebugging('[BackendRegistry] Selected: Windows Terminal (wt.exe)')
      const backend = createWindowsTerminalBackend()
      state.cachedBackend = backend
      state.cachedDetectionResult = {
        backend,
        isNative: true,
        needsIt2Setup: false,
      }
      return state.cachedDetectionResult
    }
  }

  // Priority 4: Fall back to tmux external session
  const tmuxAvailable = await isTmuxAvailable()
  logForDebugging(
    `[BackendRegistry] Not in tmux or iTerm2, tmux available: ${tmuxAvailable}`,
  )

  if (tmuxAvailable) {
    logForDebugging('[BackendRegistry] Selected: tmux (external session mode)')
    const backend = createTmuxBackend()
    state.cachedBackend = backend
    state.cachedDetectionResult = {
      backend,
      isNative: false,
      needsIt2Setup: false,
    }
    return state.cachedDetectionResult
  }

  // No backend available - tmux is not installed
  logForDebugging('[BackendRegistry] ERROR: No pane backend available')
  throw new Error(getTmuxInstallInstructions())
}

/**
 * Returns platform-specific tmux installation instructions.
 */
function getTmuxInstallInstructions(): string {
  const platform = getPlatform()

  switch (platform) {
    case 'macos':
      return `To use agent swarms, install tmux:
  brew install tmux
Then start a tmux session with: tmux new-session -s claude`

    case 'linux':
    case 'wsl':
      return `To use agent swarms, install tmux:
  sudo apt install tmux    # Ubuntu/Debian
  sudo dnf install tmux    # Fedora/RHEL
Then start a tmux session with: tmux new-session -s claude`

    case 'windows':
      return `To use agent swarms, you need tmux which requires WSL (Windows Subsystem for Linux).
Install WSL first, then inside WSL run:
  sudo apt install tmux
Then start a tmux session with: tmux new-session -s claude`

    default:
      return `To use agent swarms, install tmux using your system's package manager.
Then start a tmux session with: tmux new-session -s claude`
  }
}

/**
 * Gets a backend by explicit type selection.
 * Useful for testing or when the user has a preference.
 *
 * @param type - The backend type to get
 * @returns The requested backend instance
 * @throws If the requested backend type is not available
 */
export function getBackendByType(type: PaneBackendType): PaneBackend {
  switch (type) {
    case 'tmux':
      return createTmuxBackend()
    case 'iterm2':
      return createITermBackend()
    case 'windows-terminal':
      return createWindowsTerminalBackend()
  }
}

/**
 * Gets the currently cached backend, if any.
 * Returns null if no backend has been detected yet.
 */
export function getCachedBackend(): PaneBackend | null {
  return getRegistryState().cachedBackend
}

/**
 * Gets the cached backend detection result, if any.
 * Returns null if detection hasn't run yet.
 * Use `isNative` to check if teammates are visible in native panes.
 */
export function getCachedDetectionResult(): BackendDetectionResult | null {
  return getRegistryState().cachedDetectionResult
}

/**
 * Records that spawn fell back to in-process mode because no pane backend
 * was available. After this, isInProcessEnabled() returns true and subsequent
 * spawns short-circuit to in-process (the environment won't change mid-session).
 */
export function markInProcessFallback(): void {
  logForDebugging('[BackendRegistry] Marking in-process fallback as active')
  getRegistryState().inProcessFallbackActive = true
}

export type RegistryTeammateMode =
  | 'auto'
  | 'tmux'
  | 'iterm2'
  | 'windows-terminal'
  | 'in-process'

/**
 * Gets the teammate mode for this session.
 * Returns the session snapshot captured at startup, ignoring runtime config changes.
 */
function getTeammateMode(): RegistryTeammateMode {
  return getTeammateModeFromSnapshot() as RegistryTeammateMode
}

type OutsideReadPermissionFlags = {
  blockFileToolReadsOutsideWorkingDirectories?: boolean
  blockReadsOutsideWorkingDirectories?: boolean
}

/**
 * Official `_q()` + outside-read settings check (`chunk@312276971.js @7728`):
 * Returns true when file-tool or general outside-working-directory read blocking
 * is active, forcing teammates into in-process mode so they inherit the parent
 * session's read fence instead of spawning an unfenced pane process.
 */
function hasOutsideReadBlockSetting(
  perms: OutsideReadPermissionFlags | undefined,
): boolean {
  return (
    perms?.blockFileToolReadsOutsideWorkingDirectories === true ||
    perms?.blockReadsOutsideWorkingDirectories === true
  )
}

function isOutsideReadBlockActive(): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) {
    return false
  }
  try {
    const flagPerms = getSettingsForSource('flagSettings')?.permissions as
      | OutsideReadPermissionFlags
      | undefined
    if (hasOutsideReadBlockSetting(flagPerms)) {
      return true
    }
    const mergedPerms = getInitialSettings()?.permissions as
      | OutsideReadPermissionFlags
      | undefined
    if (hasOutsideReadBlockSetting(mergedPerms)) {
      return true
    }
  } catch {
    // Ignore when settings subsystem is unavailable in minimal test contexts
  }
  return false
}

/**
 * Checks if in-process teammate execution is enabled.
 *
 * Logic:
 * - If non-interactive session, always enabled
 * - If permissions.blockFileToolReadsOutsideWorkingDirectories or
 *   permissions.blockReadsOutsideWorkingDirectories is set, force enabled
 * - If teammateMode is 'in-process', always enabled
 * - If teammateMode is 'tmux', 'iterm2', or 'windows-terminal', disabled (use pane backend)
 * - If teammateMode is 'auto' (default), check environment:
 *   - If inside tmux, use pane backend (return false)
 *   - If inside iTerm2, use pane backend (return false) - detectAndGetBackend()
 *     will pick ITermBackend if it2 is available, or fall back to tmux
 *   - If inside Windows Terminal, use pane backend (return false)
 *   - Otherwise, use in-process (return true)
 */
export function isInProcessEnabled(): boolean {
  // Force in-process mode for non-interactive sessions (-p mode)
  // since tmux-based teammates don't make sense without a terminal UI
  if (getIsNonInteractiveSession()) {
    logForDebugging(
      '[BackendRegistry] isInProcessEnabled: true (non-interactive session)',
    )
    return true
  }

  // Official `X5n` (`chunk@312276971.js @7728`): force in-process when
  // outside-working-directory read blocking is configured.
  if (isOutsideReadBlockActive()) {
    logForDebugging(
      '[BackendRegistry] isInProcessEnabled: true (permissions.blockFileToolReadsOutsideWorkingDirectories)',
    )
    return true
  }

  const mode = getTeammateMode()

  let enabled: boolean
  if (mode === 'in-process') {
    enabled = true
  } else if (
    mode === 'tmux' ||
    mode === 'iterm2' ||
    mode === 'windows-terminal'
  ) {
    enabled = false
  } else {
    // 'auto' mode - if a prior spawn fell back to in-process because no pane
    // backend was available, stay in-process (scoped to auto mode only so a
    // mid-session Settings change to explicit 'tmux' still takes effect).
    if (getRegistryState().inProcessFallbackActive) {
      logForDebugging(
        '[BackendRegistry] isInProcessEnabled: true (fallback after pane backend unavailable)',
      )
      return true
    }
    // Check if a pane backend environment is available
    // If inside tmux, iTerm2, or Windows Terminal, use pane backend; otherwise use in-process
    const insideTmux = isInsideTmuxSync()
    const inITerm2 = isInITerm2()
    const inWindowsTerminal = isInWindowsTerminal()
    if (
      !insideTmux &&
      !inITerm2 &&
      !inWindowsTerminal &&
      getPlatform() === 'windows'
    ) {
      // On Windows, even outside Windows Terminal (e.g. VS Code terminal, cmd.exe),
      // wt.exe may still be available. Let detectAndGetBackend() do the full async check.
      enabled = false
    } else {
      enabled = !insideTmux && !inITerm2 && !inWindowsTerminal
    }
  }

  logForDebugging(
    `[BackendRegistry] isInProcessEnabled: ${enabled} (mode=${mode})`,
  )
  return enabled
}

/**
 * Returns the resolved teammate executor mode for this session.
 * Unlike getTeammateModeFromSnapshot which may return 'auto', this returns
 * what 'auto' actually resolves to given the current environment.
 */
export function getResolvedTeammateMode():
  | 'in-process'
  | 'tmux'
  | 'windows-terminal' {
  if (isInProcessEnabled()) return 'in-process'
  const mode = getTeammateMode()
  if (mode === 'windows-terminal') return 'windows-terminal'
  if (mode === 'auto' && getPlatform() === 'windows') return 'windows-terminal'
  return 'tmux'
}

/**
 * Gets the InProcessBackend instance.
 * Creates and caches the instance on first call.
 */
export function getInProcessBackend(): TeammateExecutor {
  const state = getRegistryState()
  if (!state.cachedInProcessBackend) {
    state.cachedInProcessBackend = createInProcessBackend()
  }
  return state.cachedInProcessBackend
}

/**
 * Gets a TeammateExecutor for spawning teammates.
 *
 * Returns either:
 * - InProcessBackend when preferInProcess is true and in-process mode is enabled
 * - PaneBackendExecutor wrapping the detected pane backend otherwise
 *
 * This provides a unified TeammateExecutor interface regardless of execution mode,
 * allowing callers to spawn and manage teammates without knowing the backend details.
 *
 * @param preferInProcess - If true and in-process is enabled, returns InProcessBackend.
 *                          Otherwise returns PaneBackendExecutor.
 * @returns TeammateExecutor instance
 */
export async function getTeammateExecutor(
  preferInProcess: boolean = false,
  options?: {
    onNeedsIt2Setup?: (
      tmuxAvailable: boolean,
    ) => Promise<'installed' | 'use-tmux' | 'cancelled'>
  },
): Promise<TeammateExecutor> {
  if (preferInProcess && isInProcessEnabled()) {
    logForDebugging('[BackendRegistry] Using in-process executor')
    return getInProcessBackend()
  }

  try {
    logForDebugging('[BackendRegistry] Using pane backend executor')
    return await getPaneBackendExecutor(options)
  } catch (error) {
    if (getTeammateModeFromSnapshot() !== 'auto') {
      throw error
    }
    logForDebugging(
      `[BackendRegistry] No pane backend available, falling back to in-process: ${errorMessage(error)}`,
    )
    markInProcessFallback()
    return getInProcessBackend()
  }
}

/**
 * Gets the PaneBackendExecutor instance.
 * Creates and caches the instance on first call, detecting the appropriate pane backend.
 */
async function getPaneBackendExecutor(options?: {
  onNeedsIt2Setup?: (
    tmuxAvailable: boolean,
  ) => Promise<'installed' | 'use-tmux' | 'cancelled'>
}): Promise<TeammateExecutor> {
  const state = getRegistryState()
  if (!state.cachedPaneBackendExecutor) {
    const detection = await detectAndGetBackend()
    if (detection.needsIt2Setup && options?.onNeedsIt2Setup) {
      const setupResult = await options.onNeedsIt2Setup(await isTmuxAvailable())
      if (setupResult === 'cancelled') {
        throw new Error('Teammate spawn cancelled - iTerm2 setup required')
      }
      resetBackendDetection()
      return getPaneBackendExecutor(options)
    }
    state.cachedPaneBackendExecutor = createPaneBackendExecutor(
      detection.backend,
    )
    logForDebugging(
      `[BackendRegistry] Created PaneBackendExecutor wrapping ${detection.backend.type}`,
    )
  }
  return state.cachedPaneBackendExecutor
}

/**
 * Resets the backend detection cache.
 * Used for testing to allow re-detection.
 */
export function resetBackendDetection(): void {
  const state = getRegistryState()
  state.cachedBackend = null
  state.cachedDetectionResult = null
  state.cachedInProcessBackend = null
  state.cachedPaneBackendExecutor = null
  backendsRegistered = false
  state.inProcessFallbackActive = false
}
