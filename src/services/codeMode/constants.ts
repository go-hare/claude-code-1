/**
 * Code Mode (2.1.323 #1964) constants and tool sets.
 * Aligned with official 2.1.323/2.1.325 SEA (`chunk-8sstk0cs`, `chunk-xjqp3eha`).
 */

export const CODE_MODE_NAME = 'Code Mode'
export const CODE_MODE_EXPERIMENTAL_NAME = 'Code Mode (experimental)'
export const CODE_MODE_ENV_VAR = 'CLAUDE_CODE_EXPERIMENTAL_CODE_MODE'
export const CODE_MODE_RESTART_ENV_VAR =
  'CLAUDE_CODE_EXPERIMENTAL_CODE_MODE_RESTART'
export const CODE_MODE_RESTARTED_FROM_ENV_VAR =
  'CLAUDE_CODE_EXPERIMENTAL_CODE_MODE_RESTARTED_FROM'
export const CODE_MODE_GROWTHBOOK_GATE = 'tengu_rustling_blossom'
export const CODE_MODE_DOCS_URL = 'https://code.claude.com/docs/en/code-mode'

export const REPL_MAIN_THREAD_KEY = 'main'
export const REPL_SCRIPT_FILENAME = 'repl-tool-code.js'
export const REPL_MAX_TIMEOUT_MS = 600_000
export const REPL_SYNC_RUN_MS = 30_000
export const REPL_CLOCK_HEARTBEAT_MS = 1_000
export const REPL_TIMER_LATE_MS = 1_000
export const REPL_TIMER_GRACE_MS = 5_000
export const REPL_SETTLE_WINDOW_MS = 30_000
export const REPL_DETACH_AFTER_MS = 30_000
export const REPL_ASYNC_WALL_CAP_MS = 7_200_000
export const POLL_CACHE_TTL_MARGIN_MS = 30_000
export const REPL_PART_CAP = 30_000
export const REPL_TOOL_CALL_CAP = 50_000
export const REPL_MAX_REFUSALS_WHEN_OVER = 20
/**
 * Official 2.1.328 (#648): removed the 750ms post-script pause in auto and
 * bypass-permissions modes.
 */
export const REPL_POST_SCRIPT_PAUSE_AUTO_MS = 0

/**
 * Official `FFe` (`CODE_MODE_ONLY_TOOLS`): core primitive tools hidden from direct
 * model tool-calling when Code Mode is active (invoked via JS in REPL instead).
 */
export const CODE_MODE_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'Read',
  'Glob',
  'Grep',
  'Bash',
  'PowerShell',
  'NotebookEdit',
])

/**
 * Official `Hfi` (`REPL_PRIMITIVE_TOOL_NAMES`): full set of built-in primitive
 * tools exposed as JS functions inside the Code Mode REPL context.
 */
export const REPL_PRIMITIVE_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...CODE_MODE_ONLY_TOOLS,
  'Write',
  'Edit',
])
