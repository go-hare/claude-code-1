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

  test('AgentView dispatch Esc calls JIy gate', () => {
    expect(AGENT_VIEW).toContain(
      'shouldFleetViewVimHandleEscape(fleetVim, true, dispatchInput)',
    )
    expect(AGENT_VIEW).toContain("setVimMode('NORMAL')")
    expect(AGENT_VIEW).toContain("setVimMode('INSERT')")
  })

  test('viewing-agent Esc does not steal vim INSERT', () => {
    expect(NAV).toContain("getPromptInputStoreVimMode() === 'INSERT'")
    expect(NAV).toContain('isVimModeEnabled()')
  })
})
