// Mock rate limits for testing [ANT-ONLY]
// This allows testing various rate limit scenarios without hitting actual limits
//
// ⚠️  WARNING: This is for internal testing/demo purposes only!
// The mock headers may not exactly match the API specification or real-world behavior.
// Always validate against actual API responses before relying on this for production features.

import type { SubscriptionType } from '../services/oauth/types.js'
import { setMockBillingAccessOverride } from '../utils/billing.js'
import { getBootstrapSessionHost, HostSlot } from '../utils/sessionHost.js'
import type { OverageDisabledReason } from './claudeAiLimits.js'

type MockHeaders = {
  'anthropic-ratelimit-unified-status'?:
    | 'allowed'
    | 'allowed_warning'
    | 'rejected'
  'anthropic-ratelimit-unified-reset'?: string
  'anthropic-ratelimit-unified-representative-claim'?:
    | 'five_hour'
    | 'seven_day'
    | 'seven_day_opus'
    | 'seven_day_sonnet'
  'anthropic-ratelimit-unified-overage-status'?:
    | 'allowed'
    | 'allowed_warning'
    | 'rejected'
  'anthropic-ratelimit-unified-overage-reset'?: string
  'anthropic-ratelimit-unified-overage-disabled-reason'?: OverageDisabledReason
  'anthropic-ratelimit-unified-fallback'?: 'available'
  'anthropic-ratelimit-unified-fallback-percentage'?: string
  'retry-after'?: string
  // Early warning utilization headers
  'anthropic-ratelimit-unified-5h-utilization'?: string
  'anthropic-ratelimit-unified-5h-reset'?: string
  'anthropic-ratelimit-unified-5h-surpassed-threshold'?: string
  'anthropic-ratelimit-unified-7d-utilization'?: string
  'anthropic-ratelimit-unified-7d-reset'?: string
  'anthropic-ratelimit-unified-7d-surpassed-threshold'?: string
  'anthropic-ratelimit-unified-overage-utilization'?: string
  'anthropic-ratelimit-unified-overage-surpassed-threshold'?: string
}

export type MockHeaderKey =
  | 'status'
  | 'reset'
  | 'claim'
  | 'overage-status'
  | 'overage-reset'
  | 'overage-disabled-reason'
  | 'fallback'
  | 'fallback-percentage'
  | 'retry-after'
  | '5h-utilization'
  | '5h-reset'
  | '5h-surpassed-threshold'
  | '7d-utilization'
  | '7d-reset'
  | '7d-surpassed-threshold'

export type MockScenario =
  | 'normal'
  | 'session-limit-reached'
  | 'approaching-weekly-limit'
  | 'weekly-limit-reached'
  | 'overage-active'
  | 'overage-warning'
  | 'overage-exhausted'
  | 'out-of-credits'
  | 'org-zero-credit-limit'
  | 'org-spend-cap-hit'
  | 'member-zero-credit-limit'
  | 'seat-tier-zero-credit-limit'
  | 'opus-limit'
  | 'opus-warning'
  | 'sonnet-limit'
  | 'sonnet-warning'
  | 'fast-mode-limit'
  | 'fast-mode-short-limit'
  | 'extra-usage-required'
  | 'clear'

// Default subscription type for mock testing
const DEFAULT_MOCK_SUBSCRIPTION: SubscriptionType = 'max'

// Track individual exceeded limits with their reset times
type ExceededLimit = {
  type: 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet'
  resetsAt: number // Unix timestamp
}

type MockRateLimitHostState = {
  mockHeaders: MockHeaders
  mockEnabled: boolean
  mockHeaderless429Message: string | null
  mockSubscriptionType: SubscriptionType | null
  mockFastModeRateLimitDurationMs: number | null
  mockFastModeRateLimitExpiresAt: number | null
  exceededLimits: ExceededLimit[]
}

const mockRateLimitHostSlot = new HostSlot<MockRateLimitHostState>(() => ({
  mockHeaders: {},
  mockEnabled: false,
  mockHeaderless429Message: null,
  mockSubscriptionType: null,
  mockFastModeRateLimitDurationMs: null,
  mockFastModeRateLimitExpiresAt: null,
  exceededLimits: [],
}))

function getMockRateLimitState(): MockRateLimitHostState {
  return mockRateLimitHostSlot.of(getBootstrapSessionHost())
}

// New approach: Toggle individual headers
export function setMockHeader(
  key: MockHeaderKey,
  value: string | undefined,
): void {
  if (process.env.USER_TYPE !== 'ant') {
    return
  }

  const state = getMockRateLimitState()
  state.mockEnabled = true

  // Special case for retry-after which doesn't have the prefix
  const fullKey = (
    key === 'retry-after' ? 'retry-after' : `anthropic-ratelimit-unified-${key}`
  ) as keyof MockHeaders

  if (value === undefined || value === 'clear') {
    delete state.mockHeaders[fullKey]
    if (key === 'claim') {
      state.exceededLimits = []
    }
    // Update retry-after if status changed
    if (key === 'status' || key === 'overage-status') {
      updateRetryAfter(state)
    }
    return
  } else {
    // Handle special cases for reset times
    if (key === 'reset' || key === 'overage-reset') {
      // If user provides a number, treat it as hours from now
      const hours = Number(value)
      if (!isNaN(hours)) {
        value = String(Math.floor(Date.now() / 1000) + hours * 3600)
      }
    }

    // Handle claims - add to exceeded limits
    if (key === 'claim') {
      const validClaims = [
        'five_hour',
        'seven_day',
        'seven_day_opus',
        'seven_day_sonnet',
      ]
      if (validClaims.includes(value)) {
        // Determine reset time based on claim type
        let resetsAt: number
        if (value === 'five_hour') {
          resetsAt = Math.floor(Date.now() / 1000) + 5 * 3600
        } else if (
          value === 'seven_day' ||
          value === 'seven_day_opus' ||
          value === 'seven_day_sonnet'
        ) {
          resetsAt = Math.floor(Date.now() / 1000) + 7 * 24 * 3600
        } else {
          resetsAt = Math.floor(Date.now() / 1000) + 3600
        }

        // Add to exceeded limits (remove if already exists)
        state.exceededLimits = state.exceededLimits.filter(
          l => l.type !== value,
        )
        state.exceededLimits.push({
          type: value as ExceededLimit['type'],
          resetsAt,
        })

        // Set the representative claim (furthest reset time)
        updateRepresentativeClaim(state)
        return
      }
    }
    // Widen to a string-valued record so dynamic key assignment is allowed.
    // MockHeaders values are string-literal unions; assigning a raw user-input
    // string requires widening, but this is mock/test code so it's acceptable.
    const headers: Partial<Record<keyof MockHeaders, string>> =
      state.mockHeaders
    headers[fullKey] = value

    // Update retry-after if status changed
    if (key === 'status' || key === 'overage-status') {
      updateRetryAfter(state)
    }
  }

  // If all headers are cleared, disable mocking
  if (Object.keys(state.mockHeaders).length === 0) {
    state.mockEnabled = false
  }
}

// Helper to update retry-after based on current state
function updateRetryAfter(state: MockRateLimitHostState): void {
  const status = state.mockHeaders['anthropic-ratelimit-unified-status']
  const overageStatus =
    state.mockHeaders['anthropic-ratelimit-unified-overage-status']
  const reset = state.mockHeaders['anthropic-ratelimit-unified-reset']

  if (
    status === 'rejected' &&
    (!overageStatus || overageStatus === 'rejected') &&
    reset
  ) {
    // Calculate seconds until reset
    const resetTimestamp = Number(reset)
    const secondsUntilReset = Math.max(
      0,
      resetTimestamp - Math.floor(Date.now() / 1000),
    )
    state.mockHeaders['retry-after'] = String(secondsUntilReset)
  } else {
    delete state.mockHeaders['retry-after']
  }
}

// Update the representative claim based on exceeded limits
function updateRepresentativeClaim(state: MockRateLimitHostState): void {
  if (state.exceededLimits.length === 0) {
    delete state.mockHeaders['anthropic-ratelimit-unified-representative-claim']
    delete state.mockHeaders['anthropic-ratelimit-unified-reset']
    delete state.mockHeaders['retry-after']
    return
  }

  // Find the limit with the furthest reset time
  const furthest = state.exceededLimits.reduce((prev, curr) =>
    curr.resetsAt > prev.resetsAt ? curr : prev,
  )

  // Set the representative claim (appears for both warning and rejected)
  state.mockHeaders['anthropic-ratelimit-unified-representative-claim'] =
    furthest.type
  state.mockHeaders['anthropic-ratelimit-unified-reset'] = String(
    furthest.resetsAt,
  )

  // Add retry-after if rejected and no overage available
  if (state.mockHeaders['anthropic-ratelimit-unified-status'] === 'rejected') {
    const overageStatus =
      state.mockHeaders['anthropic-ratelimit-unified-overage-status']
    if (!overageStatus || overageStatus === 'rejected') {
      // Calculate seconds until reset
      const secondsUntilReset = Math.max(
        0,
        furthest.resetsAt - Math.floor(Date.now() / 1000),
      )
      state.mockHeaders['retry-after'] = String(secondsUntilReset)
    } else {
      // Overage is available, no retry-after
      delete state.mockHeaders['retry-after']
    }
  } else {
    delete state.mockHeaders['retry-after']
  }
}

// Add function to add exceeded limit with custom reset time
export function addExceededLimit(
  type: 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet',
  hoursFromNow: number,
): void {
  if (process.env.USER_TYPE !== 'ant') {
    return
  }

  const state = getMockRateLimitState()
  state.mockEnabled = true
  const resetsAt = Math.floor(Date.now() / 1000) + hoursFromNow * 3600

  // Remove existing limit of same type
  state.exceededLimits = state.exceededLimits.filter(l => l.type !== type)
  state.exceededLimits.push({ type, resetsAt })

  // Update status to rejected if we have exceeded limits
  if (state.exceededLimits.length > 0) {
    state.mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
  }

  updateRepresentativeClaim(state)
}

// Set mock early warning utilization for time-relative thresholds
// claimAbbrev: '5h' or '7d'
// utilization: 0-1 (e.g., 0.92 for 92% used)
// hoursFromNow: hours until reset (default: 4 for 5h, 120 for 7d)
export function setMockEarlyWarning(
  claimAbbrev: '5h' | '7d' | 'overage',
  utilization: number,
  hoursFromNow?: number,
): void {
  if (process.env.USER_TYPE !== 'ant') {
    return
  }

  const state = getMockRateLimitState()
  state.mockEnabled = true

  // Clear ALL early warning headers first (5h is checked before 7d, so we need
  // to clear 5h headers when testing 7d to avoid 5h taking priority)
  clearMockEarlyWarning()

  // Default hours based on claim type (early in window to trigger warning)
  const defaultHours = claimAbbrev === '5h' ? 4 : 5 * 24
  const hours = hoursFromNow ?? defaultHours
  const resetsAt = Math.floor(Date.now() / 1000) + hours * 3600

  state.mockHeaders[`anthropic-ratelimit-unified-${claimAbbrev}-utilization`] =
    String(utilization)
  state.mockHeaders[`anthropic-ratelimit-unified-${claimAbbrev}-reset`] =
    String(resetsAt)
  // Set the surpassed-threshold header to trigger early warning
  state.mockHeaders[
    `anthropic-ratelimit-unified-${claimAbbrev}-surpassed-threshold`
  ] = String(utilization)

  // Set status to allowed so early warning logic can upgrade it
  if (!state.mockHeaders['anthropic-ratelimit-unified-status']) {
    state.mockHeaders['anthropic-ratelimit-unified-status'] = 'allowed'
  }
}

// Clear mock early warning headers
export function clearMockEarlyWarning(): void {
  const { mockHeaders } = getMockRateLimitState()
  delete mockHeaders['anthropic-ratelimit-unified-5h-utilization']
  delete mockHeaders['anthropic-ratelimit-unified-5h-reset']
  delete mockHeaders['anthropic-ratelimit-unified-5h-surpassed-threshold']
  delete mockHeaders['anthropic-ratelimit-unified-7d-utilization']
  delete mockHeaders['anthropic-ratelimit-unified-7d-reset']
  delete mockHeaders['anthropic-ratelimit-unified-7d-surpassed-threshold']
}

export function setMockRateLimitScenario(scenario: MockScenario): void {
  if (process.env.USER_TYPE !== 'ant') {
    return
  }

  const state = getMockRateLimitState()
  if (scenario === 'clear') {
    state.mockHeaders = {}
    state.mockHeaderless429Message = null
    state.mockEnabled = false
    return
  }

  state.mockEnabled = true

  // Set reset times for demos
  const fiveHoursFromNow = Math.floor(Date.now() / 1000) + 5 * 3600
  const sevenDaysFromNow = Math.floor(Date.now() / 1000) + 7 * 24 * 3600

  // Clear existing headers
  state.mockHeaders = {}
  state.mockHeaderless429Message = null

  // Only clear exceeded limits for scenarios that explicitly set them
  // Overage scenarios should preserve existing exceeded limits
  const preserveExceededLimits = [
    'overage-active',
    'overage-warning',
    'overage-exhausted',
  ].includes(scenario)
  if (!preserveExceededLimits) {
    state.exceededLimits = []
  }

  switch (scenario) {
    case 'normal':
      state.mockHeaders = {
        'anthropic-ratelimit-unified-status': 'allowed',
        'anthropic-ratelimit-unified-reset': String(fiveHoursFromNow),
      }
      break

    case 'session-limit-reached':
      state.exceededLimits = [{ type: 'five_hour', resetsAt: fiveHoursFromNow }]
      updateRepresentativeClaim(state)
      state.mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      break

    case 'approaching-weekly-limit':
      state.mockHeaders = {
        'anthropic-ratelimit-unified-status': 'allowed_warning',
        'anthropic-ratelimit-unified-reset': String(sevenDaysFromNow),
        'anthropic-ratelimit-unified-representative-claim': 'seven_day',
      }
      break

    case 'weekly-limit-reached':
      state.exceededLimits = [{ type: 'seven_day', resetsAt: sevenDaysFromNow }]
      updateRepresentativeClaim(state)
      state.mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      break

    case 'overage-active': {
      // If no limits have been exceeded yet, default to 5-hour
      if (state.exceededLimits.length === 0) {
        state.exceededLimits = [
          { type: 'five_hour', resetsAt: fiveHoursFromNow },
        ]
      }
      updateRepresentativeClaim(state)
      state.mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      state.mockHeaders['anthropic-ratelimit-unified-overage-status'] =
        'allowed'
      // Set overage reset time (monthly)
      const endOfMonthActive = new Date()
      endOfMonthActive.setMonth(endOfMonthActive.getMonth() + 1, 1)
      endOfMonthActive.setHours(0, 0, 0, 0)
      state.mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonthActive.getTime() / 1000),
      )
      break
    }

    case 'overage-warning': {
      // If no limits have been exceeded yet, default to 5-hour
      if (state.exceededLimits.length === 0) {
        state.exceededLimits = [
          { type: 'five_hour', resetsAt: fiveHoursFromNow },
        ]
      }
      updateRepresentativeClaim(state)
      state.mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      state.mockHeaders['anthropic-ratelimit-unified-overage-status'] =
        'allowed_warning'
      // Overage typically resets monthly, but for demo let's say end of month
      const endOfMonth = new Date()
      endOfMonth.setMonth(endOfMonth.getMonth() + 1, 1)
      endOfMonth.setHours(0, 0, 0, 0)
      state.mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonth.getTime() / 1000),
      )
      break
    }

    case 'overage-exhausted': {
      // If no limits have been exceeded yet, default to 5-hour
      if (state.exceededLimits.length === 0) {
        state.exceededLimits = [
          { type: 'five_hour', resetsAt: fiveHoursFromNow },
        ]
      }
      updateRepresentativeClaim(state)
      state.mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      state.mockHeaders['anthropic-ratelimit-unified-overage-status'] =
        'rejected'
      // Both subscription and overage are exhausted
      // Subscription resets based on the exceeded limit, overage resets monthly
      const endOfMonthExhausted = new Date()
      endOfMonthExhausted.setMonth(endOfMonthExhausted.getMonth() + 1, 1)
      endOfMonthExhausted.setHours(0, 0, 0, 0)
      state.mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonthExhausted.getTime() / 1000),
      )
      break
    }

    case 'out-of-credits': {
      // Out of credits - subscription limit hit, overage rejected due to insufficient credits
      // (wallet is empty)
      if (state.exceededLimits.length === 0) {
        state.exceededLimits = [
          { type: 'five_hour', resetsAt: fiveHoursFromNow },
        ]
      }
      updateRepresentativeClaim(state)
      state.mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      state.mockHeaders['anthropic-ratelimit-unified-overage-status'] =
        'rejected'
      state.mockHeaders['anthropic-ratelimit-unified-overage-disabled-reason'] =
        'out_of_credits'
      const endOfMonth = new Date()
      endOfMonth.setMonth(endOfMonth.getMonth() + 1, 1)
      endOfMonth.setHours(0, 0, 0, 0)
      state.mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonth.getTime() / 1000),
      )
      break
    }

    case 'org-zero-credit-limit': {
      // Org service has zero credit limit - admin set org-level spend cap to $0
      // Non-admin Team/Enterprise users should not see "Request extra usage" option
      if (state.exceededLimits.length === 0) {
        state.exceededLimits = [
          { type: 'five_hour', resetsAt: fiveHoursFromNow },
        ]
      }
      updateRepresentativeClaim(state)
      state.mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      state.mockHeaders['anthropic-ratelimit-unified-overage-status'] =
        'rejected'
      state.mockHeaders['anthropic-ratelimit-unified-overage-disabled-reason'] =
        'org_service_zero_credit_limit'
      const endOfMonthZero = new Date()
      endOfMonthZero.setMonth(endOfMonthZero.getMonth() + 1, 1)
      endOfMonthZero.setHours(0, 0, 0, 0)
      state.mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonthZero.getTime() / 1000),
      )
      break
    }

    case 'org-spend-cap-hit': {
      // Org spend cap hit for the month - org overages temporarily disabled
      // Non-admin Team/Enterprise users should not see "Request extra usage" option
      if (state.exceededLimits.length === 0) {
        state.exceededLimits = [
          { type: 'five_hour', resetsAt: fiveHoursFromNow },
        ]
      }
      updateRepresentativeClaim(state)
      state.mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      state.mockHeaders['anthropic-ratelimit-unified-overage-status'] =
        'rejected'
      state.mockHeaders['anthropic-ratelimit-unified-overage-disabled-reason'] =
        'org_level_disabled_until'
      const endOfMonthHit = new Date()
      endOfMonthHit.setMonth(endOfMonthHit.getMonth() + 1, 1)
      endOfMonthHit.setHours(0, 0, 0, 0)
      state.mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonthHit.getTime() / 1000),
      )
      break
    }

    case 'member-zero-credit-limit': {
      // Member has zero credit limit - admin set this user's individual limit to $0
      // Non-admin Team/Enterprise users SHOULD see "Request extra usage" (admin can allocate more)
      if (state.exceededLimits.length === 0) {
        state.exceededLimits = [
          { type: 'five_hour', resetsAt: fiveHoursFromNow },
        ]
      }
      updateRepresentativeClaim(state)
      state.mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      state.mockHeaders['anthropic-ratelimit-unified-overage-status'] =
        'rejected'
      state.mockHeaders['anthropic-ratelimit-unified-overage-disabled-reason'] =
        'member_zero_credit_limit'
      const endOfMonthMember = new Date()
      endOfMonthMember.setMonth(endOfMonthMember.getMonth() + 1, 1)
      endOfMonthMember.setHours(0, 0, 0, 0)
      state.mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonthMember.getTime() / 1000),
      )
      break
    }

    case 'seat-tier-zero-credit-limit': {
      // Seat tier has zero credit limit - admin set this seat tier's limit to $0
      // Non-admin Team/Enterprise users SHOULD see "Request extra usage" (admin can allocate more)
      if (state.exceededLimits.length === 0) {
        state.exceededLimits = [
          { type: 'five_hour', resetsAt: fiveHoursFromNow },
        ]
      }
      updateRepresentativeClaim(state)
      state.mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      state.mockHeaders['anthropic-ratelimit-unified-overage-status'] =
        'rejected'
      state.mockHeaders['anthropic-ratelimit-unified-overage-disabled-reason'] =
        'seat_tier_zero_credit_limit'
      const endOfMonthSeatTier = new Date()
      endOfMonthSeatTier.setMonth(endOfMonthSeatTier.getMonth() + 1, 1)
      endOfMonthSeatTier.setHours(0, 0, 0, 0)
      state.mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonthSeatTier.getTime() / 1000),
      )
      break
    }

    case 'opus-limit': {
      state.exceededLimits = [
        { type: 'seven_day_opus', resetsAt: sevenDaysFromNow },
      ]
      updateRepresentativeClaim(state)
      // Always send 429 rejected status - the error handler will decide whether
      // to show an error or return NO_RESPONSE_REQUESTED based on fallback eligibility
      state.mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      break
    }

    case 'opus-warning': {
      state.mockHeaders = {
        'anthropic-ratelimit-unified-status': 'allowed_warning',
        'anthropic-ratelimit-unified-reset': String(sevenDaysFromNow),
        'anthropic-ratelimit-unified-representative-claim': 'seven_day_opus',
      }
      break
    }

    case 'sonnet-limit': {
      state.exceededLimits = [
        { type: 'seven_day_sonnet', resetsAt: sevenDaysFromNow },
      ]
      updateRepresentativeClaim(state)
      state.mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      break
    }

    case 'sonnet-warning': {
      state.mockHeaders = {
        'anthropic-ratelimit-unified-status': 'allowed_warning',
        'anthropic-ratelimit-unified-reset': String(sevenDaysFromNow),
        'anthropic-ratelimit-unified-representative-claim': 'seven_day_sonnet',
      }
      break
    }

    case 'fast-mode-limit': {
      updateRepresentativeClaim(state)
      state.mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      // Duration in ms (> 20s threshold to trigger cooldown)
      state.mockFastModeRateLimitDurationMs = 10 * 60 * 1000
      break
    }

    case 'fast-mode-short-limit': {
      updateRepresentativeClaim(state)
      state.mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      // Duration in ms (< 20s threshold, won't trigger cooldown)
      state.mockFastModeRateLimitDurationMs = 10 * 1000
      break
    }

    case 'extra-usage-required': {
      // Headerless 429 — exercises the entitlement-rejection path in errors.ts
      state.mockHeaderless429Message =
        'Extra usage is required for long context requests.'
      break
    }

    default:
      break
  }
}

export function getMockHeaderless429Message(): string | null {
  if (process.env.USER_TYPE !== 'ant') {
    return null
  }
  // Env var path for -p / SDK testing where slash commands aren't available
  if (process.env.CLAUDE_MOCK_HEADERLESS_429) {
    return process.env.CLAUDE_MOCK_HEADERLESS_429
  }
  const state = getMockRateLimitState()
  if (!state.mockEnabled) {
    return null
  }
  return state.mockHeaderless429Message
}

export function getMockHeaders(): MockHeaders | null {
  const state = getMockRateLimitState()
  if (
    !state.mockEnabled ||
    process.env.USER_TYPE !== 'ant' ||
    Object.keys(state.mockHeaders).length === 0
  ) {
    return null
  }
  return state.mockHeaders
}

export function getMockStatus(): string {
  const state = getMockRateLimitState()
  if (
    !state.mockEnabled ||
    (Object.keys(state.mockHeaders).length === 0 && !state.mockSubscriptionType)
  ) {
    return 'No mock headers active (using real limits)'
  }

  const lines: string[] = []
  lines.push('Active mock headers:')

  // Show subscription type - either explicitly set or default
  const effectiveSubscription =
    state.mockSubscriptionType || DEFAULT_MOCK_SUBSCRIPTION
  if (state.mockSubscriptionType) {
    lines.push(
      `  Subscription Type: ${state.mockSubscriptionType} (explicitly set)`,
    )
  } else {
    lines.push(`  Subscription Type: ${effectiveSubscription} (default)`)
  }

  Object.entries(state.mockHeaders).forEach(([key, value]) => {
    if (value !== undefined) {
      // Format the header name nicely
      const formattedKey = key
        .replace('anthropic-ratelimit-unified-', '')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())

      // Format timestamps as human-readable
      if (key.includes('reset') && value) {
        const timestamp = Number(value)
        const date = new Date(timestamp * 1000)
        lines.push(`  ${formattedKey}: ${value} (${date.toLocaleString()})`)
      } else {
        lines.push(`  ${formattedKey}: ${value}`)
      }
    }
  })

  // Show exceeded limits if any
  if (state.exceededLimits.length > 0) {
    lines.push('\nExceeded limits (contributing to representative claim):')
    state.exceededLimits.forEach(limit => {
      const date = new Date(limit.resetsAt * 1000)
      lines.push(`  ${limit.type}: resets at ${date.toLocaleString()}`)
    })
  }

  return lines.join('\n')
}

export function clearMockHeaders(): void {
  const state = getMockRateLimitState()
  state.mockHeaders = {}
  state.exceededLimits = []
  state.mockSubscriptionType = null
  state.mockFastModeRateLimitDurationMs = null
  state.mockFastModeRateLimitExpiresAt = null
  state.mockHeaderless429Message = null
  setMockBillingAccessOverride(null)
  state.mockEnabled = false
}

export function applyMockHeaders(
  headers: globalThis.Headers,
): globalThis.Headers {
  const mock = getMockHeaders()
  if (!mock) {
    return headers
  }

  // Create a new Headers object with original headers
  // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
  const newHeaders = new globalThis.Headers(headers)

  // Apply mock headers (overwriting originals)
  Object.entries(mock).forEach(([key, value]) => {
    if (value !== undefined) {
      newHeaders.set(key, value)
    }
  })

  return newHeaders
}

// Check if we should process rate limits even without subscription
// This is for Ant employees testing with mocks
export function shouldProcessMockLimits(): boolean {
  if (process.env.USER_TYPE !== 'ant') {
    return false
  }
  return (
    getMockRateLimitState().mockEnabled ||
    Boolean(process.env.CLAUDE_MOCK_HEADERLESS_429)
  )
}

export function getCurrentMockScenario(): MockScenario | null {
  const state = getMockRateLimitState()
  if (!state.mockEnabled) {
    return null
  }

  // Reverse lookup the scenario from current headers
  if (!state.mockHeaders) return null

  const status = state.mockHeaders['anthropic-ratelimit-unified-status']
  const overage =
    state.mockHeaders['anthropic-ratelimit-unified-overage-status']
  const claim =
    state.mockHeaders['anthropic-ratelimit-unified-representative-claim']

  if (claim === 'seven_day_opus') {
    return status === 'rejected' ? 'opus-limit' : 'opus-warning'
  }

  if (claim === 'seven_day_sonnet') {
    return status === 'rejected' ? 'sonnet-limit' : 'sonnet-warning'
  }

  if (overage === 'rejected') return 'overage-exhausted'
  if (overage === 'allowed_warning') return 'overage-warning'
  if (overage === 'allowed') return 'overage-active'

  if (status === 'rejected') {
    if (claim === 'five_hour') return 'session-limit-reached'
    if (claim === 'seven_day') return 'weekly-limit-reached'
  }

  if (status === 'allowed_warning') {
    if (claim === 'seven_day') return 'approaching-weekly-limit'
  }

  if (status === 'allowed') return 'normal'

  return null
}

export function getScenarioDescription(scenario: MockScenario): string {
  switch (scenario) {
    case 'normal':
      return 'Normal usage, no limits'
    case 'session-limit-reached':
      return 'Session rate limit exceeded'
    case 'approaching-weekly-limit':
      return 'Approaching weekly aggregate limit'
    case 'weekly-limit-reached':
      return 'Weekly aggregate limit exceeded'
    case 'overage-active':
      return 'Using extra usage (overage active)'
    case 'overage-warning':
      return 'Approaching extra usage limit'
    case 'overage-exhausted':
      return 'Both subscription and extra usage limits exhausted'
    case 'out-of-credits':
      return 'Out of extra usage credits (wallet empty)'
    case 'org-zero-credit-limit':
      return 'Org spend cap is zero (no extra usage budget)'
    case 'org-spend-cap-hit':
      return 'Org spend cap hit for the month'
    case 'member-zero-credit-limit':
      return 'Member limit is zero (admin can allocate more)'
    case 'seat-tier-zero-credit-limit':
      return 'Seat tier limit is zero (admin can allocate more)'
    case 'opus-limit':
      return 'Opus limit reached'
    case 'opus-warning':
      return 'Approaching Opus limit'
    case 'sonnet-limit':
      return 'Sonnet limit reached'
    case 'sonnet-warning':
      return 'Approaching Sonnet limit'
    case 'fast-mode-limit':
      return 'Fast mode rate limit'
    case 'fast-mode-short-limit':
      return 'Fast mode rate limit (short)'
    case 'extra-usage-required':
      return 'Headerless 429: Extra usage required for 1M context'
    case 'clear':
      return 'Clear mock headers (use real limits)'
    default:
      return 'Unknown scenario'
  }
}

// Mock subscription type management
export function setMockSubscriptionType(
  subscriptionType: SubscriptionType | null,
): void {
  if (process.env.USER_TYPE !== 'ant') {
    return
  }
  const state = getMockRateLimitState()
  state.mockEnabled = true
  state.mockSubscriptionType = subscriptionType
}

export function getMockSubscriptionType(): SubscriptionType | null {
  const state = getMockRateLimitState()
  if (!state.mockEnabled || process.env.USER_TYPE !== 'ant') {
    return null
  }
  // Return the explicitly set subscription type, or default to 'max'
  return state.mockSubscriptionType || DEFAULT_MOCK_SUBSCRIPTION
}

// Export a function that checks if we should use mock subscription
export function shouldUseMockSubscription(): boolean {
  // Official CLAUDE_CODE_MOCK_TRIAL densable — force mock subscription path.
  try {
    const { isMockTrialEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js')
    if (isMockTrialEnabled() && process.env.USER_TYPE === 'ant') {
      return true
    }
  } catch {
    // densable optional
  }
  const state = getMockRateLimitState()
  return (
    state.mockEnabled &&
    state.mockSubscriptionType !== null &&
    process.env.USER_TYPE === 'ant'
  )
}

// Mock billing access (admin vs non-admin)
export function setMockBillingAccess(hasAccess: boolean | null): void {
  if (process.env.USER_TYPE !== 'ant') {
    return
  }
  getMockRateLimitState().mockEnabled = true
  setMockBillingAccessOverride(hasAccess)
}

// Mock fast mode rate limit handling
export function isMockFastModeRateLimitScenario(): boolean {
  return getMockRateLimitState().mockFastModeRateLimitDurationMs !== null
}

export function checkMockFastModeRateLimit(
  isFastModeActive?: boolean,
): MockHeaders | null {
  const state = getMockRateLimitState()
  if (state.mockFastModeRateLimitDurationMs === null) {
    return null
  }

  // Only throw when fast mode is active
  if (!isFastModeActive) {
    return null
  }

  // Check if the rate limit has expired
  if (
    state.mockFastModeRateLimitExpiresAt !== null &&
    Date.now() >= state.mockFastModeRateLimitExpiresAt
  ) {
    clearMockHeaders()
    return null
  }

  // Set expiry on first error (not when scenario is configured)
  if (state.mockFastModeRateLimitExpiresAt === null) {
    state.mockFastModeRateLimitExpiresAt =
      Date.now() + state.mockFastModeRateLimitDurationMs
  }

  // Compute dynamic retry-after based on remaining time
  const remainingMs = state.mockFastModeRateLimitExpiresAt - Date.now()
  const headersToSend = { ...state.mockHeaders }
  headersToSend['retry-after'] = String(
    Math.max(1, Math.ceil(remainingMs / 1000)),
  )

  return headersToSend
}
