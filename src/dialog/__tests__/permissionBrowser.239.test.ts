/**
 * densable 2.1.239 Cno / Hnu / vum / wXn / Nmy / Lmy / Omy.
 *
 * Gold: Fwl `LUt()&&startsWith(lwe)` → Cno+vum; jsu `vM(Cno,Hnu)`.
 * LUt GB default false — do not LOCAL_GATE_DEFAULTS. Fwl LUt=true is
 * source-locked (process-global mock.module cannot reliably rebind
 * already-imported growthbook; chromeInstallOpener.239 pattern).
 * Do not invent BLS/ULS, ConsentRow mint, or /chrome extra allow-rules.
 * requestSource is gold iK/xSl → Hnu → Cm → G2e (not a local banner).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { ToolUseConfirm } from '../../components/permissions/PermissionRequest.js'
import {
  createDialogMailbox,
  createDialogStore,
  createRequestDialog,
  permissionBrowserSpec,
  PERMISSION_BROWSER_KIND,
} from '../index.js'
import {
  APPROVAL_WITHHELD_MARKER,
  BROWSER_TOOL_VERBS,
  CLAUDE_IN_CHROME_DOMAIN,
  COMPUTER_ACTION_VERBS,
  URL_PREVIEW_MAX_UNITS,
  type BrowserPermissionPayload,
  buildChromeDomainAllowRow,
  computeShowAlwaysAllow,
  extractChromeHostTarget,
  formatBrowserVerbPhrase,
  isClaudeInChromeInProductPermissions,
  isClaudeInChromeToolName,
  previewUrlString,
  resolveBrowserPermissionAnswer,
  sanitizeHostDisplay,
  shouldShowChromeDomainAllow,
} from '../permissionBrowser.js'
import { buildBrowserPermissionDescriptor } from '../permissionDescriptor.js'
import { DIALOG_COMPONENTS_KINDS_FOR_TEST } from '../DialogHost.js'

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

function chromeConfirm(
  name: string,
  input: Record<string, unknown> = {},
  extra: Partial<ToolUseConfirm> = {},
): ToolUseConfirm {
  return {
    toolUseID: 'tu',
    tool: { name },
    input,
    description: 'd',
    permissionResult: { behavior: 'ask' },
    assistantMessage: { message: { id: 'm1' } },
    toolUseContext: {},
    ...extra,
  } as unknown as ToolUseConfirm
}

const allowDomainPayload: BrowserPermissionPayload = {
  requestId: 'r',
  toolName: 'mcp__claude-in-chrome__navigate',
  permissionResult: { behavior: 'ask' },
  verbPhrase: 'navigate',
  input: { url: 'https://example.com/x' },
  chrome: { host: 'example.com', url: 'https://example.com/x' },
  showAlwaysAllow: true,
  isAskCappedByOrg: false,
}

describe('Cno Qg', () => {
  test('missing verbPhrase → default cancelled', async () => {
    const store = createDialogStore()
    const requestDialog = wireMailbox(store)
    expect(
      await requestDialog(permissionBrowserSpec, {
        requestId: 'r',
        toolName: 'mcp__claude-in-chrome__navigate',
        permissionResult: { behavior: 'ask' },
      } as never),
    ).toEqual({ behavior: 'cancelled' })
  })

  test('valid payload + allow / dismiss', async () => {
    const store = createDialogStore()
    const requestDialog = wireMailbox(store)
    const pending = requestDialog(permissionBrowserSpec, {
      requestId: 'r',
      toolName: 'mcp__claude-in-chrome__navigate',
      permissionResult: { behavior: 'ask' },
      verbPhrase: 'navigate',
    })
    const top = await waitForTop(store, PERMISSION_BROWSER_KIND)
    store.answer(top.id, { behavior: 'allow' })
    expect(await pending).toEqual({ behavior: 'allow' })

    const dismissed = requestDialog(permissionBrowserSpec, {
      requestId: 'r2',
      toolName: 'mcp__claude-in-chrome__navigate',
      permissionResult: { behavior: 'ask' },
      verbPhrase: 'click',
    })
    const top2 = await waitForTop(store, PERMISSION_BROWSER_KIND)
    store.dismiss(top2.id)
    expect(await dismissed).toEqual({ behavior: 'cancelled' })
  })
})

describe('wXn / $LS / LPf', () => {
  test('strips lwe prefix and maps $LS', () => {
    expect(formatBrowserVerbPhrase('mcp__claude-in-chrome__navigate', {})).toBe(
      'navigate',
    )
    expect(
      formatBrowserVerbPhrase('mcp__claude-in-chrome__read_page', {}),
    ).toBe('read the page')
    expect(BROWSER_TOOL_VERBS.javascript_tool).toBe('run JavaScript')
  })

  test('computer action → LPf; unknown → use the browser', () => {
    expect(
      formatBrowserVerbPhrase('mcp__claude-in-chrome__computer', {
        action: 'left_click',
      }),
    ).toBe('click')
    expect(
      formatBrowserVerbPhrase('mcp__claude-in-chrome__computer', {
        action: 'screenshot',
      }),
    ).toBe(COMPUTER_ACTION_VERBS.screenshot)
    expect(
      formatBrowserVerbPhrase('mcp__claude-in-chrome__computer', {
        action: 'not-a-real-action',
      }),
    ).toBe('use the browser')
  })

  test('browser_batch does not invent BLS/ULS', () => {
    expect(
      formatBrowserVerbPhrase('mcp__claude-in-chrome__browser_batch', {
        actions: [{ type: 'navigate' }],
      }),
    ).toBe('use the browser')
  })

  test('tabs_context_mcp createIfEmpty special-case', () => {
    expect(
      formatBrowserVerbPhrase('mcp__claude-in-chrome__tabs_context_mcp', {
        createIfEmpty: true,
      }),
    ).toBe('create a browser window and read your tabs')
    expect(
      formatBrowserVerbPhrase('mcp__claude-in-chrome__tabs_context_mcp', {}),
    ).toBe('read your browser tabs')
  })
})

describe('Wce / yO-string / vum chrome', () => {
  test('sanitizeHostDisplay empty / non-string → null', () => {
    expect(sanitizeHostDisplay('')).toBe(null)
    expect(sanitizeHostDisplay('   ')).toBe(null)
    expect(sanitizeHostDisplay(null)).toBe(null)
    expect(sanitizeHostDisplay({ host: 'x' })).toBe(null)
    expect(sanitizeHostDisplay('example.com')).toEqual({
      display: 'example.com',
    })
  })

  test('previewUrlString withheld vs full; non-string null', () => {
    expect(previewUrlString(undefined)).toBe(null)
    expect(previewUrlString({ href: 'x' })).toBe(null)
    expect(previewUrlString('https://example.com/x')).toEqual({
      kind: 'full',
      text: 'https://example.com/x',
      needsGutter: false,
    })
    const huge = 'https://example.com/' + 'a'.repeat(URL_PREVIEW_MAX_UNITS)
    expect(previewUrlString(huge)).toEqual({
      kind: 'withheld',
      marker: APPROVAL_WITHHELD_MARKER,
    })
  })

  test('previewUrlString Xgt (i4S/s4S) withholds zero-width / bidi / format chars', () => {
    const withheld = {
      kind: 'withheld' as const,
      marker: APPROVAL_WITHHELD_MARKER,
    }
    // U+200B ZWSP / Default_Ignorable + Cf
    expect(previewUrlString('https://ex.com/\u200Bpath')).toEqual(withheld)
    // U+202E RLO / Cf (RTL override)
    expect(previewUrlString('https://ex.com/\u202Emoc.evil')).toEqual(withheld)
    // U+2060 WORD JOINER / Cf
    expect(previewUrlString('https://ex.com/\u2060x')).toEqual(withheld)
    expect(previewUrlString('https://example.com/\tok')).toEqual({
      kind: 'full',
      text: 'https://example.com/ ok',
      needsGutter: false,
    })
  })

  test('extractChromeHostTarget prefers metadata.command.chrome else input.url', () => {
    expect(
      extractChromeHostTarget(
        { metadata: { command: { chrome: { host: 'from.meta', url: 'u' } } } },
        { url: 'https://from.input/' },
      ),
    ).toEqual({ host: 'from.meta', url: 'u' })
    expect(
      extractChromeHostTarget({ behavior: 'ask' }, { url: 'https://ex.com/p' }),
    ).toEqual({ host: 'ex.com', url: 'https://ex.com/p' })
    expect(extractChromeHostTarget({ behavior: 'ask' }, {})).toBeUndefined()
  })
})

describe('Nmy / Lmy / Omy', () => {
  test('Nmy hides on safetyCheck without classifierApprovable', () => {
    expect(
      shouldShowChromeDomainAllow({
        ...allowDomainPayload,
        permissionResult: {
          behavior: 'ask',
          decisionReason: { type: 'safetyCheck', classifierApprovable: false },
        },
      }),
    ).toBe(false)
    expect(shouldShowChromeDomainAllow(allowDomainPayload)).toBe(true)
  })

  test('Nmy requires showAlwaysAllow, not org-capped, host without *', () => {
    expect(
      shouldShowChromeDomainAllow({
        ...allowDomainPayload,
        showAlwaysAllow: false,
      }),
    ).toBe(false)
    expect(
      shouldShowChromeDomainAllow({
        ...allowDomainPayload,
        isAskCappedByOrg: true,
      }),
    ).toBe(false)
    expect(
      shouldShowChromeDomainAllow({
        ...allowDomainPayload,
        chrome: { host: '*.example.com' },
      }),
    ).toBe(false)
    expect(
      shouldShowChromeDomainAllow({
        ...allowDomainPayload,
        chrome: undefined,
      }),
    ).toBe(false)
  })

  test('Lmy session addRules ClaudeInChromeDomain', () => {
    expect(buildChromeDomainAllowRow(undefined)).toBe(null)
    expect(buildChromeDomainAllowRow({ host: '   ' })).toBe(null)
    expect(buildChromeDomainAllowRow({ host: 'example.com' })).toEqual({
      display: 'example.com',
      applies: [
        {
          type: 'addRules',
          rules: [
            {
              toolName: CLAUDE_IN_CHROME_DOMAIN,
              ruleContent: 'example.com',
            },
          ],
          behavior: 'allow',
          destination: 'session',
        },
      ],
    })
  })

  test('Omy allow / allow-domain / deny; invalid row degrades to allow', () => {
    const row = buildChromeDomainAllowRow(allowDomainPayload.chrome)
    expect(
      resolveBrowserPermissionAnswer('allow', allowDomainPayload, row),
    ).toEqual({
      behavior: 'allow',
      updatedInput: allowDomainPayload.input,
    })
    expect(
      resolveBrowserPermissionAnswer('allow-domain', allowDomainPayload, row),
    ).toEqual({
      behavior: 'allow',
      updatedInput: allowDomainPayload.input,
      permissionUpdates: row!.applies,
    })
    expect(
      resolveBrowserPermissionAnswer('allow-domain', allowDomainPayload, null),
    ).toEqual({
      behavior: 'allow',
      updatedInput: allowDomainPayload.input,
    })
    expect(
      resolveBrowserPermissionAnswer('deny', allowDomainPayload, row),
    ).toEqual({ behavior: 'deny' })
  })
})

describe('vum descriptor', () => {
  test('spreads iK + chrome + verbPhrase + showAlwaysAllow + isAskCappedByOrg', () => {
    const desc = buildBrowserPermissionDescriptor({
      confirm: chromeConfirm('mcp__claude-in-chrome__navigate', {
        url: 'https://example.com/x',
      }),
    })
    expect(desc.verbPhrase).toBe('navigate')
    expect(desc.chrome).toEqual({
      host: 'example.com',
      url: 'https://example.com/x',
    })
    expect(desc.requestId).toBe('tu')
    expect(typeof desc.showAlwaysAllow).toBe('boolean')
    expect(desc.isAskCappedByOrg).toBe(false)
    expect(desc.requestSource).toBeUndefined()
  })

  test('xSl forRemoteExecution → requestSource remote-agent; showAlwaysAllow false', () => {
    const desc = buildBrowserPermissionDescriptor({
      confirm: chromeConfirm(
        'mcp__claude-in-chrome__navigate',
        { url: 'https://example.com/x' },
        {
          toolUseContext: { forRemoteExecution: true } as never,
        },
      ),
    })
    expect(desc.requestSource).toEqual({ type: 'remote-agent' })
    expect(desc.showAlwaysAllow).toBe(false)
    expect(
      computeShowAlwaysAllow({
        permissionResult: { behavior: 'ask' },
        requestSource: { type: 'remote-agent' },
      }),
    ).toBe(false)
  })
})

describe('LUt / Fwl / Host source-lock', () => {
  test('LUt default false; not LOCAL_GATE_DEFAULTS', () => {
    expect(isClaudeInChromeInProductPermissions()).toBe(false)
    expect(isClaudeInChromeToolName('mcp__claude-in-chrome__navigate')).toBe(
      true,
    )
    expect(isClaudeInChromeToolName('Bash')).toBe(false)
    const gb = readFileSync(
      join(root, 'src/services/analytics/growthbook.ts'),
      'utf8',
    )
    expect(gb).not.toContain('tengu_cfc_in_product_permissions')
  })

  test('Fwl gates Cno on LUt(); vum not iK base', () => {
    const src = readFileSync(
      join(root, 'src/dialog/selectPermissionDialog.ts'),
      'utf8',
    )
    expect(src).toContain('isClaudeInChromeInProductPermissions()')
    expect(src).toContain('isClaudeInChromeToolName(tool.name)')
    expect(src).toContain('buildBrowserPermissionDescriptor')
    expect(src).not.toContain('isClaudeInChromeTool(')
  })

  test('Host jsu maps Cno → Hnu, not PermissionPromptRenderer', () => {
    const host = readFileSync(join(root, 'src/dialog/DialogHost.tsx'), 'utf8')
    expect(host).toContain('[PERMISSION_BROWSER_KIND]: PermissionBrowserDialog')
    expect(host).not.toMatch(
      /\[PERMISSION_BROWSER_KIND\]:\s*PermissionPromptRenderer/,
    )
    expect(DIALOG_COMPONENTS_KINDS_FOR_TEST).toContain(PERMISSION_BROWSER_KIND)
  })

  test('Hnu Allow / allow-domain / Deny(esc); Cm requestSource; no BLS invent', () => {
    const src = readFileSync(
      join(root, 'src/dialog/dialogs/PermissionBrowserDialog.tsx'),
      'utf8',
    )
    expect(src).toContain('Claude in Chrome wants to')
    expect(src).toContain('allow-domain')
    expect(src).toContain("behavior: 'cancelled'")
    expect(src).toContain('Deny')
    expect(src).toContain('(esc)')
    expect(src).toContain('Allow all actions on')
    expect(src).toContain('requestSource={p.requestSource}')
    expect(src).toContain('&& !withheld')
    expect(src).not.toMatch(/\bopenInChrome\s*\(/)
    expect(src).not.toContain('extra allow-rules')
  })
})
