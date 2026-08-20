import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { randomUUID } from 'crypto'
import * as realConfig from '../config.js'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'
import { enqueue, resetCommandQueue } from '../messageQueueManager.js'

const configSnap = snapshotModuleExports(realConfig)
const realGetGlobalConfig =
  configSnap.getGlobalConfig as typeof realConfig.getGlobalConfig

function configMock() {
  return {
    ...configSnap,
    getGlobalConfig: () => ({
      ...realGetGlobalConfig(),
      fableOverageConsentV2: {},
    }),
  }
}
mock.module('../config.js', configMock)
mock.module('src/utils/config.js', configMock)
afterAll(() => {
  mock.module('../config.js', () => ({ ...configSnap }))
  mock.module('src/utils/config.js', () => ({ ...configSnap }))
})

import {
  FABLE_CONSENT_UNANSWERED_COPY,
  FABLE_CONSENT_UNANSWERED_ERROR,
  isFableParkQueuePrompt,
  runFableOverageConsentFlow,
  shouldWatchFableParkCommandQueue,
  showFableOverageConsentDialog,
} from '../fableConsent.js'
import { getMainThreadAgentId } from '../../bootstrap/state.js'

describe('fableConsent parkTimeout densable 2.1.236 #14', () => {
  afterEach(() => {
    resetCommandQueue()
    delete process.env.CLAUDE_CODE_SESSION_KIND
  })

  test('shouldWatchFableParkCommandQueue matches densable xo=!rkt&&vIt', () => {
    expect(
      shouldWatchFableParkCommandQueue({
        sdkDialogHostActive: true,
        replBridgeActive: true,
      }),
    ).toBe(false)
    expect(
      shouldWatchFableParkCommandQueue({
        sdkDialogHostActive: false,
        replBridgeActive: true,
      }),
    ).toBe(true)
    expect(
      shouldWatchFableParkCommandQueue({
        sdkDialogHostActive: false,
        replBridgeActive: false,
        env: { CLAUDE_CODE_SESSION_KIND: 'bg' },
        teammateAgentId: undefined,
      }),
    ).toBe(true)
    expect(
      shouldWatchFableParkCommandQueue({
        sdkDialogHostActive: false,
        replBridgeActive: false,
        env: {},
        teammateAgentId: 'agent-1',
      }),
    ).toBe(true)
    expect(
      shouldWatchFableParkCommandQueue({
        sdkDialogHostActive: false,
        replBridgeActive: false,
        env: {},
        teammateAgentId: undefined,
      }),
    ).toBe(false)
  })

  test('isFableParkQueuePrompt is densable J1t (main + prompt)', () => {
    const main = getMainThreadAgentId()
    expect(
      isFableParkQueuePrompt({
        value: 'hi',
        mode: 'prompt',
        agentId: main,
      } as never),
    ).toBe(true)
    expect(
      isFableParkQueuePrompt({
        value: 'hi',
        mode: 'bash',
        agentId: main,
      } as never),
    ).toBe(false)
    expect(
      isFableParkQueuePrompt({
        value: 'hi',
        mode: 'prompt',
        agentId: 'other-agent' as never,
      } as never),
    ).toBe(false)
  })

  test('parkTimeout cancelled → unanswered; flow aborts without fallback', async () => {
    const parent = new AbortController()
    const shown = await showFableOverageConsentDialog({
      requestDialog: async (_spec, _payload, options) => {
        await new Promise<void>((resolve, reject) => {
          const signal = options?.signal
          if (!signal) {
            resolve()
            return
          }
          if (signal.aborted) {
            resolve()
            return
          }
          signal.addEventListener(
            'abort',
            () => {
              // Bridge returns dialog default without throw (tip bug path).
              resolve()
            },
            { once: true },
          )
        })
        return 'cancelled'
      },
      overagesEnabled: true,
      signal: parent.signal,
      parkTimeoutMs: 20,
      // densable Ns=xo&&On>0 — force xo watch so park timeout arms.
      watchCommandQueue: true,
    })
    expect(shown).toBe('unanswered')
    expect(parent.signal.aborted).toBe(false)

    const flow = await runFableOverageConsentFlow({
      model: 'claude-fable-5',
      organizationUuid: 'org-park-timeout',
      requestDialog: async (_spec, _payload, options) => {
        await new Promise<void>(resolve => {
          const signal = options?.signal
          if (!signal || signal.aborted) {
            resolve()
            return
          }
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
        return 'cancelled'
      },
      signal: parent.signal,
      parkTimeoutMs: 20,
      fallbackModel: 'sonnet',
      isFallbackAllowed: true,
      overagesEnabled: true,
      watchCommandQueue: true,
    })
    expect(flow.choice).toBe('cancelled')
    expect(flow.reason).toBe('dialog_unanswered')
    expect(flow.shouldAbort).toBe(true)
    expect(flow.dialogShown).toBe(true)
    expect(flow.fallbackModel).toBeUndefined()
    expect(flow.errorMessage).toBe(FABLE_CONSENT_UNANSWERED_COPY)
    // SEA Error("Fable consent dialog was not answered") — tip surfaces
    // unanswered copy via errorMessage for query shouldAbort content.
    expect(FABLE_CONSENT_UNANSWERED_ERROR).toBe(
      'Fable consent dialog was not answered',
    )
  })

  test('soft cancel without parkTimeout still dialog_declined + fallback', async () => {
    const flow = await runFableOverageConsentFlow({
      model: 'claude-fable-5',
      organizationUuid: 'org-soft-cancel',
      requestDialog: async () => 'cancelled',
      fallbackModel: 'sonnet',
      isFallbackAllowed: true,
      overagesEnabled: true,
    })
    expect(flow.choice).toBe('cancelled')
    expect(flow.reason).toBe('dialog_declined')
    expect(flow.shouldAbort).toBe(false)
    expect(flow.fallbackModel).toBe('sonnet')
  })

  test('switch_default still sets model_consent_fallback', async () => {
    const flow = await runFableOverageConsentFlow({
      model: 'claude-fable-5',
      organizationUuid: 'org-switch-default',
      requestDialog: async () => 'switch_default',
      fallbackModel: 'sonnet',
      isFallbackAllowed: true,
      parkTimeoutMs: 5_000,
      overagesEnabled: true,
    })
    expect(flow.choice).toBe('switch_default')
    expect(flow.reason).toBe('model_consent_fallback')
    expect(flow.shouldAbort).toBe(false)
    expect(flow.fallbackModel).toBe('sonnet')
  })

  test('requestDialog throw maps to dialog_unanswered abort (no bridge_dialog_timeout)', async () => {
    const flow = await runFableOverageConsentFlow({
      model: 'claude-fable-5',
      organizationUuid: 'org-throw',
      requestDialog: async () => {
        throw new Error('dialog aborted')
      },
      parkTimeoutMs: 50,
      fallbackModel: 'sonnet',
      isFallbackAllowed: true,
      overagesEnabled: true,
      watchCommandQueue: true,
    })
    expect(flow.choice).toBe('cancelled')
    expect(flow.reason).toBe('dialog_unanswered')
    expect(flow.shouldAbort).toBe(true)
    expect(flow.fallbackModel).toBeUndefined()
    expect(flow.errorMessage).toBe(FABLE_CONSENT_UNANSWERED_COPY)
    expect(flow.reason).not.toBe('bridge_dialog_timeout' as never)
  })

  test('parent abort during park → cancelled not unanswered', async () => {
    const parent = new AbortController()
    const pending = showFableOverageConsentDialog({
      requestDialog: async (_spec, _payload, options) => {
        await new Promise<void>(resolve => {
          const signal = options?.signal
          if (!signal || signal.aborted) {
            resolve()
            return
          }
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
        return 'cancelled'
      },
      overagesEnabled: true,
      signal: parent.signal,
      parkTimeoutMs: 5_000,
      watchCommandQueue: true,
    })
    parent.abort()
    await expect(pending).resolves.toBe('cancelled')
  })

  test('parent abort during park → flow parent_aborted (no dialog_declined/fallback)', async () => {
    const parent = new AbortController()
    const flowPromise = runFableOverageConsentFlow({
      model: 'claude-fable-5',
      organizationUuid: 'org-parent-abort',
      requestDialog: async (_spec, _payload, options) => {
        await new Promise<void>(resolve => {
          const signal = options?.signal
          if (!signal || signal.aborted) {
            resolve()
            return
          }
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
        return 'cancelled'
      },
      signal: parent.signal,
      parkTimeoutMs: 5_000,
      fallbackModel: 'sonnet',
      isFallbackAllowed: true,
      overagesEnabled: true,
      watchCommandQueue: true,
    })
    parent.abort()
    const flow = await flowPromise
    expect(flow.choice).toBe('cancelled')
    expect(flow.reason).toBe('parent_aborted')
    expect(flow.shouldAbort).toBe(true)
    expect(flow.fallbackModel).toBeUndefined()
    expect(flow.reason).not.toBe('dialog_declined')
  })

  test('!xo does not arm parkTimeout (no unanswered from timeout alone)', async () => {
    const parent = new AbortController()
    let dialogSawAbort = false
    const shown = await showFableOverageConsentDialog({
      requestDialog: async (_spec, _payload, options) => {
        await new Promise<void>(resolve => {
          const signal = options?.signal
          if (!signal) {
            resolve()
            return
          }
          if (signal.aborted) {
            dialogSawAbort = true
            resolve()
            return
          }
          const t = setTimeout(() => resolve(), 40)
          signal.addEventListener(
            'abort',
            () => {
              dialogSawAbort = true
              clearTimeout(t)
              resolve()
            },
            { once: true },
          )
        })
        return dialogSawAbort ? 'cancelled' : 'consent'
      },
      overagesEnabled: true,
      signal: parent.signal,
      parkTimeoutMs: 10,
      watchCommandQueue: false,
    })
    expect(shown).toBe('consent')
    expect(dialogSawAbort).toBe(false)
    expect(parent.signal.aborted).toBe(false)
  })

  test('new main-thread prompt during xo park → dialog_queued_at_park abort', async () => {
    resetCommandQueue()
    const parent = new AbortController()

    const shownPromise = showFableOverageConsentDialog({
      requestDialog: async (_spec, _payload, options) => {
        await new Promise<void>(resolve => {
          const signal = options?.signal
          if (!signal || signal.aborted) {
            resolve()
            return
          }
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
        return 'cancelled'
      },
      overagesEnabled: true,
      signal: parent.signal,
      parkTimeoutMs: 5_000,
      // Force densable xo watch (avoid process-global sdkDialogHost pollution).
      watchCommandQueue: true,
    })

    await new Promise(resolve => setTimeout(resolve, 5))
    enqueue({
      value: 'queued during park',
      mode: 'prompt',
      uuid: randomUUID(),
      agentId: getMainThreadAgentId(),
    })

    await expect(shownPromise).resolves.toBe('queued_at_park')
    expect(parent.signal.aborted).toBe(false)

    resetCommandQueue()
    const flowPromise = runFableOverageConsentFlow({
      model: 'claude-fable-5',
      organizationUuid: 'org-queued-at-park',
      requestDialog: async (_spec, _payload, options) => {
        await new Promise<void>(resolve => {
          const signal = options?.signal
          if (!signal || signal.aborted) {
            resolve()
            return
          }
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
        return 'cancelled'
      },
      signal: parent.signal,
      parkTimeoutMs: 5_000,
      fallbackModel: 'sonnet',
      isFallbackAllowed: true,
      overagesEnabled: true,
      watchCommandQueue: true,
    })
    await new Promise(resolve => setTimeout(resolve, 5))
    enqueue({
      value: 'queued during flow park',
      mode: 'prompt',
      uuid: randomUUID(),
      agentId: getMainThreadAgentId(),
    })
    const flow = await flowPromise
    expect(flow.choice).toBe('cancelled')
    expect(flow.reason).toBe('dialog_queued_at_park')
    expect(flow.shouldAbort).toBe(true)
    expect(flow.fallbackModel).toBeUndefined()
    expect(flow.errorMessage).toBe(FABLE_CONSENT_UNANSWERED_COPY)
  })
})
