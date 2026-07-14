/**
 * Official 2.1.207 usage-credits / ExtraUsageDialog API surface.
 * Endpoints under /api/oauth/organizations/:orgUUID/… (teleport-org auth).
 */

import axios from 'axios'
import { getOauthConfig } from '../../constants/oauth.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { getOAuthHeaders, prepareApiRequest } from '../../utils/teleport/api.js'

export type PaymentMethod = {
  can_user_purchase_credits?: boolean
  has_chargeable_saved_payment_method?: boolean
  [key: string]: unknown
} | null

export type PrepaidBalance = {
  balance_minor_units?: number
  currency?: string
  [key: string]: unknown
} | null

export type PrepaidBundle = {
  id: string
  credit_minor_units: number
  price_minor_units: number
  discount_minor_units?: number
  local_credit_minor_units?: number
  local_price_minor_units?: number
}

export type CreditsPurchaseRequest =
  | { kind: 'amount'; amountCents: number }
  | { kind: 'bundle'; bundle: PrepaidBundle }

export type CreditsPurchaseResult = {
  payment_status: string
  purchase_id?: string
  payment_intent_client_secret?: string | null
  [key: string]: unknown
}

export type AutoReloadSettings = {
  enabled: boolean
  threshold_in_minor_units?: number
  target_in_minor_units?: number
  [key: string]: unknown
}

export type SpendLimitUpdate = {
  is_enabled: boolean
  monthly_credit_limit?: number | null
  currency?: string
}

async function orgHeaders(): Promise<{
  headers: Record<string, string>
  orgUUID: string
  base: string
}> {
  const { accessToken, orgUUID } = await prepareApiRequest()
  return {
    headers: {
      ...getOAuthHeaders(accessToken),
      'x-organization-uuid': orgUUID,
    },
    orgUUID,
    base: getOauthConfig().BASE_API_URL,
  }
}

/** GET payment_method — whether user can purchase and has a saved card. */
export async function fetchPaymentMethod(): Promise<PaymentMethod> {
  try {
    const { headers, orgUUID, base } = await orgHeaders()
    const url = `${base}/api/oauth/organizations/${orgUUID}/payment_method`
    const res = await axios.get(url, { headers, timeout: 5000 })
    return (res.data ?? null) as PaymentMethod
  } catch (e) {
    logForDebugging(`payment_method unavailable: ${errorMessage(e)}`)
    return null
  }
}

/** GET prepaid/credits balance. */
export async function fetchPrepaidBalance(): Promise<PrepaidBalance> {
  try {
    const { headers, orgUUID, base } = await orgHeaders()
    const url = `${base}/api/oauth/organizations/${orgUUID}/prepaid/credits`
    const res = await axios.get(url, { headers, timeout: 5000 })
    return (res.data ?? null) as PrepaidBalance
  } catch (e) {
    logForDebugging(`prepaid/credits unavailable: ${errorMessage(e)}`)
    return null
  }
}

/** GET prepaid/bundles (purchase presets). */
export async function fetchPrepaidBundles(): Promise<PrepaidBundle[]> {
  try {
    const { headers, orgUUID, base } = await orgHeaders()
    const url = `${base}/api/oauth/organizations/${orgUUID}/prepaid/bundles`
    const res = await axios.get(url, { headers, timeout: 5000 })
    const data = res.data
    if (Array.isArray(data)) return data as PrepaidBundle[]
    if (data && Array.isArray((data as { bundles?: unknown }).bundles)) {
      return (data as { bundles: PrepaidBundle[] }).bundles
    }
    return []
  } catch (e) {
    logForDebugging(`prepaid/bundles unavailable: ${errorMessage(e)}`)
    return []
  }
}

/**
 * POST contracts/prepaid/credits — buy credits by amount or bundle.
 * Official kRu.
 */
export async function purchaseCredits(
  req: CreditsPurchaseRequest,
): Promise<CreditsPurchaseResult> {
  const { headers, orgUUID, base } = await orgHeaders()
  const body =
    req.kind === 'bundle'
      ? {
          amount: req.bundle.credit_minor_units,
          bundle_id: req.bundle.id,
          expected_price_minor_units: req.bundle.price_minor_units,
        }
      : { amount: req.amountCents }
  const url = `${base}/api/oauth/organizations/${orgUUID}/contracts/prepaid/credits`
  const res = await axios.post<CreditsPurchaseResult>(url, body, {
    headers,
    timeout: 30_000,
  })
  return res.data
}

/** Poll prepaid/commits/:id after pending_invoice. Official IRu. */
export async function fetchPurchaseCommitStatus(purchaseId: string): Promise<{
  purchase_id: string
  status: string
  stripe_payment_intent_client_secret?: string | null
}> {
  const { headers, orgUUID, base } = await orgHeaders()
  const url = `${base}/api/oauth/organizations/${orgUUID}/prepaid/commits/${purchaseId}`
  const res = await axios.get(url, { headers, timeout: 10_000 })
  return res.data
}

const SETTLED_PURCHASE_STATUSES = new Set([
  'paid',
  'success',
  'succeeded',
  'failed',
  'canceled',
  'cancelled',
])

/**
 * Poll commit status until settled or attempts exhausted (official pending_invoice path).
 * Returns the last status payload; callers treat paid/success as done and surface
 * requires_action / pending when a bank confirmation (3DS) is still needed.
 */
export async function pollPurchaseUntilSettled(
  purchaseId: string,
  opts?: { attempts?: number; delayMs?: number },
): Promise<{
  purchase_id: string
  status: string
  stripe_payment_intent_client_secret?: string | null
}> {
  const attempts = opts?.attempts ?? 8
  const delayMs = opts?.delayMs ?? 1500
  let last: {
    purchase_id: string
    status: string
    stripe_payment_intent_client_secret?: string | null
  } = { purchase_id: purchaseId, status: 'pending' }
  for (let i = 0; i < attempts; i++) {
    last = await fetchPurchaseCommitStatus(purchaseId)
    if (SETTLED_PURCHASE_STATUSES.has(last.status)) return last
    if (i < attempts - 1) {
      await new Promise(r => setTimeout(r, delayMs))
    }
  }
  return last
}

export type TaxPreview = {
  tax_minor_units: number
  tax_rate_pct: number
  tax_label: string | null
}

/**
 * Official IYi / api_purchase_tax_preview.
 * POST billing/tax_rate with product_id + price + currency.
 * `tax_rate` from API is a percent (e.g. 8.25); tax = round(price * rate / 100).
 */
export async function fetchTaxPreview(params: {
  priceMinorUnits: number
  currency: string
  productId?: string | null
}): Promise<TaxPreview | null> {
  if (!params.productId) {
    logForDebugging('tax_rate preview skipped: no product_id')
    return null
  }
  try {
    const { headers, orgUUID, base } = await orgHeaders()
    const url = `${base}/api/oauth/organizations/${orgUUID}/billing/tax_rate`
    const res = await axios.post(
      url,
      {
        product_id: params.productId,
        price: params.priceMinorUnits,
        currency: params.currency,
      },
      { headers, timeout: 5000 },
    )
    const data = res.data as {
      tax_rate?: number | null
      tax_label?: string | null
    }
    if (data.tax_rate == null) return null
    return {
      tax_minor_units: Math.round(
        (params.priceMinorUnits * data.tax_rate) / 100,
      ),
      tax_rate_pct: data.tax_rate,
      tax_label: data.tax_label ?? null,
    }
  } catch (e) {
    logForDebugging(`tax_rate preview unavailable: ${errorMessage(e)}`)
    return null
  }
}

/** Pure helper for tax math (official IYi). */
export function taxMinorUnitsFromRate(
  priceMinorUnits: number,
  taxRatePct: number,
): number {
  return Math.round((priceMinorUnits * taxRatePct) / 100)
}

/** Official Ij — web settings where 3DS / card verification can be completed. */
export const USAGE_CREDITS_SETTINGS_URL = 'https://claude.ai/settings/usage'

/**
 * Official 3ds_fallback copy when payment_status === requires_action and
 * in-terminal Stripe.js 3DS is unavailable (portable: no Stripe SDK).
 */
export function buildCredits3dsFallbackMessage(
  settingsUrl: string = USAGE_CREDITS_SETTINGS_URL,
): string {
  return `Your card requires additional verification — this purchase was not completed. Try again at ${settingsUrl}`
}

export type CreditsPurchaseUiOutcome =
  | 'success'
  | 'poll'
  | '3ds_fallback'
  | 'unexpected'

/** Map purchase/poll status to ExtraUsageDialog branch (official Oe()). */
export function classifyCreditsPurchaseOutcome(input: {
  paymentStatus: string | undefined | null
  purchaseId?: string | null
  stripeClientSecret?: string | null
}): CreditsPurchaseUiOutcome {
  const status = input.paymentStatus ?? ''
  if (status === 'success' || status === 'succeeded' || status === 'paid') {
    return 'success'
  }
  if (
    (status === 'pending_invoice' || status === 'pending') &&
    input.purchaseId
  ) {
    return 'poll'
  }
  if (status === 'requires_action' || input.stripeClientSecret) {
    return '3ds_fallback'
  }
  return 'unexpected'
}

/**
 * PUT/POST overage_spend_limit — enable overage and/or set monthly cap.
 * Official api_spend_limit_update. `monthly_credit_limit: null` → unlimited.
 */
export async function updateOverageSpendLimit(
  update: SpendLimitUpdate,
): Promise<void> {
  const { headers, orgUUID, base } = await orgHeaders()
  const url = `${base}/api/oauth/organizations/${orgUUID}/overage_spend_limit`
  // Official uses PUT for is_enabled toggle; POST body accepted by gateway too.
  await axios.put(url, update, { headers, timeout: 15_000 }).catch(async () => {
    await axios.post(url, update, { headers, timeout: 15_000 })
  })
}

/**
 * Official PQn first step: POST setup_overage_billing with default org monthly
 * spend limit (2000 minor units), then enable via overage_spend_limit.
 */
export async function setupOverageBilling(
  orgMonthlySpendLimit = 2000,
): Promise<void> {
  const { headers, orgUUID, base } = await orgHeaders()
  const url = `${base}/api/oauth/organizations/${orgUUID}/setup_overage_billing`
  await axios.post(
    url,
    { org_monthly_spend_limit: orgMonthlySpendLimit },
    { headers, timeout: 30_000 },
  )
}

/** Enable overage with no monthly cap (unlimited extra usage). Official PQn. */
export async function enableOverageUnlimited(): Promise<void> {
  // setup_overage_billing is required for some orgs; personal accounts may
  // already be provisioned — treat setup failure as non-fatal and still enable.
  try {
    await setupOverageBilling()
  } catch (e) {
    logForDebugging(`setup_overage_billing skipped: ${errorMessage(e)}`)
  }
  await updateOverageSpendLimit({ is_enabled: true })
}

/**
 * PUT contracts/auto_reload_settings — enable/threshold/target.
 * Official api_auto_reload_update.
 */
export async function updateAutoReloadSettings(settings: {
  enabled: boolean
  threshold_in_minor_units?: number
  target_in_minor_units?: number
}): Promise<void> {
  const { headers, orgUUID, base } = await orgHeaders()
  const url = `${base}/api/oauth/organizations/${orgUUID}/contracts/auto_reload_settings`
  const body: Record<string, unknown> = { enabled: settings.enabled }
  if (settings.threshold_in_minor_units !== undefined) {
    body.threshold_in_minor_units = settings.threshold_in_minor_units
  }
  if (settings.target_in_minor_units !== undefined) {
    body.target_in_minor_units = settings.target_in_minor_units
  }
  await axios.post(url, body, { headers, timeout: 15_000 })
}

/** GET auto_reload_settings when available. */
export async function fetchAutoReloadSettings(): Promise<AutoReloadSettings | null> {
  try {
    const { headers, orgUUID, base } = await orgHeaders()
    const url = `${base}/api/oauth/organizations/${orgUUID}/contracts/auto_reload_settings`
    const res = await axios.get(url, { headers, timeout: 5000 })
    return (res.data ?? null) as AutoReloadSettings | null
  } catch (e) {
    logForDebugging(`auto_reload_settings unavailable: ${errorMessage(e)}`)
    return null
  }
}

/** Default bundle presets when API returns none (official ARu). */
export const DEFAULT_CREDIT_PRESETS_CENTS = [2500, 5000, 7500, 15_000] as const

export function defaultBundlesFromPresets(): PrepaidBundle[] {
  return DEFAULT_CREDIT_PRESETS_CENTS.map(cents => ({
    id: '',
    credit_minor_units: cents,
    price_minor_units: cents,
    discount_minor_units: 0,
    local_credit_minor_units: cents,
    local_price_minor_units: cents,
  }))
}
