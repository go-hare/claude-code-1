import { afterAll, describe, expect, mock, test } from 'bun:test'
import * as realConfig from '../config.js'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'

// Snapshot BEFORE mock — live namespace rebinds under Bun mock.module.
// Thin { getGlobalConfig, saveGlobalConfig: noop } permanently breaks
// installPrompt / daemonInstall co-suites (save becomes no-op).
const configSnap = snapshotModuleExports(realConfig)
const realGetGlobalConfig =
  configSnap.getGlobalConfig as typeof realConfig.getGlobalConfig

function configMock() {
  return {
    ...configSnap,
    getGlobalConfig: () => ({
      ...realGetGlobalConfig(),
      fableOverageConsentV2: { 'org-1': true },
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
  buildFableOverageConsentPayload,
  classifyFableCreditsLane,
  getFableConsentCopy,
  hasFableOverageConsent,
  isFableModel,
  planFablePurchaseIntent,
  resolveFableConsentKey,
  resolveUsageCreditsCommandName,
  shouldShowFableConsentDialog,
  showFableOverageConsentDialog,
  runFableOverageConsentFlow,
} from '../fableConsent.js'
import { FABLE_OVERAGE_CONSENT_DIALOG_KIND } from '../printRequestDialog.js'

describe('fableConsent densables', () => {
  test('isFableModel matches official family names', () => {
    expect(isFableModel('fable')).toBe(true)
    expect(isFableModel('fable5')).toBe(true)
    expect(isFableModel('claude-fable-5')).toBe(true)
    expect(isFableModel('claude-fable-5[1m]')).toBe(true)
    expect(isFableModel('opus')).toBe(false)
    expect(isFableModel(null)).toBe(false)
  })

  test('resolveFableConsentKey prefers org then acct', () => {
    expect(
      resolveFableConsentKey({
        organizationUuid: 'org-a',
        accountUuid: 'acct-b',
      }),
    ).toBe('org-a')
    expect(resolveFableConsentKey({ accountUuid: 'acct-b' })).toBe(
      'acct:acct-b',
    )
    expect(resolveFableConsentKey({})).toBeNull()
  })

  test('hasFableOverageConsent reads map', () => {
    expect(hasFableOverageConsent('org-1', { 'org-1': true })).toBe(true)
    expect(hasFableOverageConsent('org-2', { 'org-1': true })).toBe(false)
    expect(hasFableOverageConsent(null)).toBe(false)
  })

  test('shouldShowFableConsentDialog gate', () => {
    expect(
      shouldShowFableConsentDialog({
        model: 'opus',
      }),
    ).toBe(false)
    expect(
      shouldShowFableConsentDialog({
        model: 'claude-fable-5',
        requiresCredits: false,
      }),
    ).toBe(false)
    expect(
      shouldShowFableConsentDialog({
        model: 'claude-fable-5',
        sessionFallbackConsented: true,
      }),
    ).toBe(false)
    expect(
      shouldShowFableConsentDialog({
        model: 'claude-fable-5',
        organizationUuid: 'org-1',
        consentMap: { 'org-1': true },
      }),
    ).toBe(false)
    expect(
      shouldShowFableConsentDialog({
        model: 'claude-fable-5',
        organizationUuid: 'org-2',
        consentMap: { 'org-1': true },
      }),
    ).toBe(true)
    expect(
      shouldShowFableConsentDialog({
        model: 'fable',
      }),
    ).toBe(true)
    // Keyed org without consent must still prompt even if key-less session
    // fallback was previously accepted (cannot bypass new-org consent).
    expect(
      shouldShowFableConsentDialog({
        model: 'claude-fable-5',
        organizationUuid: 'org-new',
        sessionFallbackConsented: true,
        consentMap: {},
      }),
    ).toBe(true)
    // Key-less + session latch still skips.
    expect(
      shouldShowFableConsentDialog({
        model: 'claude-fable-5',
        sessionFallbackConsented: true,
        consentMap: {},
      }),
    ).toBe(false)
  })

  test('getFableConsentCopy variants', () => {
    expect(getFableConsentCopy().acceptLabel).toBe('Continue with Fable 5')
    expect(getFableConsentCopy({ creditsOff: true }).acceptLabel).toBe(
      'Yes, re-enable and continue',
    )
    expect(
      getFableConsentCopy({ noCreditsYet: true, canBuy: true }).acceptLabel,
    ).toBe('Yes, buy usage credits')
  })

  test('buildFableOverageConsentPayload densable', () => {
    expect(
      buildFableOverageConsentPayload({
        overagesEnabled: true,
        balanceCents: 100,
        currency: 'USD',
      }),
    ).toEqual({
      overagesEnabled: true,
      balanceCents: 100,
      currency: 'USD',
    })
  })

  test('showFableOverageConsentDialog X6e densable', async () => {
    const calls: unknown[] = []
    const result = await showFableOverageConsentDialog({
      requestDialog: async (spec, payload) => {
        calls.push({ kind: spec.kind, payload })
        return 'consent'
      },
      overagesEnabled: true,
      balanceCents: 50,
    })
    expect(result).toBe('consent')
    expect(calls).toEqual([
      {
        kind: FABLE_OVERAGE_CONSENT_DIALOG_KIND,
        payload: { overagesEnabled: true, balanceCents: 50 },
      },
    ])

    const cancelled = await showFableOverageConsentDialog({
      requestDialog: async () => 'unknown',
      overagesEnabled: false,
    })
    expect(cancelled).toBe('cancelled')
  })

  test('runFableOverageConsentFlow skips non-fable and already consented', async () => {
    const skip = await runFableOverageConsentFlow({
      model: 'opus',
    })
    expect(skip.choice).toBe('skipped')
    expect(skip.shouldAbort).toBe(false)

    const consented = await runFableOverageConsentFlow({
      model: 'claude-fable-5',
      organizationUuid: 'org-1',
    })
    // org-1 is marked consented in mock config
    expect(consented.choice).toBe('skipped')
    expect(consented.reason).toBe('already_consented')
  })

  test('runFableOverageConsentFlow no host + no fallback aborts', async () => {
    const flow = await runFableOverageConsentFlow({
      model: 'claude-fable-5',
      organizationUuid: 'org-missing',
      requestDialog: null,
      fallbackModel: null,
      isFallbackAllowed: false,
    })
    expect(flow.shouldAbort).toBe(true)
    expect(flow.reason).toBe('no_dialog_fallback')
    expect(flow.errorMessage).toContain('Fable 5')
  })

  test('runFableOverageConsentFlow consent via requestDialog', async () => {
    const flow = await runFableOverageConsentFlow({
      model: 'claude-fable-5',
      organizationUuid: 'org-missing',
      requestDialog: async () => 'consent',
      overagesEnabled: true,
    })
    expect(flow.choice).toBe('consent')
    expect(flow.dialogShown).toBe(true)
    expect(flow.shouldAbort).toBe(false)
  })

  test('runFableOverageConsentFlow switch_default with fallback', async () => {
    const flow = await runFableOverageConsentFlow({
      model: 'claude-fable-5',
      organizationUuid: 'org-missing',
      requestDialog: async () => 'switch_default',
      fallbackModel: 'sonnet',
      isFallbackAllowed: true,
    })
    expect(flow.choice).toBe('switch_default')
    expect(flow.fallbackModel).toBe('sonnet')
    expect(flow.shouldAbort).toBe(false)
    expect(flow.reason).toBe('model_consent_fallback')
    expect(flow.purchaseIntent?.next).toBe('switch_model')
  })

  test('resolveUsageCreditsCommandName aliases', () => {
    expect(resolveUsageCreditsCommandName('usage-credits')).toBe(
      'usage-credits',
    )
    expect(resolveUsageCreditsCommandName('/extra-usage')).toBe('usage-credits')
    expect(resolveUsageCreditsCommandName('usagecredits')).toBe('usage-credits')
    expect(resolveUsageCreditsCommandName('model')).toBeNull()
    expect(resolveUsageCreditsCommandName(null)).toBeNull()
  })

  test('classifyFableCreditsLane densable', () => {
    expect(classifyFableCreditsLane({ overagesEnabled: false }).lane).toBe(
      'credits_off',
    )
    expect(classifyFableCreditsLane({ balanceCents: null }).lane).toBe(
      'no_credits_yet',
    )
    expect(classifyFableCreditsLane({ balanceCents: 0 }).lane).toBe(
      'out_of_credits',
    )
    expect(
      classifyFableCreditsLane({ balanceCents: 0, canPurchase: false })
        .shouldOfferPurchase,
    ).toBe(false)
    expect(classifyFableCreditsLane({ balanceCents: 250 }).lane).toBe(
      'has_balance',
    )
  })

  test('planFablePurchaseIntent densable', () => {
    expect(
      planFablePurchaseIntent({
        choice: 'switch_default',
        lane: 'has_balance',
      }).next,
    ).toBe('switch_model')
    expect(
      planFablePurchaseIntent({ choice: 'cancelled', lane: 'out_of_credits' })
        .next,
    ).toBe('abort')
    expect(
      planFablePurchaseIntent({
        choice: 'consent',
        lane: 'no_credits_yet',
      }),
    ).toEqual({ next: 'open_purchase', commandHint: '/usage-credits' })
    expect(
      planFablePurchaseIntent({
        choice: 'consent',
        lane: 'out_of_credits',
        canPurchase: false,
      }).next,
    ).toBe('mark_consent_only')
    expect(
      planFablePurchaseIntent({
        choice: 'consent',
        lane: 'credits_off',
      }).next,
    ).toBe('mark_consent_only')
    expect(
      planFablePurchaseIntent({
        choice: 'consent',
        lane: 'has_balance',
      }).next,
    ).toBe('mark_consent_only')
  })

  test('runFableOverageConsentFlow consent attaches purchaseIntent', async () => {
    const flow = await runFableOverageConsentFlow({
      model: 'claude-fable-5',
      organizationUuid: 'org-missing',
      requestDialog: async () => 'consent',
      overagesEnabled: true,
      balanceCents: null,
    })
    expect(flow.choice).toBe('consent')
    expect(flow.purchaseIntent?.next).toBe('open_purchase')
    expect(flow.purchaseIntent?.commandHint).toBe('/usage-credits')
    expect(flow.purchaseIntent?.lane).toBe('no_credits_yet')
  })
})
