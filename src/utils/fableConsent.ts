/**
 * Official Fable 5 overage-consent densables (fableOverageConsentV2 / model_fable_consent).
 * Full credit-purchase / 3DS path remains denser in ExtraUsageDialog.
 */

import { getGlobalConfig, saveGlobalConfig } from './config.js'
import {
  FABLE_OVERAGE_CONSENT_DIALOG_KIND,
  fableOverageConsentDialogSpec,
} from './printRequestDialog.js'

/** Official model family match for Claude Fable 5. */
export function isFableModel(model: string | null | undefined): boolean {
  if (!model) return false
  const m = model
    .toLowerCase()
    .replace(/\[1m\]$/i, '')
    .trim()
  return (
    m === 'fable' ||
    m === 'fable5' ||
    m.includes('claude-fable-5') ||
    m.includes('fable-5')
  )
}

/**
 * Official consent key for an account/org.
 * Prefer organizationUuid; fall back to `acct:${accountUuid}`.
 */
export function resolveFableConsentKey(input?: {
  organizationUuid?: string | null
  accountUuid?: string | null
}): string | null {
  if (input?.organizationUuid) return input.organizationUuid
  if (input?.accountUuid) return `acct:${input.accountUuid}`
  return null
}

/**
 * Official densable — has the user already consented for this key?
 */
export function hasFableOverageConsent(
  key: string | null | undefined,
  consentMap?: Readonly<Record<string, boolean>> | null,
): boolean {
  if (!key) return false
  const map = consentMap ?? getGlobalConfig().fableOverageConsentV2 ?? null
  return map?.[key] === true
}

/**
 * Official weh densable — persist consent for key (idempotent).
 */
export function markFableOverageConsent(key: string): void {
  if (!key) return
  const cur = getGlobalConfig().fableOverageConsentV2?.[key]
  if (cur === true) return
  saveGlobalConfig(prev => ({
    ...prev,
    fableOverageConsentV2: {
      ...prev.fableOverageConsentV2,
      [key]: true,
    },
  }))
}

export type FableConsentGateInput = {
  model: string | null | undefined
  organizationUuid?: string | null
  accountUuid?: string | null
  /** Session fallback when no org/account key is available. */
  sessionFallbackConsented?: boolean
  consentMap?: Readonly<Record<string, boolean>> | null
  /** When false, never require consent (non-subscriber / already billed path). */
  requiresCredits?: boolean
}

/**
 * Official densable — should Fable consent dialog block model selection / first use?
 * Requires fable model + credits required + no stored/session consent.
 *
 * Session fallback only applies when there is no org/account key. A prior
 * key-less consent must not skip the dialog for a later org that has no
 * persisted fableOverageConsentV2 entry.
 */
export function shouldShowFableConsentDialog(
  input: FableConsentGateInput,
): boolean {
  if (!isFableModel(input.model)) return false
  if (input.requiresCredits === false) return false
  const key = resolveFableConsentKey(input)
  if (key === null) {
    // Official xJe: no key → session fallback path; dialog still needed once.
    return !input.sessionFallbackConsented
  }
  return !hasFableOverageConsent(key, input.consentMap)
}

/**
 * When ModelPicker defers N9/effort behind Fable consent, only apply after
 * accept (or immediately when consent is not required). Decline/cancel → false.
 */
export function shouldApplyDeferredEffortCommit(input: {
  consentRequired: boolean
  accepted?: boolean
}): boolean {
  if (!input.consentRequired) return true
  return input.accepted === true
}

export type FableConsentCopy = {
  title: string
  body: string
  acceptLabel: string
  declineLabel: string
}

/** Official UI copy densable for Fable consent dialog. */
export function getFableConsentCopy(input?: {
  creditsOff?: boolean
  noCreditsYet?: boolean
  canBuy?: boolean
}): FableConsentCopy {
  if (input?.creditsOff) {
    return {
      title: "You've reached your Fable 5 limit.",
      body: 'Usage credits are turned off. Re-enable to use Fable 5.',
      acceptLabel: 'Yes, re-enable and continue',
      declineLabel: 'Not now',
    }
  }
  if (input?.noCreditsYet) {
    return {
      title: 'Fable 5 requires usage credits.',
      body: "You don't have usage credits yet.",
      acceptLabel: input.canBuy
        ? 'Yes, buy usage credits'
        : 'Buy usage credits',
      declineLabel: 'Not now',
    }
  }
  return {
    title: 'Fable 5 requires usage credits.',
    body: "You're out of usage credits. Run /usage-credits to keep using Fable 5 or /model to switch models.",
    acceptLabel: 'Continue with Fable 5',
    declineLabel: 'Not now',
  }
}

/**
 * Official slash-command aliases densable — /extra-usage is now /usage-credits.
 */
export function resolveUsageCreditsCommandName(
  command: string | null | undefined,
): string | null {
  if (!command) return null
  const c = command.trim().replace(/^\//, '').toLowerCase()
  if (c === 'usage-credits' || c === 'extra-usage' || c === 'usagecredits') {
    return 'usage-credits'
  }
  return null
}

/**
 * Official balance/copy lane densable for ExtraUsageDialog-ish UI.
 * purchase denser remains Stripe 3DS; this only classifies the lane.
 */
export function classifyFableCreditsLane(input: {
  overagesEnabled?: boolean
  balanceCents?: number | null
  canPurchase?: boolean
}): {
  lane: 'credits_off' | 'no_credits_yet' | 'out_of_credits' | 'has_balance'
  copy: FableConsentCopy
  shouldOfferPurchase: boolean
} {
  if (input.overagesEnabled === false) {
    return {
      lane: 'credits_off',
      copy: getFableConsentCopy({ creditsOff: true }),
      shouldOfferPurchase: false,
    }
  }
  const balance = input.balanceCents
  if (balance == null || balance <= 0) {
    const noCreditsYet = balance == null
    return {
      lane: noCreditsYet ? 'no_credits_yet' : 'out_of_credits',
      copy: getFableConsentCopy({
        noCreditsYet,
        canBuy: input.canPurchase !== false,
      }),
      shouldOfferPurchase: input.canPurchase !== false,
    }
  }
  return {
    lane: 'has_balance',
    copy: getFableConsentCopy(),
    shouldOfferPurchase: false,
  }
}

/**
 * Official purchase-intent densable after consent accept.
 * Full ExtraUsageDialog 3DS remains denser — this only decides next step.
 */
export function planFablePurchaseIntent(input: {
  choice: 'consent' | 'switch_default' | 'cancelled'
  lane: ReturnType<typeof classifyFableCreditsLane>['lane']
  canPurchase?: boolean
}): {
  next:
    | 'mark_consent_only'
    | 'open_purchase'
    | 'switch_model'
    | 'abort'
    | 'noop'
  commandHint?: string
} {
  if (input.choice === 'switch_default') {
    return { next: 'switch_model' }
  }
  if (input.choice === 'cancelled') {
    return { next: 'abort' }
  }
  // consent
  if (
    input.canPurchase !== false &&
    (input.lane === 'no_credits_yet' || input.lane === 'out_of_credits')
  ) {
    return { next: 'open_purchase', commandHint: '/usage-credits' }
  }
  if (input.lane === 'credits_off') {
    return { next: 'mark_consent_only' }
  }
  return { next: 'mark_consent_only' }
}

/** Official X6e payload densable. */
export function buildFableOverageConsentPayload(input: {
  overagesEnabled: boolean
  balanceCents?: number | null
  currency?: string | null
}): {
  overagesEnabled: boolean
  balanceCents?: number | null
  currency?: string | null
} {
  return {
    overagesEnabled: input.overagesEnabled,
    ...(input.balanceCents !== undefined && {
      balanceCents: input.balanceCents,
    }),
    ...(input.currency !== undefined && { currency: input.currency }),
  }
}

export type ShowFableOverageConsentDialogInput = {
  requestDialog: (
    spec: {
      kind: string
      default: 'consent' | 'switch_default' | 'cancelled'
    },
    payload: unknown,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>
  overagesEnabled: boolean
  balanceCents?: number | null
  currency?: string | null
  signal?: AbortSignal
  /**
   * Official: when set, race requestDialog against this timeout (bridge path
   * uses a dedicated AbortController). Local path passes tool abort signal.
   */
  parkTimeoutMs?: number
}

/**
 * Official requestDialog(X6e, {overagesEnabled}) densable.
 * Full ORu persist-after-consent + abort-reason handling remains denser at
 * query call sites; this covers the dialog show + result parse.
 */
export async function showFableOverageConsentDialog(
  input: ShowFableOverageConsentDialogInput,
): Promise<'consent' | 'switch_default' | 'cancelled'> {
  const payload = buildFableOverageConsentPayload({
    overagesEnabled: input.overagesEnabled,
    balanceCents: input.balanceCents,
    currency: input.currency,
  })
  const spec = {
    kind: fableOverageConsentDialogSpec.kind,
    default: fableOverageConsentDialogSpec.default,
  }

  const parse = (
    result: unknown,
  ): 'consent' | 'switch_default' | 'cancelled' => {
    if (
      result === 'consent' ||
      result === 'switch_default' ||
      result === 'cancelled'
    ) {
      return result
    }
    return 'cancelled'
  }

  if (input.parkTimeoutMs !== undefined && input.parkTimeoutMs > 0) {
    const localAbort = new AbortController()
    const onParentAbort = () => localAbort.abort()
    input.signal?.addEventListener('abort', onParentAbort, { once: true })
    const timeout = setTimeout(() => localAbort.abort(), input.parkTimeoutMs)
    try {
      return parse(
        await input.requestDialog(spec, payload, { signal: localAbort.signal }),
      )
    } finally {
      clearTimeout(timeout)
      input.signal?.removeEventListener('abort', onParentAbort)
    }
  }

  return parse(
    await input.requestDialog(spec, payload, { signal: input.signal }),
  )
}

export type FableOverageConsentFlowReason =
  | 'already_consented'
  | 'not_fable'
  | 'no_dialog_fallback'
  | 'overage_enable_deferred'
  | 'bridge_dialog_timeout'
  | 'dialog_declined'
  | 'no_allowed_fallback'
  | 'model_consent_fallback'
  | 'credits_not_required'

export type FableOverageConsentFlowResult = {
  choice: 'consent' | 'switch_default' | 'cancelled' | 'skipped'
  reason?: FableOverageConsentFlowReason
  dialogShown: boolean
  /** Official query_setup abort when no usable path remains. */
  shouldAbort: boolean
  /** Official model_consent_fallback target when user switches. */
  fallbackModel?: string | null
  errorMessage?: string
  /**
   * Official purchase-intent densable after dialog (ExtraUsageDialog 3DS denser).
   * Present when consent/switch path ran the lane classifier.
   */
  purchaseIntent?: {
    next:
      | 'mark_consent_only'
      | 'open_purchase'
      | 'switch_model'
      | 'abort'
      | 'noop'
    commandHint?: string
    lane?: ReturnType<typeof classifyFableCreditsLane>['lane']
  }
}

/**
 * Official model_fable_consent query_setup densable (X6e + ORu subset).
 *
 * - Gate with shouldShowFableConsentDialog
 * - requestDialog(X6e) when host present
 * - consent → markFableOverageConsent (ORu)
 * - switch_default → fallbackModel when allowed
 * - cancelled / no host / no fallback → shouldAbort with official copy
 *
 * Full ExtraUsageDialog 3DS purchase path remains denser.
 */
export async function runFableOverageConsentFlow(input: {
  model: string | null | undefined
  requestDialog?: ShowFableOverageConsentDialogInput['requestDialog'] | null
  organizationUuid?: string | null
  accountUuid?: string | null
  sessionFallbackConsented?: boolean
  requiresCredits?: boolean
  overagesEnabled?: boolean
  balanceCents?: number | null
  currency?: string | null
  signal?: AbortSignal
  parkTimeoutMs?: number
  /** Official non-fable fallback when user declines / switches. */
  fallbackModel?: string | null
  /** When false, decline with no_allowed_fallback. */
  isFallbackAllowed?: boolean
  /** Session-level consent latch callback when no org/account key. */
  onSessionConsent?: () => void
}): Promise<FableOverageConsentFlowResult> {
  if (!isFableModel(input.model)) {
    return {
      choice: 'skipped',
      reason: 'not_fable',
      dialogShown: false,
      shouldAbort: false,
    }
  }
  if (input.requiresCredits === false) {
    return {
      choice: 'skipped',
      reason: 'credits_not_required',
      dialogShown: false,
      shouldAbort: false,
    }
  }

  const gate = {
    model: input.model,
    organizationUuid: input.organizationUuid,
    accountUuid: input.accountUuid,
    sessionFallbackConsented: input.sessionFallbackConsented,
    requiresCredits: input.requiresCredits,
  }
  if (!shouldShowFableConsentDialog(gate)) {
    return {
      choice: 'skipped',
      reason: 'already_consented',
      dialogShown: false,
      shouldAbort: false,
    }
  }

  if (!input.requestDialog) {
    // Official no_dialog_fallback — headless without cvf host.
    const fallbackOk =
      input.isFallbackAllowed !== false && Boolean(input.fallbackModel)
    if (fallbackOk) {
      return {
        choice: 'switch_default',
        reason: 'no_dialog_fallback',
        dialogShown: false,
        shouldAbort: false,
        fallbackModel: input.fallbackModel,
      }
    }
    return {
      choice: 'cancelled',
      reason: 'no_dialog_fallback',
      dialogShown: false,
      shouldAbort: true,
      errorMessage:
        'Your model policy only allows Fable 5, which requires usage credits — /model to set it up',
    }
  }

  let choice: 'consent' | 'switch_default' | 'cancelled'
  try {
    choice = await showFableOverageConsentDialog({
      requestDialog: input.requestDialog,
      overagesEnabled: input.overagesEnabled ?? true,
      balanceCents: input.balanceCents,
      currency: input.currency,
      signal: input.signal,
      parkTimeoutMs: input.parkTimeoutMs,
    })
  } catch {
    // Official bridge_dialog_timeout / abort → treat as cancelled
    choice = 'cancelled'
    return {
      choice: 'cancelled',
      reason: 'bridge_dialog_timeout',
      dialogShown: true,
      shouldAbort: true,
      errorMessage: 'Fable 5 requires usage credits. /model to switch models.',
    }
  }

  // Official credits-lane densable (Stripe 3DS purchase remains denser).
  const laneInfo = classifyFableCreditsLane({
    overagesEnabled: input.overagesEnabled,
    balanceCents: input.balanceCents,
    canPurchase: true,
  })
  const purchaseIntentBase = planFablePurchaseIntent({
    choice,
    lane: laneInfo.lane,
    canPurchase: laneInfo.shouldOfferPurchase,
  })
  const purchaseIntent = {
    ...purchaseIntentBase,
    lane: laneInfo.lane,
  }

  if (choice === 'consent') {
    // Official ORu densable — persist consent when key available.
    const key = resolveFableConsentKey({
      organizationUuid: input.organizationUuid,
      accountUuid: input.accountUuid,
    })
    if (key) {
      markFableOverageConsent(key)
    } else {
      input.onSessionConsent?.()
    }
    return {
      choice: 'consent',
      reason: 'overage_enable_deferred',
      dialogShown: true,
      shouldAbort: false,
      purchaseIntent,
    }
  }

  if (choice === 'switch_default') {
    const fallbackOk =
      input.isFallbackAllowed !== false && Boolean(input.fallbackModel)
    if (fallbackOk) {
      return {
        choice: 'switch_default',
        reason: 'model_consent_fallback',
        dialogShown: true,
        shouldAbort: false,
        fallbackModel: input.fallbackModel,
        purchaseIntent,
      }
    }
    return {
      choice: 'switch_default',
      reason: 'no_allowed_fallback',
      dialogShown: true,
      shouldAbort: true,
      errorMessage:
        'Fable consent declined and the model policy allows no non-Fable fallback',
      purchaseIntent,
    }
  }

  // cancelled / dismissed
  const fallbackOk =
    input.isFallbackAllowed !== false && Boolean(input.fallbackModel)
  if (fallbackOk) {
    return {
      choice: 'cancelled',
      reason: 'dialog_declined',
      dialogShown: true,
      shouldAbort: false,
      fallbackModel: input.fallbackModel,
      purchaseIntent,
    }
  }
  return {
    choice: 'cancelled',
    reason: 'no_allowed_fallback',
    dialogShown: true,
    shouldAbort: true,
    errorMessage:
      'Fable consent declined and the model policy allows no non-Fable fallback',
    purchaseIntent,
  }
}

export { FABLE_OVERAGE_CONSENT_DIALOG_KIND }
