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
  test('passes gold _Zt focus through; tip SUPERSET stays out of uQc', () => {
    expect(legacyFocusForUqc('message-selector')).toBe('message-selector')
    expect(legacyFocusForUqc('left-arrow-confirm')).toBe('left-arrow-confirm')
    expect(legacyFocusForUqc('elicitation')).toBe('elicitation')
    expect(legacyFocusForUqc('worker-sandbox-permission')).toBe(
      'worker-sandbox-permission',
    )
    expect(legacyFocusForUqc('effort-callout')).toBe(null)
    expect(legacyFocusForUqc('prompt')).toBe(null)
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
    for (const id of [
      'prompt',
      'effort-callout',
      'desktop-upsell',
      'model-switch',
      'undercover-callout',
      'search-extra-tools-hint',
    ]) {
      expect(UQC_FOCUS_ALLOWLIST_FOR_TEST.has(id)).toBe(false)
      expect(legacyFocusForUqc(id)).toBe(null)
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
    setLegacyDialogFocus('elicitation')
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

  test('gold _Zt overlay router: elicitation Be.queue, As/Ur/vr/ly order', () => {
    const start = replSrc.indexOf('function getFocusedInputDialog()')
    const end = replSrc.indexOf(
      'const focusedInputDialog = getFocusedInputDialog()',
      start,
    )
    const zt = replSrc.slice(start, end)
    expect(zt).toContain(
      "if (allowDialogsWithAnimation && elicitation.queue[0]) return 'elicitation'",
    )
    expect(zt).toContain('if (isBgSession())')
    expect(zt).toContain('viewingAgentTaskId != null')
    // Single-host: no Host peek / tip queue → focused tool-permission
    expect(zt).not.toContain("return 'tool-permission'")
    expect(zt).not.toContain("return 'managed-settings'")
    expect(zt).not.toContain('isPermissionPromptDialog(topDialogKind)')
    expect(zt).not.toContain('isManagedSettingsSecurityDialog(topDialogKind)')
    expect(zt).not.toContain('toolUseConfirmQueue[0]) return')
    // Gold As() exits whole function — no SUPERSET after bg
    const bg = zt.indexOf('if (isBgSession())')
    const bgBlock = zt.slice(
      bg,
      zt.indexOf('if (allowDialogsWithAnimation && showFullscreenUpsell)'),
    )
    expect(bgBlock).toContain('return undefined')
    const fs = zt.indexOf(
      "if (allowDialogsWithAnimation && showFullscreenUpsell) return 'fullscreen-upsell'",
    )
    const remote = zt.indexOf(
      "if (allowDialogsWithAnimation && showRemoteCallout) return 'remote-callout'",
      fs,
    )
    const lsp = zt.indexOf(
      "if (allowDialogsWithAnimation && lspRecommendation && !viewingAgent) return 'lsp-recommendation'",
    )
    const plugin = zt.indexOf(
      "if (allowDialogsWithAnimation && hintRecommendation && !viewingAgent) return 'plugin-hint'",
    )
    expect(fs).toBeGreaterThan(-1)
    expect(remote).toBeGreaterThan(fs)
    expect(lsp).toBeGreaterThan(remote)
    expect(plugin).toBeGreaterThan(lsp)
    expect(zt).toContain("if (pke.kind !== 'none') return undefined")
    expect(zt).toContain("return 'left-arrow-confirm'")
    expect(zt).toContain('leftArrowConfirm')
    expect(zt).not.toContain("return 'prompt'")
    expect(zt).not.toContain("return 'effort-callout'")
    expect(zt).not.toContain('tip SUPERSET extras')
    expect(replSrc).toContain('function getTipNonGoldOverlay()')
    expect(replSrc).toContain('const tipOverlay = getTipNonGoldOverlay()')
    expect(replSrc).toContain(
      'if (hasOpenDialogs || hasBlockingOpenDialogs) return undefined',
    )
    expect(replSrc).toContain("setPke({ kind: 'shutting-down' })")
    // densable wZt: onDone:()=>{} + Qn clear; no onBeforeExit (iwg is wO0/TTc)
    expect(replSrc).toContain('onDone={() => {}}')
    expect(replSrc).toContain("const clearPke = () => setPke({ kind: 'none' })")
    expect(replSrc).not.toContain(
      "onBeforeExit={() => setPke({ kind: 'shutting-down' })}",
    )
    expect(replSrc).not.toContain(
      "prev.kind === 'shutting-down' ? prev : { kind: 'none' }",
    )
    expect(replSrc).toContain(
      'const anyInputOverlay = focusedInputDialog ?? tipOverlay',
    )
    // densable yMe — nHt | Fe | Be only
    expect(replSrc).toContain('hasBlockingOpenDialogs ||')
    expect(replSrc).toContain('leftArrowConfirm != null')
    expect(replSrc).toContain("pke.kind === 'dialog'")
    expect(replSrc).toContain('workerSandboxPermissions.queue[0] ||')
    expect(replSrc).toContain('elicitation.queue[0]);')
    expect(replSrc).not.toContain(
      'toolUseConfirmQueue[0] ||\n      promptQueue[0]',
    )
    expect(replSrc).toContain('<ElicitationDialog')
    expect(replSrc).toContain("focusedInputDialog === 'elicitation'")
  })

  test('Host permission side-effects bind open-stack, not focused peek', () => {
    expect(replSrc).toContain('hostPermissionOpen')
    expect(replSrc).toContain('const isPaused = viewingAgentTaskId != null')
    expect(replSrc).not.toContain("focusedInputDialog === 'tool-permission'")
    const promptSrc = readFileSync(
      join(import.meta.dir, '../../components/PromptInput/PromptInput.tsx'),
      'utf8',
    )
    expect(promptSrc).toContain('useHasBlockingOpenDialogs')
    expect(promptSrc).toContain('hostBlocksKeys')
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
