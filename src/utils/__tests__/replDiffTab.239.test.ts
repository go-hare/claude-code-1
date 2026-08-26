/**
 * densable 2.1.239 tengu_willow_crate REPL diff tab (Jqh / Ocs / Mcs / BUo).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { saveGlobalConfig } from '../config.js'
import {
  DIFF_SIDEBAR_AUTO_OPEN_MIN_COLS,
  DIFF_SIDEBAR_MIN_COLS,
  DIFF_SIDEBAR_NO_GIT_MESSAGE,
  DIFF_PANEL_UNAVAILABLE_MESSAGE,
  computeDiffSidebarWidth,
  cycleDiffBaseMode,
  getPersistedDiffBaseMode,
  openReplDiffTabFromAutoOpen,
  replDiffTerminalWidthBucket,
  resetReplTabToConvo,
  shouldAutoOpenDiffSidebar,
  toggleReplDiffTab,
  type ReplTab,
} from '../replDiffTab.js'

const src = readFileSync(join(import.meta.dir, '../replDiffTab.ts'), 'utf8')
const toggle = readFileSync(
  join(import.meta.dir, '../../components/diff/ToggleDiffSidebar.tsx'),
  'utf8',
)
const cmd = readFileSync(
  join(import.meta.dir, '../../commands/diff/index.ts'),
  'utf8',
)
const call = readFileSync(
  join(import.meta.dir, '../../commands/diff/diff.tsx'),
  'utf8',
)

afterEach(() => {
  saveGlobalConfig(c => ({
    ...c,
    diffSidebarOpen: undefined,
    diffSidebarBaseMode: undefined,
  }))
})

describe('densable 2.1.239 willow crate source lock', () => {
  test('Jqh constants and official strings', () => {
    expect(DIFF_SIDEBAR_MIN_COLS).toBe(110)
    expect(DIFF_SIDEBAR_AUTO_OPEN_MIN_COLS).toBe(144)
    expect(DIFF_SIDEBAR_NO_GIT_MESSAGE).toBe(
      'The diff panel shows git changes \u2014 the current directory isn\u2019t in a git repository',
    )
    expect(DIFF_PANEL_UNAVAILABLE_MESSAGE).toBe(
      'The diff panel isn\u2019t available right now \u2014 run /diff again to see your changes',
    )
    expect(src).toContain('findGitRootUncached(getCwd())')
    expect(src).toContain('tab: next as AnalyticsMetadata')
    expect(src).toContain('tengu_repl_diff_panel_shown')
  })

  test('jDl description + immediate + uH0 branch', () => {
    expect(cmd).toContain('Toggle the diff panel showing uncommitted changes')
    expect(cmd).toContain('View uncommitted changes and per-turn diffs')
    expect(cmd).toContain('if (getIsRemoteMode()) return false')
    expect(cmd).toContain('isWillowCrateEnabled()')
    expect(cmd).toContain('isFullscreenEnvEnabled()')
    expect(call).toContain('dispatchedAsImmediate')
    expect(call).toContain('ToggleDiffSidebar')
    expect(call).toContain('DiffDialog')
    expect(toggle).toContain("replTab !== 'diff'")
    expect(toggle).toContain("display: 'system'")
    expect(toggle).toContain("display: 'skip'")
  })
})

describe('densable 2.1.239 Ocs / qVt / QXA', () => {
  test('toggle flips convo↔diff and clears panelFileView', () => {
    const host = {}
    let state: { replTab: ReplTab; panelFileView: { path: string } | null } = {
      replTab: 'convo',
      panelFileView: { path: 'a.ts' },
    }
    const next = toggleReplDiffTab(
      host,
      updater => {
        state = updater(state as never)
      },
      'convo',
    )
    expect(next).toBe('diff')
    expect(state.replTab).toBe('diff')
    expect(state.panelFileView).toBeNull()
    const back = toggleReplDiffTab(
      host,
      updater => {
        state = updater(state as never)
      },
      'diff',
    )
    expect(back).toBe('convo')
    expect(state.replTab).toBe('convo')
  })

  test('reset stays on convo without a write when already clean', () => {
    const host = {}
    let writes = 0
    const clean = { replTab: 'convo' as const, panelFileView: null }
    resetReplTabToConvo(host, updater => {
      writes++
      updater(clean as never)
    })
    expect(writes).toBe(1)
  })

  test('QXA only opens convo→diff', () => {
    expect(
      openReplDiffTabFromAutoOpen({
        replTab: 'convo',
      } as never).replTab,
    ).toBe('diff')
    const already = { replTab: 'diff' as const }
    expect(openReplDiffTabFromAutoOpen(already as never)).toBe(already as never)
  })
})

describe('densable 2.1.239 Mcs / BUo / W7A / Ncs', () => {
  test('width is 0 when GB off or not the main diff tab', () => {
    const base = {
      willowCrateEnabled: true,
      isFullscreen: true,
      isThinClient: false,
      isMain: true,
      replTab: 'diff' as const,
      columns: 200,
      hasGitRepo: true,
    }
    expect(computeDiffSidebarWidth(base)).toBe(
      Math.min(Math.floor(200 * 0.45), 90, 200 - 70),
    )
    expect(
      computeDiffSidebarWidth({ ...base, willowCrateEnabled: false }),
    ).toBe(0)
    expect(computeDiffSidebarWidth({ ...base, replTab: 'convo' })).toBe(0)
    expect(computeDiffSidebarWidth({ ...base, columns: 109 })).toBe(0)
    expect(computeDiffSidebarWidth({ ...base, hasGitRepo: false })).toBe(0)
    expect(computeDiffSidebarWidth({ ...base, isMain: false })).toBe(0)
  })

  test('width buckets match W7A', () => {
    expect(replDiffTerminalWidthBucket(109)).toBe('under_110')
    expect(replDiffTerminalWidthBucket(110)).toBe('110_to_143')
    expect(replDiffTerminalWidthBucket(144)).toBe('144_to_199')
    expect(replDiffTerminalWidthBucket(200)).toBe('200_plus')
  })

  test('base mode defaults to session and cycles Pec', () => {
    expect(getPersistedDiffBaseMode()).toBe('session')
    expect(cycleDiffBaseMode('session')).toBe('uncommitted')
    expect(getPersistedDiffBaseMode()).toBe('uncommitted')
    expect(cycleDiffBaseMode('uncommitted')).toBe('branch')
    expect(cycleDiffBaseMode('branch')).toBe('session')
  })

  test('Mcs pins closed when diffSidebarOpen===false', () => {
    saveGlobalConfig(c => ({ ...c, diffSidebarOpen: false }))
    expect(shouldAutoOpenDiffSidebar(200)).toBe(false)
  })
})
