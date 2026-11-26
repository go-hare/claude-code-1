import memoize from 'lodash-es/memoize.js'
import {
  getBootstrapSession,
  getBootstrapSessionHost,
  hasActiveSessionAls,
  isSharedBackend,
  RootSessionSlot,
} from '../utils/sessionHost.js'

type SessionTimezoneState = {
  zone: string | undefined
  assumed: boolean
}

// Official 2.1.331 `$e` session timezone slot (`FOs` / `Hxr` / `C5i`).
const sessionTimezoneSlot = new RootSessionSlot<SessionTimezoneState>(() => ({
  zone: undefined,
  assumed: false,
}))

export function setSessionTimezone(
  zone: string | undefined,
  assumed = false,
): void {
  const state = sessionTimezoneSlot.of(getBootstrapSession())
  state.zone = zone
  state.assumed = assumed
}

export function isSessionTimezoneAssumed(): boolean {
  return sessionTimezoneSlot.peek(getBootstrapSession())?.assumed ?? false
}

/**
 * Official 2.1.331 `Hxr()` — resolve the active root session's IANA timezone,
 * guarding against default-host bleed when `isSharedBackend() && !hasActiveSessionAls()`
 * and falling back to `'UTC'` for diskless hosts.
 */
export function getSessionTimezone(): string | undefined {
  const rawZone =
    isSharedBackend() && !hasActiveSessionAls()
      ? undefined
      : sessionTimezoneSlot.peek(getBootstrapSession())?.zone
  return (
    rawZone ??
    (getBootstrapSessionHost().launchOptions.diskless() ? 'UTC' : undefined)
  )
}

// This ensures you get the LOCAL date in ISO format
export function getLocalISODate(): string {
  // Official OVERRIDE_DATE densable (ant-only date override).
  try {
    const { resolveOverrideDate } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js')
    const override = resolveOverrideDate()
    if (override) return override
  } catch {
    if (process.env.CLAUDE_CODE_OVERRIDE_DATE) {
      return process.env.CLAUDE_CODE_OVERRIDE_DATE
    }
  }

  const now = new Date()
  const timeZone = getSessionTimezone()
  if (timeZone !== undefined) {
    try {
      const parts = new Map(
        new Intl.DateTimeFormat('en-US', {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
          .formatToParts(now)
          .map(p => [p.type, p.value]),
      )
      const year = parts.get('year')
      const month = parts.get('month')
      const day = parts.get('day')
      if (year && month && day) {
        return `${year}-${month}-${day}`
      }
    } catch {
      // Invalid IANA timezone falls through to local clock
    }
  }
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Memoized for prompt-cache stability — captures the date once at session start.
// The main interactive path gets this behavior via memoize(getUserContext) in
// context.ts; simple mode (--bare) calls getSystemPrompt per-request and needs
// an explicit memoized date to avoid busting the cached prefix at midnight.
// When midnight rolls over, getDateChangeAttachments appends the new date at
// the tail (though simple mode disables attachments, so the trade-off there is:
// stale date after midnight vs. ~entire-conversation cache bust — stale wins).
const getSessionStartDateSlot = new RootSessionSlot(() =>
  memoize(getLocalISODate),
)
const getSessionStartDateImpl = (() =>
  getSessionStartDateSlot.of(getBootstrapSession())()) as ReturnType<
  typeof memoize<typeof getLocalISODate>
>
Object.defineProperty(getSessionStartDateImpl, 'cache', {
  get() {
    return getSessionStartDateSlot.of(getBootstrapSession()).cache
  },
  set(next) {
    getSessionStartDateSlot.of(getBootstrapSession()).cache = next
  },
  configurable: true,
  enumerable: true,
})
export const getSessionStartDate = getSessionStartDateImpl

// Returns "Month YYYY" (e.g. "February 2026") in the user's local timezone.
// Changes monthly, not daily — used in tool prompts to minimize cache busting.
export function getLocalMonthYear(): string {
  // Official OVERRIDE_DATE densable.
  let overrideDate: string | null = null
  try {
    const { resolveOverrideDate } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js')
    overrideDate = resolveOverrideDate()
  } catch {
    overrideDate = process.env.CLAUDE_CODE_OVERRIDE_DATE || null
  }
  const date = overrideDate ? new Date(overrideDate) : new Date()
  return date.toLocaleString('en-US', { month: 'long', year: 'numeric' })
}
