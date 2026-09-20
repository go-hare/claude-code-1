/** densable 2.1.247 `ad` — REPL / `/remote-control` budget. */
export const REPL_WORKSPACE_DIFF_COMPUTE_BUDGET = {
  perFileMs: 400,
  totalMs: 1500,
} as const

/** densable 2.1.247 `dd` — print.ts / headless RC enable. */
export const HEADLESS_BRIDGE_WORKSPACE_DIFF_COMPUTE_BUDGET = {
  perFileMs: 2000,
  totalMs: 6000,
} as const

/** densable 2.1.247 `bt` — Yt default when no budget is passed. */
export const DEFAULT_WORKSPACE_DIFF_COMPUTE_BUDGET = {
  perFileMs: 5000,
  totalMs: 10_000,
} as const

export type WorkspaceDiffComputeBudget = {
  perFileMs: number
  totalMs: number
}

/** densable 2.1.247 `ts` — settled-result reuse window. */
export const WORKSPACE_DIFF_RESULT_CACHE_MS = 60_000

/** densable 2.1.247 `ht` next to jn `get_workspace_diff`. */
export const GET_WORKSPACE_DIFF_TIMEOUT_MS = 8000

/** densable 2.1.247 `kt`. */
export const GET_WORKSPACE_DIFF_TIMEOUT_ERROR =
  'get_workspace_diff timed out: the workspace diff is still being computed; retry shortly'

/** densable 2.1.247 inbound when `onGetWorkspaceDiff` is missing. */
export const GET_WORKSPACE_DIFF_NOT_SUPPORTED =
  'get_workspace_diff is not supported in this context (onGetWorkspaceDiff callback not registered)'
