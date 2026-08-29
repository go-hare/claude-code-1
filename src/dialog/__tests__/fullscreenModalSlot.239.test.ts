/**
 * densable ozs / RPs / KA (239 SEA gold):
 *   RPs() = !open?"none":zIr()!=null?"suppressed":"visible"
 *   KA = Bsu()==="modal"
 *   ozs = KA ? {content:NMs(modal), visible:wi==="visible"}
 *       : PCn ? {content:PCn, visible:true} : undefined
 * FullscreenLayout (Tyn): zkr=fCt?.visible; pane display:zkr?"flex":"none";
 * bottom chrome display:zkr?"none":"flex".
 *
 * Gold mLo only maps EQr (permission_exit_plan_mode_v2) → modal.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  getDialogHostLayout,
  getModalChromeVisibility,
  isFullscreenModalChromeActive,
  isTopDialogModalLayout,
  shouldOccupyFullscreenModalSlot,
} from '../DialogHost.js'
import { PERMISSION_EXIT_PLAN_MODE_V2_KIND } from '../specs/permissionKinds.js'

const replSrc = readFileSync(
  join(import.meta.dir, '../../screens/REPL.tsx'),
  'utf8',
)
const layoutSrc = readFileSync(
  join(import.meta.dir, '../../components/FullscreenLayout.tsx'),
  'utf8',
)

describe('getModalChromeVisibility (densable RPs)', () => {
  test('none when no open dialogs', () => {
    expect(
      getModalChromeVisibility({
        hasOpenDialogs: false,
        suppressReason: null,
      }),
    ).toBe('none')
    expect(
      getModalChromeVisibility({
        hasOpenDialogs: false,
        suppressReason: 'typing',
      }),
    ).toBe('none')
  })

  test('suppressed when zIr set', () => {
    expect(
      getModalChromeVisibility({
        hasOpenDialogs: true,
        suppressReason: 'typing',
      }),
    ).toBe('suppressed')
    expect(
      getModalChromeVisibility({
        hasOpenDialogs: true,
        suppressReason: 'legacy-dialog',
      }),
    ).toBe('suppressed')
  })

  test('visible when open and not suppressed', () => {
    expect(
      getModalChromeVisibility({
        hasOpenDialogs: true,
        suppressReason: null,
      }),
    ).toBe('visible')
  })
})

describe('shouldOccupyFullscreenModalSlot / KA', () => {
  test('idle fullscreen does not occupy modal (empty fragment would cover footer)', () => {
    expect(
      shouldOccupyFullscreenModalSlot({
        toolJsxCentered: false,
        topDialogKind: undefined,
      }),
    ).toBe(false)
    expect(isTopDialogModalLayout(undefined)).toBe(false)
  })

  test('inline NMs kinds (GSn) do not occupy modal', () => {
    expect(getDialogHostLayout('permission_prompt')).toBe('inline')
    expect(getDialogHostLayout('managed_settings_security')).toBe('inline')
    expect(getDialogHostLayout('peer_inbound_approval')).toBe('inline')
    expect(isTopDialogModalLayout('permission_prompt')).toBe(false)
    expect(
      shouldOccupyFullscreenModalSlot({
        toolJsxCentered: false,
        topDialogKind: 'permission_prompt',
      }),
    ).toBe(false)
  })

  test('EQr exit-plan occupies modal (densable mLo / KA)', () => {
    expect(getDialogHostLayout(PERMISSION_EXIT_PLAN_MODE_V2_KIND)).toBe('modal')
    expect(isTopDialogModalLayout(PERMISSION_EXIT_PLAN_MODE_V2_KIND)).toBe(true)
    expect(
      shouldOccupyFullscreenModalSlot({
        toolJsxCentered: false,
        topDialogKind: PERMISSION_EXIT_PLAN_MODE_V2_KIND,
      }),
    ).toBe(true)
  })

  test('local-jsx occupies modal (PCn arm)', () => {
    expect(
      shouldOccupyFullscreenModalSlot({
        toolJsxCentered: true,
      }),
    ).toBe(true)
  })
})

describe('isFullscreenModalChromeActive (densable kZt)', () => {
  test('KA alone is false when RPs suppressed/none', () => {
    expect(
      isFullscreenModalChromeActive({
        topDialogKind: PERMISSION_EXIT_PLAN_MODE_V2_KIND,
        modalChrome: 'suppressed',
      }),
    ).toBe(false)
    expect(
      isFullscreenModalChromeActive({
        topDialogKind: PERMISSION_EXIT_PLAN_MODE_V2_KIND,
        modalChrome: 'none',
      }),
    ).toBe(false)
  })

  test('KA && visible is true', () => {
    expect(
      isFullscreenModalChromeActive({
        topDialogKind: PERMISSION_EXIT_PLAN_MODE_V2_KIND,
        modalChrome: 'visible',
      }),
    ).toBe(true)
  })

  test('PCn is true regardless of chrome', () => {
    expect(
      isFullscreenModalChromeActive({
        toolJsxCentered: true,
        modalChrome: 'suppressed',
      }),
    ).toBe(true)
  })
})

describe('REPL densable ozs / RPs wiring', () => {
  test('Provider wraps FullscreenLayout so modal DialogHost inherits host', () => {
    const provider = replSrc.indexOf(
      '<PermissionDialogHostProvider value={permissionDialogHostValue}>',
    )
    const layout = replSrc.indexOf('<FullscreenLayout', provider)
    const closeProvider = replSrc.indexOf(
      '</PermissionDialogHostProvider>',
      provider,
    )
    expect(provider).toBeGreaterThan(-1)
    expect(layout).toBeGreaterThan(provider)
    expect(closeProvider).toBeGreaterThan(layout)
  })

  test('modal EQr is ozs content (no sibling Host — Tyn appends modal.content)', () => {
    expect(replSrc).toContain("visible: modalChrome === 'visible'")
    expect(replSrc).toContain('isTopDialogModalLayout')
    // Non-fullscreen no longer double-mounts a sibling modal Host
    expect(replSrc).not.toContain('!isFullscreenEnvEnabled() && hasModalNms')
  })

  test('ozs is {content, visible: modalChrome === "visible"} for KA', () => {
    expect(replSrc).toContain('getModalChromeVisibility')
    expect(replSrc).toContain('isTopDialogModalLayout')
    expect(replSrc).toContain("visible: modalChrome === 'visible'")
    expect(replSrc).toContain('toolJsxCentered')
    expect(replSrc).toContain('{ content: toolJSX!.jsx, visible: true')
    expect(replSrc).toContain('suppressReason: dialogSuppressReason')
  })

  test('placeholder/scroll gate on densable kZt (not bare occupyModalSlot)', () => {
    expect(replSrc).toContain('isFullscreenModalChromeActive')
    expect(replSrc).toContain('placeholderText && !kZt')
    expect(replSrc).toContain(
      "kZt || !focusedInputDialog || focusedInputDialog === 'tool-permission'",
    )
    expect(replSrc).toContain(
      'onScroll={kZt || !!viewedAgentTask ? undefined : composedOnScroll}',
    )
    expect(replSrc).not.toContain('placeholderText && !occupyModalSlot')
  })

  test('Esc chat:cancel gets densable !Z (isDialogChromeVisible)', () => {
    expect(replSrc).toContain('isDialogChromeVisible')
    expect(replSrc).toContain('isDialogChromeVisible,')
    const cancelSrc = readFileSync(
      join(import.meta.dir, '../../hooks/useCancelRequest.ts'),
      'utf8',
    )
    expect(cancelSrc).toContain('!isDialogChromeVisible')
  })

  test('PromptInput hide uses subscribed useNhtHidesPromptInput', () => {
    expect(replSrc).toContain('useNhtHidesPromptInput()')
    expect(replSrc).not.toContain(
      'nhtHidesPromptInput(dialogStore.getState().open)',
    )
  })
})

describe('FullscreenLayout densable Tyn visible gate', () => {
  test('paints ▔ only when modal.visible (display flex/none)', () => {
    expect(layoutSrc).toContain('modal?.visible ?? false')
    expect(layoutSrc).toContain("display={modalVisible ? 'flex' : 'none'}")
    expect(layoutSrc).toContain("display={modalVisible ? 'none' : 'flex'}")
    expect(layoutSrc).toContain('{modal.content}')
    expect(layoutSrc).toContain('ModalScroller')
    expect(layoutSrc).toContain('claimScrollBox: null')
  })

  test('modal pane is flex sibling like gold Tyn (not absolute/opaque)', () => {
    // Gold Tyn Bxc: no position:absolute, no opaque on the ▔ pane.
    expect(layoutSrc).toContain('<Divider color="permission" char="▔" />')
    expect(layoutSrc).toContain('{/* $xc — scroll + sidebar row */}')
    expect(layoutSrc).toContain('{/* Uxc — prompt chrome')
    expect(layoutSrc).toContain('{/* Bxc — ozs pane')
    // Prop checks: modal Box must not use absolute/opaque (companion float may).
    const modalBox = layoutSrc.slice(
      layoutSrc.indexOf('ref={axcOverlayRef}'),
      layoutSrc.indexOf('{modal.content}'),
    )
    expect(modalBox).not.toMatch(/position=["']absolute["']/)
    expect(modalBox).not.toMatch(/^\s*opaque\s*$/m)
    expect(modalBox).not.toMatch(/\bopaque\b/)
  })

  test('lRc ModalScroller reclaim uses Twe focusManager via useApp', () => {
    const scroller = readFileSync(
      join(import.meta.dir, '../../components/ModalScroller.tsx'),
      'utf8',
    )
    expect(scroller).toContain('useApp')
    expect(scroller).toContain('focusManager: vyn')
    expect(scroller).not.toContain('getFocusManager')
    expect(scroller).toContain('vyn.focus(ZF0!)')
    expect(scroller).toContain('vyn.focus(Gxc)')
  })
})
