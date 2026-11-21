/**
 * densable ozs / RPs / KA (239 SEA gold):
 *   RPs() = !open?"none":zIr()!=null?"suppressed":"visible"
 *   KA = Bsu()==="modal"
 *   ozs = KA ? {content:NMs(modal), visible:wi==="visible"}
 *       : PCn ? {content:PCn, visible:true} : undefined
 * FullscreenLayout (Tyn): zkr=fCt?.visible; pane display:zkr?"flex":"none";
 * bottom chrome display:zkr?"none":"flex".
 *
 * Gold mLo: EQr → modal; Gbt/m$e → bottom; else inline.
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
import { nhtHidesPromptInput } from '../nhtPrompt.js'
import {
  AUTO_MODE_SERVER_FALLBACK_KIND,
  COST_THRESHOLD_KIND,
  MCP_ELICITATION_KIND,
  MCP_ELICITATION_WAITING_KIND,
  MCP_URL_ELICITATION_KIND,
} from '../specs/jsuKinds.js'
import {
  PERMISSION_ASK_USER_QUESTION_KIND,
  PERMISSION_EXIT_PLAN_MODE_V2_KIND,
} from '../specs/permissionKinds.js'

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

  test('Gbt/m$e layout bottom (tot.abovePrompt yv), not modal', () => {
    expect(getDialogHostLayout(MCP_URL_ELICITATION_KIND)).toBe('bottom')
    expect(getDialogHostLayout(MCP_ELICITATION_KIND)).toBe('bottom')
    expect(getDialogHostLayout(MCP_ELICITATION_WAITING_KIND)).toBe('bottom')
    expect(getDialogHostLayout(AUTO_MODE_SERVER_FALLBACK_KIND)).toBe('bottom')
    expect(isTopDialogModalLayout(MCP_URL_ELICITATION_KIND)).toBe(false)
    expect(
      shouldOccupyFullscreenModalSlot({
        toolJsxCentered: false,
        topDialogKind: MCP_URL_ELICITATION_KIND,
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
    expect(replSrc).toContain('suppressReason={dialogSuppressReason}')
  })

  test('placeholder/scroll gate on densable kZt (not bare occupyModalSlot)', () => {
    expect(replSrc).toContain('isFullscreenModalChromeActive')
    expect(replSrc).toContain('placeholderText && !kZt')
    expect(replSrc).toContain('kZt || !anyInputOverlay || hostPermissionOpen')
    expect(replSrc).toContain(
      'onScroll={kZt ? undefined : viewedAgentTask ? scrollPin.onUserScrollWithoutDivider : composedOnScroll}',
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

  test('gold nP hides PromptInput for permission Ask; soft i_y does not', () => {
    expect(nhtHidesPromptInput(PERMISSION_ASK_USER_QUESTION_KIND)).toBe(true)
    expect(nhtHidesPromptInput('permission_prompt')).toBe(true)
    expect(nhtHidesPromptInput(COST_THRESHOLD_KIND)).toBe(false)
    expect(nhtHidesPromptInput(undefined)).toBe(false)
  })

  test('inline NMs is tot.scrollable bJ (gold e(yv,{}) before flexGrow), not Qv/vh', () => {
    const scrollable = replSrc.lastIndexOf('scrollable={')
    const above = replSrc.lastIndexOf('abovePrompt={')
    const totBottom = replSrc.lastIndexOf('bottom={')
    const inlineHost = replSrc.indexOf(
      '<DialogHost variant="inline" suppressReason={dialogSuppressReason} />',
    )
    const grow = replSrc.lastIndexOf('<Box flexGrow={1} />')
    expect(scrollable).toBeGreaterThan(-1)
    expect(above).toBeGreaterThan(scrollable)
    expect(totBottom).toBeGreaterThan(above)
    expect(inlineHost).toBeGreaterThan(scrollable)
    expect(inlineHost).toBeLessThan(grow)
    expect(grow).toBeLessThan(above)
    expect(replSrc.slice(above, totBottom)).not.toContain(
      '<DialogHost variant="inline" suppressReason={dialogSuppressReason} />',
    )
    expect(replSrc.slice(above, totBottom)).toContain(
      '<DialogHost variant="bottom" suppressReason={dialogSuppressReason} />',
    )
    expect(replSrc.slice(totBottom)).not.toContain(
      '<DialogHost variant="inline" suppressReason={dialogSuppressReason} />',
    )
    expect(replSrc.slice(totBottom)).not.toContain('<DialogHost')
    expect(replSrc.slice(totBottom)).toContain('<CompanionSprite />')
    expect(replSrc).toContain(
      '!toolJSX?.shouldHidePromptInput && !anyInputOverlay && !showBashesDialog && !hidePromptForHardNms',
    )
  })
})

describe('FullscreenLayout densable Tyn visible gate', () => {
  test('paints ▔ only when modal.visible (display flex/none)', () => {
    expect(layoutSrc).toContain('modal?.visible ?? false')
    expect(layoutSrc).toContain("display={modalVisible ? 'flex' : 'none'}")
    expect(layoutSrc).toContain("display={modalVisible ? 'none' : 'flex'}")
    expect(layoutSrc).toContain('{modal.content}')
    expect(layoutSrc).toContain('{modal.footer}')
    expect(layoutSrc).toContain('ModalScroller')
    expect(layoutSrc).toContain('claimScrollBox: null')
  })

  test('modal pane is flex sibling like official pdn (not absolute/opaque) with footer measurement', () => {
    expect(layoutSrc).toContain('<Divider color="permission" char="▔" />')
    expect(layoutSrc).toContain('{/* $xc — scroll + sidebar row */}')
    expect(layoutSrc).toContain('{/* Uxc — prompt chrome')
    expect(layoutSrc).toContain('{/* Bxc — ozs pane')
    expect(layoutSrc).not.toContain('AxcStickyHost')
    const tynPaneStart = layoutSrc.indexOf('{/* Bxc — ozs pane')
    const tynPaneEnd = layoutSrc.indexOf(
      '</PromptOverlayProvider>',
      tynPaneStart,
    )
    const tynPane = layoutSrc.slice(tynPaneStart, tynPaneEnd)
    expect(tynPane).not.toMatch(/position=["']absolute["']/)
    expect(tynPane).not.toMatch(/\bopaque\b/)
  })

  test('Tyn jg wraps transcript column so Ec/Qa use mainColumns not full terminal', () => {
    expect(layoutSrc).toContain(
      '<TerminalSizeContext value={{ columns: mainColumns, rows: terminalRows }}>',
    )
    expect(layoutSrc).toContain(
      'position="absolute" bottom={0} left={0} right={0} justifyContent="center"',
    )
    expect(layoutSrc).not.toContain('left={left}')
  })

  test('non-fullscreen Fragment renders scrollable, abovePrompt, bottom, modal content/footer', () => {
    const elseStart = layoutSrc.indexOf(
      '// Official 2.1.328 non-fullscreen fallback:',
    )
    const elseEnd = layoutSrc.indexOf('function NewMessagesPill')
    const elseArm = layoutSrc.slice(elseStart, elseEnd)
    expect(elseArm).toContain('{scrollable}')
    expect(elseArm).toContain('{bottom}')
    expect(elseArm).toContain('{modal?.content}')
    expect(elseArm).toContain('{modal?.footer}')
    expect(elseArm).not.toContain('{overlay}')
    expect(elseArm).not.toContain('AxcStickyHost')
    expect(layoutSrc).not.toContain('overlay?: ReactNode')
    expect(replSrc).not.toContain('overlay={toolPermissionOverlay}')
    expect(replSrc).not.toContain('const toolPermissionOverlay')
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
