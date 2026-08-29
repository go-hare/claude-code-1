/**
 * densable iXg(Gxt) — resume_return NMs opener (239 peel).
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'
import * as realAnalytics from 'src/services/analytics/index.js'
import * as realConfig from 'src/utils/config.js'
import * as realGrowthbook from 'src/services/analytics/growthbook.js'

const configSnap = snapshotModuleExports(realConfig)
const analyticsSnap = snapshotModuleExports(realAnalytics)
const growthbookSnap = snapshotModuleExports(realGrowthbook)

const configState = {
  resumeReturnDismissed: false,
}

const events: Array<[string, Record<string, unknown>]> = []

const configMock = {
  ...configSnap,
  getGlobalConfig: () => ({
    ...configSnap.getGlobalConfig(),
    ...configState,
  }),
  saveGlobalConfig: (
    updater:
      | Record<string, unknown>
      | ((c: Record<string, unknown>) => Record<string, unknown>),
  ) => {
    const base = { ...configSnap.getGlobalConfig(), ...configState }
    const next = typeof updater === 'function' ? updater(base) : updater
    if (typeof next.resumeReturnDismissed === 'boolean') {
      configState.resumeReturnDismissed = next.resumeReturnDismissed
    }
  },
}

mock.module('src/utils/config.js', () => configMock)
mock.module('src/utils/config.ts', () => configMock)
mock.module('src/services/analytics/index.js', () => ({
  ...analyticsSnap,
  logEvent: (name: string, props: Record<string, unknown> = {}) => {
    events.push([name, props])
  },
}))
mock.module('src/services/analytics/growthbook.js', () => ({
  ...growthbookSnap,
  getFeatureValue_CACHED_MAY_BE_STALE: (key: string, fallback: unknown) =>
    key === 'tengu_gleaming_fair' ? true : fallback,
}))

const {
  RESUME_RETURN_KIND,
  createDialogMailbox,
  createDialogStore,
  createRequestDialog,
  openResumeReturnIfNeeded,
} = require('../index.js') as typeof import('../index.js')

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
  throw new Error(`timed out waiting for ${kind}`)
}

function oldLargeMessages() {
  const old = new Date(Date.now() - 80 * 60_000).toISOString()
  return [
    { type: 'user' as const, timestamp: old },
    { type: 'assistant' as const, timestamp: old },
  ]
}

beforeEach(() => {
  configState.resumeReturnDismissed = false
  events.length = 0
})

afterAll(() => {
  mock.module('src/utils/config.js', () => ({ ...configSnap }))
  mock.module('src/utils/config.ts', () => ({ ...configSnap }))
  mock.module('src/services/analytics/index.js', () => ({ ...analyticsSnap }))
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
})

describe('openResumeReturnIfNeeded (densable iXg/Gxt)', () => {
  test('skips when gates fail (young/small)', async () => {
    const store = createDialogStore()
    const requestDialog = wireMailbox(store)
    const compactCalls: string[] = []
    expect(
      await openResumeReturnIfNeeded({
        requestDialog,
        dialogStore: store,
        messages: [{ type: 'user', timestamp: new Date().toISOString() }],
        estimateTokens: () => 200_000,
        runCompact: () => compactCalls.push('compact'),
      }),
    ).toBe('skipped')
    expect(store.getState().open).toHaveLength(0)
  })

  test('opens resume_return; never latches dismissed', async () => {
    const store = createDialogStore()
    const requestDialog = wireMailbox(store)
    const pending = openResumeReturnIfNeeded({
      requestDialog,
      dialogStore: store,
      messages: oldLargeMessages(),
      estimateTokens: () => 200_000,
      runCompact: () => {},
    })
    const top = await waitForTop(store, RESUME_RETURN_KIND)
    store.answer(top.id, 'never')
    expect(await pending).toBe('never')
    expect(configState.resumeReturnDismissed).toBe(true)
    expect(events.some(e => e[0] === 'tengu_resume_return_action')).toBe(true)
  })

  test('cancelled returns before tengu_resume_return_action', async () => {
    const store = createDialogStore()
    const requestDialog = wireMailbox(store)
    const pending = openResumeReturnIfNeeded({
      requestDialog,
      dialogStore: store,
      messages: oldLargeMessages(),
      estimateTokens: () => 200_000,
      runCompact: () => {},
    })
    const top = await waitForTop(store, RESUME_RETURN_KIND)
    store.dismiss(top.id)
    expect(await pending).toBe('cancelled')
    expect(events.some(e => e[0] === 'tengu_resume_return_action')).toBe(false)
  })

  test('compact calls runCompact', async () => {
    const store = createDialogStore()
    const requestDialog = wireMailbox(store)
    const compactCalls: string[] = []
    const pending = openResumeReturnIfNeeded({
      requestDialog,
      dialogStore: store,
      messages: oldLargeMessages(),
      estimateTokens: () => 200_000,
      runCompact: () => compactCalls.push('compact'),
    })
    const top = await waitForTop(store, RESUME_RETURN_KIND)
    store.answer(top.id, 'compact')
    expect(await pending).toBe('compact')
    expect(compactCalls).toEqual(['compact'])
  })
})

describe('iXg placement (picker vs REPL)', () => {
  test('picker does not intercept; REPL opens Gxt after load', () => {
    const { readFileSync } = require('fs') as typeof import('fs')
    const { join } = require('path') as typeof import('path')
    const root = join(import.meta.dir, '../..')
    const picker = readFileSync(
      join(root, 'screens/ResumeConversation.tsx'),
      'utf8',
    )
    const repl = readFileSync(join(root, 'screens/REPL.tsx'), 'utf8')
    const jsu = readFileSync(join(root, 'dialog/jsuRenderers.tsx'), 'utf8')
    expect(picker).not.toContain('ResumeReturnDialog')
    expect(picker).not.toContain('evaluateResumeReturnOffer')
    expect(picker).not.toContain('resumeReturnOffer')
    expect(repl).toContain('openResumeReturnIfNeeded')
    expect(repl).toContain('offerResumeReturnIfNeeded(messages)')
    expect(repl).toContain("if (entrypoint !== 'fork')")
    expect(repl).toContain('if (initialMessage !== null)')
    expect(repl).toContain("'/compact'")
    expect(jsu).toContain('ResumeReturnDialog')
    expect(jsu).not.toMatch(/RESUME_RETURN_KIND[\s\S]{0,200}IdleReturnDialog/)
  })
})
