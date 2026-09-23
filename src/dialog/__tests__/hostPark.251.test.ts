import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getHostParkMode, pickNextHostOffer } from '../hostPark.js'

describe('Host park (251 #65 Vd / G$)', () => {
  test('Vd prefers draft over typing', () => {
    expect(
      getHostParkMode({
        hasLegacyDialog: false,
        hasBlockingToolProgress: false,
        hasLocalJsxPanel: false,
        hasDraft: true,
        isPromptInputActive: true,
      }),
    ).toBe('draft')
  })

  test('G$ withholds effort-medium while the prompt is active', () => {
    expect(
      pickNextHostOffer({
        exitFlowActive: false,
        isPromptInputActive: true,
        hasBlockingToolProgress: false,
        hasLocalJsxPanel: false,
        hasElicitationRequest: false,
        leftArrowConfirmOpen: false,
        isLoading: false,
        isBgSession: false,
        hasEffortMediumNudge: true,
        hasOpenDialog: false,
      }),
    ).toBeUndefined()
    expect(
      pickNextHostOffer({
        exitFlowActive: false,
        isPromptInputActive: false,
        hasBlockingToolProgress: false,
        hasLocalJsxPanel: false,
        hasElicitationRequest: false,
        leftArrowConfirmOpen: false,
        isLoading: false,
        isBgSession: false,
        hasEffortMediumNudge: true,
        hasOpenDialog: false,
      }),
    ).toBe('effort-medium-nudge')
  })

  test('REPL gates plugin/LSP on draft and effort on G$', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../screens/REPL.tsx'),
      'utf8',
    )
    expect(src).toContain("if (inputValue.trim() !== '') return undefined")
    expect(src).toContain(
      "if (nextHostOffer === 'effort-medium-nudge') return 'effort-callout'",
    )
  })

  test('REPL uses jx as modal chrome instead of voiding it', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../screens/REPL.tsx'),
      'utf8',
    )
    expect(src).toContain('const modalChrome = hostDialogVisibility')
    expect(src).not.toContain('void hostDialogVisibility')
  })
})
