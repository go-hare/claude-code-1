/**
 * Official 2.1.331 ReadNotifications constants — rS / FXr / We.
 */

export const READ_NOTIFICATIONS_TOOL_NAME = 'ReadNotifications'

/** Official FXr = 100_000 max result size chars. */
export const READ_NOTIFICATIONS_MAX_RESULT_CHARS = 100_000

/**
 * Official Re = FXr - 9500 - 512 - 2500 = 87_488 character budget per drain
 * batch before leaving remaining notifications queued for the next call.
 */
export const READ_NOTIFICATIONS_DRAIN_BUDGET_CHARS = 87_488

/** Official We = 'tengu_saffron_kite' GrowthBook gate (default true). */
export const READ_NOTIFICATIONS_GB_FLAG = 'tengu_saffron_kite'

/** Clock skew threshold in minutes before reporting server-vs-local wait (`ne = 10`). */
export const READ_NOTIFICATIONS_CLOCK_SKEW_MINUTES = 10
