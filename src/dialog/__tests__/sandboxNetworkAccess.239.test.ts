/**
 * densable K8c / FRr — sandbox_network_access asker (same-host coalesce + cancelled).
 *
 * Do NOT mock.module sandbox-adapter: Bun mock.module is process-global and a
 * two-symbol stub pollutes pathValidation / suppressAlwaysAllow in the same
 * process. Use the real SandboxManager + clearSessionAllowedHostsForTests.
 */
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  createDialogMailbox,
  createDialogStore,
  createRequestDialog,
} from '../index.js'
import {
  mintSandboxNetworkPersistRow,
  SandboxNetworkAccessAsker,
  withSandboxNetworkPersistRow,
} from '../sandboxNetworkAccess.js'
import {
  SANDBOX_NETWORK_ACCESS_KIND,
  sandboxNetworkAccessSpec,
} from '../specs/jsuKinds.js'
import { clearSessionAllowedHostsForTests } from '../../utils/sandbox/sandbox-adapter.js'

afterEach(() => {
  clearSessionAllowedHostsForTests()
})

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

async function waitForTop(store: DialogStore, kind: string, timeoutMs = 1000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const top = store.getState().open.at(-1)
    if (top?.kind === kind) return top
    await Bun.sleep(0)
  }
  throw new Error(`timed out waiting for dialog kind=${kind}`)
}

describe('SandboxNetworkAccessAsker (K8c / FRr)', () => {
  test('Qg default cancelled on dismiss', async () => {
    const store = createDialogStore()
    const requestDialog = wireMailbox(store)
    expect(sandboxNetworkAccessSpec.kind).toBe(SANDBOX_NETWORK_ACCESS_KIND)
    expect(sandboxNetworkAccessSpec.default).toBe('cancelled')

    const pending = requestDialog(sandboxNetworkAccessSpec, {
      host: 'api.example.com',
    })
    const top = await waitForTop(store, SANDBOX_NETWORK_ACCESS_KIND)
    store.dismiss(top.id)
    expect(await pending).toBe('cancelled')
  })

  test('ask coalesces same host and applies persistRow', async () => {
    const store = createDialogStore()
    const requestDialog = wireMailbox(store)
    const applied: unknown[] = []
    const asker = new SandboxNetworkAccessAsker({
      requestDialog,
      getBridge: () => undefined,
      applyPermissionUpdate: u => {
        applied.push(u)
      },
    })

    const p1 = asker.ask({ host: 'api.example.com', port: undefined })
    const p2 = asker.ask({ host: 'api.example.com', port: undefined })
    expect(p1).toBe(p2)

    const top = await waitForTop(store, SANDBOX_NETWORK_ACCESS_KIND)
    store.answer(top.id, {
      allow: true,
      persistToSettings: true,
      persistRow: {
        applies: [
          {
            type: 'addRules',
            rules: [
              { toolName: 'WebFetch', ruleContent: 'domain:api.example.com' },
            ],
            behavior: 'allow',
            destination: 'localSettings',
          },
        ],
      },
    })
    expect(await p1).toBe(true)
    expect(await p2).toBe(true)
    expect(applied).toHaveLength(1)
  })

  test('ask returns false on cancelled without bridge', async () => {
    const store = createDialogStore()
    const requestDialog = wireMailbox(store)
    const asker = new SandboxNetworkAccessAsker({
      requestDialog,
      getBridge: () => undefined,
      applyPermissionUpdate: () => {},
    })
    const pending = asker.ask({ host: 'deny.example', port: undefined })
    const top = await waitForTop(store, SANDBOX_NETWORK_ACCESS_KIND)
    store.dismiss(top.id)
    expect(await pending).toBe(false)
  })

  test('FRr Esc answers cancelled so K8c can take the bridge-race branch', () => {
    const src = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../components/permissions/SandboxPermissionRequest.tsx',
      ),
      'utf8',
    )
    expect(src).toContain("onUserResponse('cancelled')")
  })

  test('m2A yes-dont-ask-again mints WebFetch domain persistRow', () => {
    const minted = withSandboxNetworkPersistRow(
      { allow: true, persistToSettings: true },
      'api.example.com',
    )
    expect(minted).toEqual({
      allow: true,
      persistToSettings: true,
      persistRow: mintSandboxNetworkPersistRow('api.example.com'),
    })
    expect(minted).not.toBe('cancelled')
    if (minted === 'cancelled') return
    expect(minted.persistRow?.applies[0]).toMatchObject({
      type: 'addRules',
      behavior: 'allow',
      destination: 'localSettings',
      rules: [{ toolName: 'WebFetch', ruleContent: 'domain:api.example.com' }],
    })
  })

  test('m2A brackets IPv6 in domain rule', () => {
    const row = mintSandboxNetworkPersistRow('2001:db8::1')
    const update = row.applies[0]
    expect(update?.type).toBe('addRules')
    if (update?.type !== 'addRules') return
    expect(update.rules[0]?.ruleContent).toBe('domain:[2001:db8::1]')
  })

  test('m2A leaves yes / deny / cancelled unchanged', () => {
    expect(
      withSandboxNetworkPersistRow(
        { allow: true, persistToSettings: false },
        'h',
      ),
    ).toEqual({ allow: true, persistToSettings: false })
    expect(
      withSandboxNetworkPersistRow(
        { allow: false, persistToSettings: false },
        'h',
      ),
    ).toEqual({ allow: false, persistToSettings: false })
    expect(withSandboxNetworkPersistRow('cancelled', 'h')).toBe('cancelled')
  })

  test('jsuRenderers wires m2A persistRow for FRr', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../jsuRenderers.tsx'),
      'utf8',
    )
    expect(src).toContain('withSandboxNetworkPersistRow')
  })

  test('K8c.prompt matches gold — no Vce/msf emit (REPL DialogStore owns sandbox slot)', () => {
    const src = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../sandboxNetworkAccess.ts',
      ),
      'utf8',
    )
    expect(src).not.toContain('emitBgNeedsInput')
    expect(src).not.toContain('emitSandboxBgNeeds')
    expect(src).not.toContain('bgNeedsInputBridge')
  })
})
