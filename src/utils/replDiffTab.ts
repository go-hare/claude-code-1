import { isAbsolute, join } from 'path'
import { useEffect, useRef } from 'react'
import { getSessionId } from '../bootstrap/state.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../services/analytics/index.js'
import { logEvent } from '../services/analytics/index.js'
import type { AppState } from '../state/AppStateStore.js'
import type { ToolPermissionContext } from '../Tool.js'
import { getGlobalConfig, saveGlobalConfig } from './config.js'
import { getCwd } from './cwd.js'
import { isGeneratedFile, isTestFile } from './generatedFiles.js'
import { findGitRootUncached } from './git.js'
import { matchingRuleForInput } from './permissions/filesystem.js'
import { isDiffPanelEnabled } from './willowCrate.js'
import { getReplDiffHost } from './sessionHost.js'

export { getReplDiffHost } from './sessionHost.js'

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
export const REPL_DIFF_EMPTY_SESSION = 'No changes this session'
export const DIFF_PANEL_SHOWN_MESSAGE = 'Diff panel shown'
export const DIFF_PANEL_HIDDEN_MESSAGE = 'Diff panel hidden'
/** densable `bX` — visible file rows in the uncommitted panel list. */
export const REPL_DIFF_LIST_WINDOW = 8
/** densable `kX` — hide per-file hunks in the preSession expander above this. */
export const REPL_DIFF_PRESESSION_HUNKS_CAP = 20
/** densable `n3` / `P$` */
export const REPL_DIFF_ARROW_UP = '↑'
export const REPL_DIFF_ARROW_DOWN = '↓'
export const REPL_DIFF_EMPTY_BRANCH = 'No changes vs HEAD'
export const REPL_DIFF_UNAVAILABLE_HEADLINE = 'Diff unavailable'
export const REPL_DIFF_UNAVAILABLE_HINT =
  "Couldn't read the git diff — it will retry on the next change"
export const REPL_DIFF_NO_COMMITS_HEADLINE = 'No commits yet'
export const REPL_DIFF_NO_COMMITS_HINT =
  "Nothing to diff against until the repo's first commit"
export const REPL_DIFF_NO_BASE_BRANCH_HINT =
  'No base branch to compare against — showing changes vs HEAD'
export const REPL_DIFF_TOO_MANY_HEADLINE = 'Too many changed files to show diff'
export const REPL_DIFF_TOO_MANY_HINT =
  'Per-file diff is skipped above 500 files'
export const REPL_DIFF_STAGED_NO_COMMITS =
  'no commits yet — showing staged and new files'

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

export type ReplDiffEmptyCopy = {
  headline: string
  hint: string | null
}

/**
 * densable Obe `En`/`ss` when `Ps===0` (visible stats empty after preSession
 * subtract). `stats===null` is the unavailable arm.
 */
export function replDiffEmptyCopy(
  baseMode: DiffBaseMode,
  source: ReplDiffEmptySource,
  noCommits = false,
): ReplDiffEmptyCopy {
  if (noCommits) {
    return {
      headline: REPL_DIFF_NO_COMMITS_HEADLINE,
      hint: REPL_DIFF_NO_COMMITS_HINT,
    }
  }
  if (baseMode === 'uncommitted') {
    return { headline: REPL_DIFF_EMPTY_UNCOMMITTED, hint: null }
  }
  if (baseMode === 'branch') {
    if (source.kind === 'branch') {
      return { headline: `No changes vs ${source.baseBranch}`, hint: null }
    }
    return {
      headline: REPL_DIFF_EMPTY_BRANCH,
      hint: REPL_DIFF_NO_BASE_BRANCH_HINT,
    }
  }
  return { headline: REPL_DIFF_EMPTY_SESSION, hint: null }
}

/**
 * densable Obe `ll` when the fetch has files but the visible list is empty
 * (all denied / noise / both).
 */
export function replDiffHiddenEmptyCopy(
  deniedHidden: number,
  noiseHidden: number,
): ReplDiffEmptyCopy {
  if (deniedHidden > 0 && noiseHidden > 0) {
    return {
      headline: 'Only hidden files changed',
      hint: 'Read-denied, test, and generated files are hidden in this panel',
    }
  }
  if (deniedHidden > 0) {
    return {
      headline: 'Only read-denied files changed',
      hint: 'Read-denied files are hidden in this panel',
    }
  }
  return {
    headline: 'Only tests and generated files changed',
    hint: 'Tests and generated files are hidden · click "show" above to view them',
  }
}

/**
 * densable `Rtt(requested, source, requested!==fetched)`.
 */
export function replDiffRequestedModeLabel(
  requested: DiffBaseMode,
  source: ReplDiffEmptySource,
  fetching: boolean,
): string {
  let label: string
  switch (requested) {
    case 'session':
      label = 'this session'
      break
    case 'uncommitted':
      label = 'uncommitted (vs HEAD)'
      break
    case 'branch':
      if (source.kind === 'branch') {
        label = `branch vs ${source.baseBranch}`
      } else {
        label = fetching ? 'branch diff' : 'vs HEAD (no base branch)'
      }
      break
  }
  return fetching ? `${label}…` : label
}

export type ReplDiffPartition<
  T extends { path: string; preSession?: boolean },
> = {
  files: T[]
  preSessionFiles: T[]
  noiseCount: number
  deniedHidden: number
}

/**
 * densable Obe filter: deny → preSession → WUn/LTr noise.
 */
export function partitionReplDiffFiles<
  T extends { path: string; preSession?: boolean },
>(
  files: readonly T[],
  isDenied: (path: string) => boolean,
  showNoise: boolean,
): ReplDiffPartition<T> {
  let noiseCount = 0
  let deniedHidden = 0
  const visible: T[] = []
  const preSessionFiles: T[] = []
  for (const file of files) {
    if (isDenied(file.path)) {
      deniedHidden++
      continue
    }
    if (file.preSession) {
      preSessionFiles.push(file)
      continue
    }
    if (isGeneratedFile(file.path) || isTestFile(file.path)) {
      noiseCount++
      if (!showNoise) continue
    }
    visible.push(file)
  }
  return { files: visible, preSessionFiles, noiseCount, deniedHidden }
}

/** densable `Ra(Ket(cwd, path), ctx, "read", "deny")` */
export function replDiffPathIsReadDenied(
  cwd: string,
  relPath: string,
  permissionContext: ToolPermissionContext,
): boolean {
  const abs = isAbsolute(relPath) ? relPath : join(cwd, relPath)
  return matchingRuleForInput(abs, permissionContext, 'read', 'deny') !== null
}

export type ReplTab = 'convo' | 'diff'

type ReplDiffHostState = {
  autoOpenPending: boolean
  lastLoggedSessionId?: string
}

const hostState = new WeakMap<object, ReplDiffHostState>()

function hostOf(host: object): ReplDiffHostState {
  let state = hostState.get(host)
  if (!state) {
    state = { autoOpenPending: false }
    hostState.set(host, state)
  }
  return state
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

/**
 * densable Z6t + s8r — `/diff` fullscreen toast path.
 */
export function toggleDiffPanelForSlash(
  host: object,
  setAppState: SetAppState,
  getReplTab: () => ReplTab,
  columns: number,
): string {
  const current = getReplTab()
  if (current === 'diff') {
    toggleReplDiffTab(host, setAppState, current)
    return DIFF_PANEL_HIDDEN_MESSAGE
  }
  if (!isDiffPanelEnabled()) return DIFF_PANEL_UNAVAILABLE_MESSAGE
  if (!diffSidebarHasGitRepo()) return DIFF_SIDEBAR_NO_GIT_MESSAGE
  if (columns < DIFF_SIDEBAR_MIN_COLS) {
    return `Resize your terminal to at least ${DIFF_SIDEBAR_MIN_COLS} columns to show the diff panel`
  }
  toggleReplDiffTab(host, setAppState, current)
  return DIFF_PANEL_SHOWN_MESSAGE
}

/** densable `amu` */
export function logReplDiffPanelShown(
  host: object,
  sessionId: string,
  columns: number,
): void {
  if (!isDiffPanelEnabled()) return
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
