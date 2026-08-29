/**
 * densable bp.legacyDialogFocus + uQc / oIA / zIr (239 SEA).
 */
import { describe, expect, test, beforeEach } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  clearLegacyDialogFocus,
  getDialogSuppressReason,
  getLegacyDialogFocus,
  legacyFocusForUqc,
  resetLegacyDialogFocusForTests,
  setLegacyDialogFocus,
  UQC_FOCUS_ALLOWLIST_FOR_TEST,
} from '../legacyDialogFocus.js'
import {
  resetPromptInputCursorStoreForTests,
  setPromptInputStoreActive,
} from '../../utils/promptInputCursorStore.js'
import { getModalChromeVisibility } from '../DialogHost.js'

const replSrc = readFileSync(
  join(import.meta.dir, '../../screens/REPL.tsx'),
  'utf8',
)

beforeEach(() => {
  resetLegacyDialogFocusForTests()
  resetPromptInputCursorStoreForTests()
})

describe('legacyDialogFocus (densable uQc / oIA)', () => {
  test('uQc sets and clears focus', () => {
    expect(getLegacyDialogFocus()).toBe(null)
    setLegacyDialogFocus('message-selector')
    expect(getLegacyDialogFocus()).toBe('message-selector')
    clearLegacyDialogFocus()
    expect(getLegacyDialogFocus()).toBe(null)
  })

  test('setState is a no-op when focus unchanged', () => {
    setLegacyDialogFocus('elicitation')
    setLegacyDialogFocus('elicitation')
    expect(getLegacyDialogFocus()).toBe('elicitation')
  })
})

describe('legacyFocusForUqc (gold _Zt allowlist)', () => {
  test('passes gold _Zt / tip overlay focus through', () => {
    expect(legacyFocusForUqc('message-selector')).toBe('message-selector')
    expect(legacyFocusForUqc('left-arrow-confirm')).toBe('left-arrow-confirm')
    expect(legacyFocusForUqc('elicitation')).toBe('elicitation')
    expect(legacyFocusForUqc('worker-sandbox-permission')).toBe(
      'worker-sandbox-permission',
    )
    expect(legacyFocusForUqc('effort-callout')).toBe('effort-callout')
    expect(legacyFocusForUqc('prompt')).toBe('prompt')
    expect(legacyFocusForUqc(undefined)).toBe(null)
    expect(legacyFocusForUqc(null)).toBe(null)
  })

  test('allowlist covers gold _Zt returns', () => {
    for (const id of [
      'message-selector',
      'left-arrow-confirm',
      'worker-sandbox-permission',
      'elicitation',
      'ultraplan-choice',
      'ultraplan-launch',
      'remote-callout',
      'fullscreen-upsell',
      'lsp-recommendation',
      'plugin-hint',
    ]) {
      expect(UQC_FOCUS_ALLOWLIST_FOR_TEST.has(id)).toBe(true)
      expect(legacyFocusForUqc(id)).toBe(id)
    }
  })

  test('Host-owned / unknown stay out of uQc (else dQc self-suppresses)', () => {
    expect(legacyFocusForUqc('tool-permission')).toBe(null)
    expect(legacyFocusForUqc('managed-settings')).toBe(null)
    expect(legacyFocusForUqc('peer_inbound_approval')).toBe(null)
    expect(legacyFocusForUqc('future-host-kind')).toBe(null)
    setLegacyDialogFocus(legacyFocusForUqc('tool-permission'))
    expect(getDialogSuppressReason()).toBe(null)
    setPromptInputStoreActive(true)
    expect(getDialogSuppressReason()).toBe('typing')
  })
})

describe('zIr (legacy + IW.active)', () => {
  test('none when idle', () => {
    expect(getDialogSuppressReason()).toBe(null)
  })

  test('legacy-dialog wins over typing', () => {
    setPromptInputStoreActive(true)
    setLegacyDialogFocus('message-selector')
    expect(getDialogSuppressReason()).toBe('legacy-dialog')
  })

  test('typing when IW.active and no legacy focus', () => {
    setPromptInputStoreActive(true)
    expect(getDialogSuppressReason()).toBe('typing')
  })

  test('RPs suppressed for either zIr arm', () => {
    setLegacyDialogFocus('effort-callout')
    expect(
      getModalChromeVisibility({
        hasOpenDialogs: true,
        suppressReason: getDialogSuppressReason(),
      }),
    ).toBe('suppressed')
    clearLegacyDialogFocus()
    setPromptInputStoreActive(true)
    expect(
      getModalChromeVisibility({
        hasOpenDialogs: true,
        suppressReason: getDialogSuppressReason(),
      }),
    ).toBe('suppressed')
  })
})

describe('REPL densable uQc sync', () => {
  test('useLayoutEffect mirrors via legacyFocusForUqc (not raw focusedInputDialog)', () => {
    expect(replSrc).toContain(
      'setLegacyDialogFocus(legacyFocusForUqc(focusedInputDialog))',
    )
    expect(replSrc).not.toContain(
      'setLegacyDialogFocus(focusedInputDialog ?? null)',
    )
    expect(replSrc).toContain('return () => setLegacyDialogFocus(null)')
    expect(replSrc).toContain('setPromptInputStoreActive')
  })

  test('REPL derives zIr same-render (no useSyncExternalStore tear on keystroke)', () => {
    // Tear: setPromptInputStoreActive inside setInputValue notifies subscribers
    // before React commits inputValue/isPromptInputActive → one-frame flash.
    expect(replSrc).not.toContain('useDialogSuppressReason')
    expect(replSrc).toContain('legacyFocusForUqc(focusedInputDialog) != null')
    expect(replSrc).toContain("? ('legacy-dialog' as const)")
    expect(replSrc).toContain("? ('typing' as const)")
    // hyr synced after commit, not inline in setInputValue
    expect(replSrc).toContain('setPromptInputStoreActive(isPromptInputActive)')
    // Must not hyr-notify from inside setInputValue (comment may mention the name)
    expect(replSrc).not.toContain('setPromptInputStoreActive(active)')
  })
})
