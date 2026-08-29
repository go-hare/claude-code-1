/**
 * densable 2.1.239 Kmy / znu — chrome Host renderers.
 *
 * Gold: jsu={...vM(zOo,znu),...vM(jOo,Kmy)}. Setup answers
 * continue|keep_waiting|skip|cancelled; upsell answers
 * install|not_now|dont_ask_again|cancelled. ClaudeInChromeOnboarding is
 * pre-REPL /chrome, not these kinds. Opener t(jOo)/t(zOo) is
 * src/utils/claudeInChrome/installUpsell.ts (HAVE).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  CHROME_INSTALL_SETUP_KIND,
  CHROME_INSTALL_UPSELL_KIND,
  chromeInstallSetupSpec,
  chromeInstallUpsellSpec,
  createDialogMailbox,
  createDialogStore,
  createRequestDialog,
} from '../index.js'
import {
  CHROME_INSTALL_ANSWER_DEBOUNCE_MS,
  CHROME_INSTALL_SKIP_OPTION,
  CHROME_INSTALL_UPSELL_OPTIONS,
  chromeInstallSetupOptions,
} from '../dialogs/ChromeInstallDialogs.js'

const root = join(import.meta.dir, '../../..')

type DialogStore = ReturnType<typeof createDialogStore>

function wireMailbox(store: DialogStore) {
  const mailbox = createDialogMailbox()
  const owned = new Set<string>()
  mailbox.subscribe(entry => {
    owned.add(entry.id)
    store.open(entry)
  })
  store.onClosed(event => {
    if (!owned.delete(event.id)) return
    mailbox.reply(
      event.type === 'answered'
        ? { id: event.id, result: event.result }
        : { id: event.id, cancelled: true },
    )
  })
  return createRequestDialog(mailbox)
}

async function waitForTop(
  store: DialogStore,
  kind: string,
  timeoutMs = 1000,
): Promise<NonNullable<ReturnType<DialogStore['getState']>['open'][number]>> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const top = store.getState().open.at(-1)
    if (top?.kind === kind) return top
    await Bun.sleep(0)
  }
  throw new Error(`timed out waiting for dialog kind=${kind}`)
}

describe('chrome Host renderer mapping (Kmy / znu)', () => {
  test('jsuRenderers does not reuse ClaudeInChromeOnboarding', () => {
    const src = readFileSync(join(root, 'src/dialog/jsuRenderers.tsx'), 'utf8')
    expect(src).not.toContain('ClaudeInChromeOnboarding')
    expect(src).not.toContain('chromeSetupRenderer')
    expect(src).toContain('ChromeInstallSetupDialog')
    expect(src).toContain('ChromeInstallUpsellDialog')
    expect(src).toContain(
      '[CHROME_INSTALL_SETUP_KIND]: chromeInstallSetupRenderer',
    )
    expect(src).toContain(
      '[CHROME_INSTALL_UPSELL_KIND]: chromeInstallUpsellRenderer',
    )
    expect(src).not.toContain('still GAP')
    expect(src).toContain('installUpsell Mby (HAVE)')
    expect(src).toContain('installUpsell KBA (HAVE)')
  })

  test('Kmy / znu gold copy + THr=250 + telemetry; no opener invent', () => {
    const src = readFileSync(
      join(root, 'src/dialog/dialogs/ChromeInstallDialogs.tsx'),
      'utf8',
    )
    expect(src).toContain('CHROME_INSTALL_ANSWER_DEBOUNCE_MS = 250')
    expect(src).toContain('tengu_chrome_install_upsell_shown')
    expect(src).toContain('Setting up Claude in Chrome')
    expect(src).toContain('Claude wants to use your browser')
    expect(src).toContain('Keep waiting')
    expect(src).toContain('Continue with browser tools')
    expect(src).toContain('Install extension')
    expect(src).toContain("Don't ask again")
    expect(src).not.toMatch(/\bopenInChrome\s*\(/)
    expect(src).not.toMatch(/\bsaveGlobalConfig\s*\(/)
    expect(src).not.toContain('ClaudeInChromeOnboarding')
    expect(src).not.toContain('opener still GAP')
    expect(src).toContain('installUpsell.ts (HAVE)')
  })

  test('production opener lives on skill ejA, not in Host files', () => {
    const opener = readFileSync(
      join(root, 'src/utils/claudeInChrome/installUpsell.ts'),
      'utf8',
    )
    const skill = readFileSync(
      join(root, 'src/skills/bundled/claudeInChrome.ts'),
      'utf8',
    )
    expect(opener).toMatch(/requestDialog\(\s*chromeInstallUpsellSpec/)
    expect(opener).toMatch(/requestDialog\(\s*chromeInstallSetupSpec/)
    expect(opener).toContain('openInChrome(CHROME_EXTENSION_URL)')
    expect(opener).toContain('chromeInstallUpsellDismissed')
    expect(opener).toContain('tengu_chrome_install_upsell')
    // densable Ee/be/pe("chrome_install_upsell", …) — the feature funnel
    // taxonomy, not a bespoke `chrome_install_upsell` event name.
    expect(opener).toContain("logEvent('tengu_feature_ok'")
    expect(opener).toContain("logEvent('tengu_feature_sad'")
    expect(opener).toContain("logEvent('tengu_feature_bad'")
    expect(opener).not.toContain("logEvent('chrome_install_upsell'")
    expect(skill).toContain('allowedTools: []')
    expect(skill).toContain('isClaudeInChromeWiredThisSession()')
    expect(skill).toContain('isClaudeInChromeInstallUpsellEligible()')
    expect(skill).toContain('resolveClaudeInChromeSkillPrompt(context)')
    expect(skill).toMatch(/n \+= `\\n## Task\\n\$\{args\}`/)
    expect(skill).not.toContain('SKILL_ACTIVATION_MESSAGE')
    expect(skill).not.toContain('menuDescription')
  })
})

describe('Kmy option set by phase', () => {
  test('connected → continue + skip', () => {
    expect(chromeInstallSetupOptions('connected').map(o => o.value)).toEqual([
      'continue',
      'skip',
    ])
  })

  test('stalled → keep_waiting + skip', () => {
    expect(chromeInstallSetupOptions('stalled').map(o => o.value)).toEqual([
      'keep_waiting',
      'skip',
    ])
  })

  test('waiting_install / connecting / failed → skip only', () => {
    expect(chromeInstallSetupOptions('waiting_install')).toEqual([
      CHROME_INSTALL_SKIP_OPTION,
    ])
    expect(chromeInstallSetupOptions('connecting')).toEqual([
      CHROME_INSTALL_SKIP_OPTION,
    ])
    expect(chromeInstallSetupOptions('failed')).toEqual([
      CHROME_INSTALL_SKIP_OPTION,
    ])
  })

  test('THr is 250 and Xmy is the gold three-option set', () => {
    expect(CHROME_INSTALL_ANSWER_DEBOUNCE_MS).toBe(250)
    expect(CHROME_INSTALL_UPSELL_OPTIONS.map(o => o.value)).toEqual([
      'install',
      'not_now',
      'dont_ask_again',
    ])
  })
})

describe('jOo / zOo requestDialog result shape', () => {
  test('setup continue / keep_waiting / skip', async () => {
    const store = createDialogStore()
    const requestDialog = wireMailbox(store)

    const continueP = requestDialog(chromeInstallSetupSpec, {
      phase: 'connected',
      installPageOpened: true,
    })
    const continueTop = await waitForTop(store, CHROME_INSTALL_SETUP_KIND)
    store.answer(continueTop.id, 'continue')
    expect(await continueP).toBe('continue')

    const keepP = requestDialog(chromeInstallSetupSpec, {
      phase: 'stalled',
      installPageOpened: true,
    })
    const keepTop = await waitForTop(store, CHROME_INSTALL_SETUP_KIND)
    store.answer(keepTop.id, 'keep_waiting')
    expect(await keepP).toBe('keep_waiting')

    const skipP = requestDialog(chromeInstallSetupSpec, {
      phase: 'waiting_install',
      installPageOpened: false,
    })
    const skipTop = await waitForTop(store, CHROME_INSTALL_SETUP_KIND)
    store.answer(skipTop.id, 'skip')
    expect(await skipP).toBe('skip')
  })

  test('upsell install / not_now / dont_ask_again', async () => {
    const store = createDialogStore()
    const requestDialog = wireMailbox(store)

    const installP = requestDialog(chromeInstallUpsellSpec, {})
    const installTop = await waitForTop(store, CHROME_INSTALL_UPSELL_KIND)
    store.answer(installTop.id, 'install')
    expect(await installP).toBe('install')

    const notNowP = requestDialog(chromeInstallUpsellSpec, {})
    const notNowTop = await waitForTop(store, CHROME_INSTALL_UPSELL_KIND)
    store.answer(notNowTop.id, 'not_now')
    expect(await notNowP).toBe('not_now')

    const neverP = requestDialog(chromeInstallUpsellSpec, {})
    const neverTop = await waitForTop(store, CHROME_INSTALL_UPSELL_KIND)
    store.answer(neverTop.id, 'dont_ask_again')
    expect(await neverP).toBe('dont_ask_again')
  })

  test('invalid setup payload still defaults cancelled', async () => {
    const store = createDialogStore()
    const requestDialog = wireMailbox(store)
    expect(
      await requestDialog(chromeInstallSetupSpec, {
        phase: 'unknown',
      } as never),
    ).toBe('cancelled')
  })
})
