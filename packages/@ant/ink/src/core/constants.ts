// densable Vh=16, SSo=4, bSo=16384, Vbr=250
export const FRAME_INTERVAL_MS = 16
/** densable SSo — frame interval while inputPriorityUntil is in the future. */
export const INPUT_PRIORITY_FRAME_MS = 4
/** densable Vbr — retry delay when stdout backlog holds a paced frame. */
export const STDOUT_BACKLOG_RETRY_MS = 250
/** densable bSo — nonBlockingStdout.queuedBytes() threshold. */
export const STDOUT_BACKLOG_BYTES = 16384
/** densable `Gd` — owed-reply hold / drainStdin DA1 wait. */
export const OWED_REPLY_HOLD_MS = 250
