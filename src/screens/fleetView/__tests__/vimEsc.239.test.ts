import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { shouldFleetViewVimHandleEscape } from '../helpers.js'

const AGENT_VIEW = readFileSync(
  join(import.meta.dir, '../../AgentView.tsx'),
  'utf8',
)
const NAV = readFileSync(
  join(import.meta.dir, '../../../hooks/useBackgroundTaskNavigation.ts'),
  'utf8',
)

describe('densable 2.1.239 #29 agent-view vim Esc', () => {
  test('JIy: INSERT + dispatch keeps text (does not clear)', () => {
    expect(shouldFleetViewVimHandleEscape('INSERT', true, 'draft')).toBe(true)
    expect(shouldFleetViewVimHandleEscape('INSERT', true, '')).toBe(true)
  })

  test('JIy: NORMAL + nonempty stays with vim; empty falls through', () => {
    expect(shouldFleetViewVimHandleEscape('NORMAL', true, 'draft')).toBe(true)
    expect(shouldFleetViewVimHandleEscape('NORMAL', true, '')).toBe(false)
  })

  test('JIy: vim off (undefined) or list-focus clears', () => {
    expect(shouldFleetViewVimHandleEscape(undefined, true, 'draft')).toBe(false)
    expect(shouldFleetViewVimHandleEscape('INSERT', false, 'draft')).toBe(false)
  })

  test('AgentView dispatch Esc calls JIy gate then leftover u(t)', () => {
    expect(AGENT_VIEW).toContain(
      'shouldFleetViewVimHandleEscape(fleetVim, true, dispatchInput)',
    )
    expect(AGENT_VIEW).toContain('dispatchVim.onInput')
    expect(AGENT_VIEW).toContain('useVimInput')
    expect(AGENT_VIEW).toContain('navigateFleetViewByArrow')
    expect(AGENT_VIEW).toContain('shouldFleetViewArrowDelegateToEditor')
    expect(AGENT_VIEW).toContain('shouldFleetViewTabToggleAllAgents')
    expect(AGENT_VIEW).toContain('shouldFleetViewRightOpenFocusedRow')
    expect(AGENT_VIEW).toContain('shouldFleetViewSimpleViewSkipLeftover')
    expect(AGENT_VIEW).toContain('shouldFleetViewCycleGroupMode')
    expect(AGENT_VIEW).toContain('shouldFleetViewEnterBashFromBang')
    expect(AGENT_VIEW).toContain('shouldFleetViewToggleHelp')
    expect(AGENT_VIEW).toContain('setHelpOpen(open => !open)')
    expect(AGENT_VIEW).toContain('isFleetComposerActive')
    expect(AGENT_VIEW).toContain(
      '// Official leftover u(t) — always GP. No focusArea gate.',
    )
    expect(AGENT_VIEW).toContain('shouldFleetViewReorder')
    expect(AGENT_VIEW).toContain('isFleetImagePasteKey')
    expect(AGENT_VIEW).toContain('materializeFleetPastedImages')
    expect(AGENT_VIEW).toContain('planFleetReorder')
    expect(AGENT_VIEW).toContain('formatFleetImagePlaceholder')
    expect(AGENT_VIEW).not.toContain('DispatchRequest.image')
    expect(AGENT_VIEW).toContain('setPreviewOpen')
    expect(AGENT_VIEW).toContain('schedulePeekTap')
    expect(AGENT_VIEW).toContain('cancelPeekTap')
    expect(AGENT_VIEW).toContain('buildFleetComposerSuggestions')
    expect(AGENT_VIEW).not.toContain(
      "if (focusArea !== 'dispatch' && !showAllAgents)",
    )
    expect(AGENT_VIEW).not.toContain(
      "if (dispatchInput.startsWith('/')) {\n      if (focusArea !== 'dispatch')",
    )
    expect(AGENT_VIEW).toContain('showAllAgents')
    expect(AGENT_VIEW).toContain("type: 'login'")
    expect(AGENT_VIEW).toContain('openNewSessionRow')
    expect(AGENT_VIEW).toContain('waitForFleetJobByShort')
    expect(AGENT_VIEW).toContain('migrateAgentLastUsedFromJobs')
    expect(AGENT_VIEW).toContain('agentLastUsed')
    expect(AGENT_VIEW).toContain("source: 'shell'")
    expect(AGENT_VIEW).not.toContain("launch.mode: 'shell'")
    expect(AGENT_VIEW).not.toMatch(
      /if \(key\.tab\) \{\s*setFocusArea\('dispatch'\)/,
    )
    expect(AGENT_VIEW).toContain("setVimMode('INSERT')")
    expect(AGENT_VIEW).not.toContain('!key.return && !key.tab && !key.escape')
    expect(AGENT_VIEW).not.toContain(
      'selectRowByKeyboard(Math.max(0, flatRows.length - 1))',
    )
  })

  test('viewing-agent Esc does not steal vim INSERT', () => {
    expect(NAV).toContain("getPromptInputStoreVimMode() === 'INSERT'")
    expect(NAV).toContain('isVimModeEnabled()')
  })
})
