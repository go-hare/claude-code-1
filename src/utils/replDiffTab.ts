import { useEffect, useRef } from 'react'
import { getSessionId } from '../bootstrap/state.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../services/analytics/index.js'
import { logEvent } from '../services/analytics/index.js'
import type { AppState } from '../state/AppStateStore.js'
import { getGlobalConfig, saveGlobalConfig } from './config.js'
import { getCwd } from './cwd.js'
import { findGitRootUncached } from './git.js'
import { isWillowCrateEnabled } from './willowCrate.js'

/** densable `G8e` */
export const DIFF_SIDEBAR_MIN_COLS = 110
/** densable `Hcs` */
export const DIFF_SIDEBAR_AUTO_OPEN_MIN_COLS = 144

/**
 * densable `Pcs` — em dash + curly apostrophe, same as official.
 */
export const DIFF_SIDEBAR_NO_GIT_MESSAGE =
  'The diff panel shows git changes \u2014 the current directory isn\u2019t in a git repository'

/**
 * densable h0c refusal when opening while `P6e()` is off.
 */
export const DIFF_PANEL_UNAVAILABLE_MESSAGE =
  'The diff panel isn\u2019t available right now \u2014 run /diff again to see your changes'

/** densable `Pec` */
export const DIFF_BASE_MODES = ['session', 'uncommitted', 'branch'] as const
export type DiffBaseMode = (typeof DIFF_BASE_MODES)[number]

/** Zmu leftover dump truncates before JSX; keep the existing uncommitted copy. */
export const REPL_DIFF_EMPTY_UNCOMMITTED = 'No uncommitted changes'
export const REPL_DIFF_EMPTY_SESSION = 'No session changes'
export const REPL_DIFF_EMPTY_BRANCH = 'No branch changes'

export type ReplDiffListFile = {
  path: string
  linesAdded: number
  linesRemoved: number
  preSession?: boolean
}

export type ReplDiffEmptySource =
  | { kind: 'working-tree' }
  | { kind: 'branch'; baseBranch: string }

/** densable Zmu — main list drops `_zS` preSession rows. */
export function replDiffVisibleFiles<T extends { preSession?: boolean }>(
  files: readonly T[],
): T[] {
  return files.filter(file => !file.preSession)
}

/** Header +/- follows the visible list, not working-tree `stats`. */
export function replDiffVisibleStats(
  files: readonly Pick<ReplDiffListFile, 'linesAdded' | 'linesRemoved'>[],
): { filesCount: number; linesAdded: number; linesRemoved: number } {
  let linesAdded = 0
  let linesRemoved = 0
  for (const file of files) {
    linesAdded += file.linesAdded
    linesRemoved += file.linesRemoved
  }
  return { filesCount: files.length, linesAdded, linesRemoved }
}

/**
 * densable Zmu `H1s` — first loop sums only `preSession` rows.
 */
export function replDiffPreSessionStats(files: readonly ReplDiffListFile[]): {
  filesCount: number
  linesAdded: number
  linesRemoved: number
} {
  let filesCount = 0
  let linesAdded = 0
  let linesRemoved = 0
  for (const file of files) {
    if (!file.preSession) continue
    filesCount += 1
    linesAdded += file.linesAdded
    linesRemoved += file.linesRemoved
  }
  return { filesCount, linesAdded, linesRemoved }
}

/**
 * Empty copy follows `baseMode` / `source`. Leftover Zmu dump ends
 * before the empty-string JSX; `H1s` is the preSession footer stats,
 * not a second empty sentence.
 */
export function replDiffEmptyCopy(
  baseMode: DiffBaseMode,
  source: ReplDiffEmptySource,
): string {
  if (source.kind === 'branch') {
    return `No changes vs ${source.baseBranch}`
  }
  if (baseMode === 'session') return REPL_DIFF_EMPTY_SESSION
  if (baseMode === 'branch') return REPL_DIFF_EMPTY_BRANCH
  return REPL_DIFF_EMPTY_UNCOMMITTED
}

export type ReplTab = 'convo' | 'diff'

type ReplDiffHostState = {
  autoOpenPending: boolean
  lastLoggedSessionId?: string
}

const hostState = new WeakMap<object, ReplDiffHostState>()
const sessionHosts = new Map<string, object>()

function hostOf(host: object): ReplDiffHostState {
  let state = hostState.get(host)
  if (!state) {
    state = { autoOpenPending: false }
    hostState.set(host, state)
  }
  return state
}

/**
 * densable `ns().host` stand-in. Official keys a WeakMap on the session
 * host object; we keep one object per `getSessionId()`.
 */
export function getReplDiffHost(): object {
  const id = getSessionId()
  let host = sessionHosts.get(id)
  if (!host) {
    host = {}
    sessionHosts.set(id, host)
  }
  return host
}

/** densable `Dcs` */
export function markReplDiffPanelAutoOpen(host: object): void {
  hostOf(host).autoOpenPending = true
}

/** densable `Dec` */
export function consumeReplDiffPanelAutoOpen(host: object): boolean {
  const state = hostOf(host)
  const pending = state.autoOpenPending
  state.autoOpenPending = false
  return pending
}

/** densable `Mec` */
export function clearReplDiffPanelAutoOpen(host: object): void {
  hostOf(host).autoOpenPending = false
}

/** densable `VVt` — `amt(rr()) !== null` */
export function diffSidebarHasGitRepo(): boolean {
  return findGitRootUncached(getCwd()) !== null
}

/**
 * densable `Mcs(cols)`.
 * `diffSidebarOpen === false` pins closed; `true` uses 110; unset uses 144.
 */
export function shouldAutoOpenDiffSidebar(columns: number): boolean {
  const open = getGlobalConfig().diffSidebarOpen
  if (open === false) return false
  const min =
    open === true ? DIFF_SIDEBAR_MIN_COLS : DIFF_SIDEBAR_AUTO_OPEN_MIN_COLS
  return columns >= min && diffSidebarHasGitRepo()
}

type SetAppState = (updater: (prev: AppState) => AppState) => void

/** densable `Ocs` — omit official storageV5 third persist arg. */
export function toggleReplDiffTab(
  host: object,
  setAppState: SetAppState,
  currentTab: ReplTab,
): ReplTab {
  const next: ReplTab = currentTab === 'diff' ? 'convo' : 'diff'
  clearReplDiffPanelAutoOpen(host)
  setAppState(prev =>
    prev.replTab === next && prev.panelFileView === null
      ? prev
      : { ...prev, replTab: next, panelFileView: null },
  )
  const opening = next === 'diff'
  if (getGlobalConfig().diffSidebarOpen !== opening) {
    saveGlobalConfig(current => ({ ...current, diffSidebarOpen: opening }))
  }
  logEvent('repl_tab_switch', {
    tab: next as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  return next
}

/** densable `qVt` */
export function resetReplTabToConvo(
  host: object,
  setAppState: SetAppState,
): void {
  clearReplDiffPanelAutoOpen(host)
  setAppState(prev =>
    prev.replTab === 'convo' && prev.panelFileView === null
      ? prev
      : { ...prev, replTab: 'convo', panelFileView: null },
  )
}

/** densable `Lcs` */
export function closeReplDiffTab(host: object, setAppState: SetAppState): void {
  resetReplTabToConvo(host, setAppState)
  if (getGlobalConfig().diffSidebarOpen !== false) {
    saveGlobalConfig(current => ({ ...current, diffSidebarOpen: false }))
  }
  logEvent('repl_tab_switch', {
    tab: 'convo' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

/** densable `Ncs` — default `session`. */
export function getPersistedDiffBaseMode(): DiffBaseMode {
  const mode = getGlobalConfig().diffSidebarBaseMode
  return mode === 'uncommitted' || mode === 'branch' ? mode : 'session'
}

/** densable `$cs` */
export function cycleDiffBaseMode(
  current: DiffBaseMode,
  /** densable $cs(mode, storageV5) — unused locally. */
  _storageV5?: unknown,
): DiffBaseMode {
  const next =
    DIFF_BASE_MODES[
      (DIFF_BASE_MODES.indexOf(current) + 1) % DIFF_BASE_MODES.length
    ] ?? 'session'
  saveGlobalConfig(
    config =>
      config.diffSidebarBaseMode === next
        ? config
        : { ...config, diffSidebarBaseMode: next },
    _storageV5,
  )
  logEvent('repl_diff_base_switch', {
    mode: next as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  return next
}

/** densable `QXA` — auto-open only flips convo→diff; does not persist. */
export function openReplDiffTabFromAutoOpen(prev: AppState): AppState {
  return prev.replTab === 'convo' ? { ...prev, replTab: 'diff' } : prev
}

/** densable `W7A` */
export function replDiffTerminalWidthBucket(
  columns: number,
): 'under_110' | '110_to_143' | '144_to_199' | '200_plus' {
  if (columns < DIFF_SIDEBAR_MIN_COLS) return 'under_110'
  if (columns < DIFF_SIDEBAR_AUTO_OPEN_MIN_COLS) return '110_to_143'
  if (columns < 200) return '144_to_199'
  return '200_plus'
}

/** densable `amu` */
export function logReplDiffPanelShown(
  host: object,
  sessionId: string,
  columns: number,
): void {
  if (!isWillowCrateEnabled()) return
  const state = hostOf(host)
  const trigger = consumeReplDiffPanelAutoOpen(host) ? 'auto_open' : 'manual'
  if (sessionId === state.lastLoggedSessionId) return
  state.lastLoggedSessionId = sessionId
  logEvent('tengu_repl_diff_panel_shown', {
    trigger:
      trigger as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    terminal_width_bucket: replDiffTerminalWidthBucket(
      columns,
    ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

/**
 * densable width arm:
 * `NDr ? Vs() && !thin && isMain && replTab==="diff" && cols>=110 && git
 *    ? min(floor(cols*0.45), 90, cols-70) : 0 : 0`
 */
export function computeDiffSidebarWidth(args: {
  willowCrateEnabled: boolean
  isFullscreen: boolean
  isThinClient: boolean
  isMain: boolean
  replTab: ReplTab
  columns: number
  hasGitRepo: boolean
}): number {
  if (!args.willowCrateEnabled) return 0
  if (
    args.isFullscreen &&
    !args.isThinClient &&
    args.isMain &&
    args.replTab === 'diff' &&
    args.columns >= DIFF_SIDEBAR_MIN_COLS &&
    args.hasGitRepo
  ) {
    return Math.min(Math.floor(args.columns * 0.45), 90, args.columns - 70)
  }
  return 0
}

/**
 * densable `H$y(enabled, trackedCount, setState)`.
 * Returns the auto-open baseline (null once tracked files diverge).
 * GrowthBook on→off resets the tab to convo.
 */
export function useReplDiffAutoOpenBaseline(
  enabled: boolean,
  trackedFileCount: number,
  setAppState: SetAppState,
): number | null {
  const enabledRef = useRef(enabled)
  const baselineRef = useRef<number | null>(null)
  if (enabledRef.current !== enabled) {
    enabledRef.current = enabled
    baselineRef.current = enabled ? trackedFileCount : null
  } else if (
    baselineRef.current !== null &&
    trackedFileCount !== baselineRef.current
  ) {
    baselineRef.current = null
  }

  const sessionId = getSessionId()
  const host = getReplDiffHost()
  const sessionRef = useRef(sessionId)
  if (sessionRef.current !== sessionId) {
    sessionRef.current = sessionId
    baselineRef.current = null
  }

  const prevEnabledRef = useRef(enabled)
  useEffect(() => {
    const wasEnabled = prevEnabledRef.current
    prevEnabledRef.current = enabled
    if (wasEnabled && !enabled) {
      resetReplTabToConvo(host, setAppState)
    }
  }, [enabled, host, setAppState])

  return baselineRef.current
}
