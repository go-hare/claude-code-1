/**
 * densable DIi / _Bi — production openers on the NMs Host.
 *
 * Gold mNS: `r(DIi, e, {signal})` (payload is the request body; no queueBehind).
 * Gold spawn: `t.requestDialog(_Bi, {tmuxAvailable})` (no signal, no queueBehind).
 * Gold c2A: `<vtu request={e} onDone={t} />`.
 * Gold Qg defaults: DIi empty grant+uIe; _Bi `'cancelled'`.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { DEFAULT_GRANT_FLAGS } from '@ant/computer-use-mcp/types'
import {
  COMPUTER_USE_APPROVAL_KIND,
  IT2_SETUP_KIND,
  computerUseApprovalSpec,
  createDialogMailbox,
  createDialogStore,
  createRequestDialog,
  it2SetupSpec,
} from '../index.js'

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

async function waitForTop(store: DialogStore, kind: string, timeoutMs = 1000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const top = store.getState().open.at(-1)
    if (top?.kind === kind) return top
    await Bun.sleep(0)
  }
  throw new Error(`timed out waiting for dialog kind=${kind}`)
}

describe('DIi / _Bi NMs openers (densable mNS / spawn requestDialog)', () => {
  test('Qg: it2_setup result union + cancelled default', () => {
    expect(it2SetupSpec.kind).toBe(IT2_SETUP_KIND)
    expect(it2SetupSpec.default).toBe('cancelled')
    expect(it2SetupSpec.result().safeParse('installed').success).toBe(true)
    expect(it2SetupSpec.result().safeParse('use-tmux').success).toBe(true)
    expect(it2SetupSpec.result().safeParse('cancelled').success).toBe(true)
    expect(it2SetupSpec.result().safeParse('acknowledged').success).toBe(false)
  })

  test('Qg: computer_use_approval default is empty grant + uIe', () => {
    expect(computerUseApprovalSpec.kind).toBe(COMPUTER_USE_APPROVAL_KIND)
    expect(computerUseApprovalSpec.default).toEqual({
      granted: [],
      denied: [],
      flags: DEFAULT_GRANT_FLAGS,
    })
    expect(computerUseApprovalSpec.default).not.toBeNull()
  })

  test('mailbox dismiss returns gold defaults', async () => {
    const store = createDialogStore()
    const requestDialog = wireMailbox(store)

    const it2 = requestDialog(it2SetupSpec, { tmuxAvailable: true })
    const it2Top = await waitForTop(store, IT2_SETUP_KIND)
    expect(it2Top.payload).toEqual({ tmuxAvailable: true })
    store.dismiss(it2Top.id)
    expect(await it2).toBe('cancelled')

    const cu = requestDialog(computerUseApprovalSpec, {
      apps: [],
    })
    const cuTop = await waitForTop(store, COMPUTER_USE_APPROVAL_KIND)
    expect(cuTop.payload).toEqual({ apps: [] })
    store.dismiss(cuTop.id)
    expect(await cu).toEqual({
      granted: [],
      denied: [],
      flags: DEFAULT_GRANT_FLAGS,
    })
  })

  test('mailbox answer returns installed / grant body', async () => {
    const store = createDialogStore()
    const requestDialog = wireMailbox(store)

    const it2 = requestDialog(it2SetupSpec, { tmuxAvailable: false })
    const it2Top = await waitForTop(store, IT2_SETUP_KIND)
    store.answer(it2Top.id, 'installed')
    expect(await it2).toBe('installed')

    const grant = {
      granted: [
        { bundleId: 'com.example.app', displayName: 'App', grantedAt: 1 },
      ],
      denied: [],
      flags: {
        clipboardRead: true,
        clipboardWrite: false,
        systemKeyCombos: false,
      },
    }
    const cu = requestDialog(computerUseApprovalSpec, { apps: ['x'] })
    const cuTop = await waitForTop(store, COMPUTER_USE_APPROVAL_KIND)
    store.answer(cuTop.id, grant)
    expect(await cu).toEqual(grant)
  })

  test('c2A renderer takes payload as request body', () => {
    const jsu = readFileSync(join(root, 'src/dialog/jsuRenderers.tsx'), 'utf8')
    expect(jsu).toContain(
      '<ComputerUseApproval request={payload as never} onDone={response => answer(response)} />',
    )
    expect(jsu).not.toContain('if (!p?.request)')
    expect(jsu).not.toContain('answer(null)')
    expect(jsu).not.toContain('request={p.request')
  })

  test('mNS opener is requestDialog(DIi, req, {signal}) — no setToolJSX', () => {
    const wrapper = readFileSync(
      join(root, 'src/utils/computerUse/wrapper.tsx'),
      'utf8',
    )
    const fn = wrapper.slice(
      wrapper.indexOf('async function runPermissionDialog'),
    )
    expect(fn).toContain('computerUseApprovalSpec')
    expect(fn).toContain('requestDialog(computerUseApprovalSpec, req, {')
    expect(fn).toContain('signal: context.abortController.signal')
    expect(fn).not.toContain('queueBehind')
    expect(fn).not.toContain('setToolJSX')
    expect(fn).not.toContain('ComputerUseApproval')
    expect(fn).not.toContain('React.createElement')
    expect(wrapper).not.toContain("from 'react'")
    expect(wrapper).not.toContain('setToolJSX')
    expect(wrapper).not.toContain('ComputerUseApproval')
  })

  test('_Bi opener is requestDialog(it2SetupSpec, {tmuxAvailable}) — no setToolJSX', () => {
    const spawn = readFileSync(
      join(root, 'packages/builtin-tools/src/tools/shared/spawnMultiAgent.ts'),
      'utf8',
    )
    expect(spawn).toContain("from 'src/dialog/specs/jsuKinds.js'")
    expect(spawn).toContain('it2SetupSpec')
    expect(spawn).toContain('context.requestDialog!(it2SetupSpec, {')
    expect(spawn).toContain('tmuxAvailable')
    expect(spawn).not.toContain('It2SetupPrompt')
    expect(spawn).not.toContain("from 'react'")
    expect(spawn).not.toContain('React.createElement')
    expect(spawn).not.toContain('setToolJSX')
    expect(spawn).not.toContain('queueBehind')
    expect(spawn).not.toContain('abortController.signal')
  })
})
