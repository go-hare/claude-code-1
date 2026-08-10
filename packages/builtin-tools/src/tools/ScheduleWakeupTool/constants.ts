/** densable `k_` */
export const SCHEDULE_WAKEUP_TOOL_NAME = 'ScheduleWakeup'

/** densable `Efr` — CronCreate-based autonomous loop sentinel */
export const AUTONOMOUS_LOOP_SENTINEL = '<<autonomous-loop>>'

/** densable `tmt` — ScheduleWakeup dynamic-loop sentinel */
export const AUTONOMOUS_LOOP_DYNAMIC_SENTINEL = '<<autonomous-loop-dynamic>>'

/** densable `BKu` — short description */
export const SCHEDULE_WAKEUP_DESCRIPTION =
  'Schedule when to resume work in /loop dynamic mode (always pass the `prompt` arg unless stopping). Call before ending the turn to keep the loop alive; call with `stop: true` to end the loop immediately.'
