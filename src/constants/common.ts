import memoize from 'lodash-es/memoize.js'

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
export const getSessionStartDate = memoize(getLocalISODate)

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
