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
 * Official 2.1.331 REPL / Code Mode host-call DoS & input validation limits
 * (`chunk-27n4hbw4.js`, `chunk-e44nxx45.js`, `chunk-gyvea1hp.js`).
 */
/** Official `N_`: max items copied across the VM boundary for arrays/maps/sets/typed arrays. */
export const REPL_MOST_ITEMS = 4_096
/** Official `ze` / `R8r.mostDepth`: max object/array nesting depth for host call arguments. */
export const REPL_MOST_DEPTH = 2_000
/** Official `$t = 3 * ze + 8`: max JSON bracket/brace nesting depth on the host wire decoder. */
export const REPL_WIRE_MAX_DEPTH = 3 * REPL_MOST_DEPTH + 8
/** Official `he = 1e6`: max combined BigInt digits allowed in a single host call's arguments. */
export const REPL_MOST_DIGITS = 1_000_000
/** Official `me = 134217728` (128 MiB chars): max JSON/tree payload size for a single host call. */
export const REPL_MOST_JSON_CHARS = 134_217_728
/** Official `m8o = 268435456` (256 MiB chars): max plain string argument length for a host call. */
export const REPL_MOST_TEXT_CHARS = 268_435_456
/** Official `Ce = 65536`: max async calls queued in one synchronous turn. */
export const REPL_TURN_MAX_QUEUED_CALLS = 65_536
/** Official `2 * Ce = 131072`: max queued calls including trailing notify (`followsCalls`) ops. */
export const REPL_TURN_MAX_QUEUED_NOTIFY_CALLS = 2 * REPL_TURN_MAX_QUEUED_CALLS
/** Official `ct = 536870912` (512 MiB chars): max cumulative string data queued in one turn. */
export const REPL_TURN_MAX_QUEUED_CHARS = 536_870_912

/** Official 2.1.331 error strings for REPL / Code Mode host-call guards. */
export const REPL_CALL_NOT_MADE_PREFIX =
  'TypeError: REPL: the call was not made, because '
export const REPL_CALL_TOO_LARGE_ERROR =
  'REPL: the call was not made, because its arguments are too large. Pass less, or write the data to a file.'
export const REPL_CALL_TOO_LARGE_PLAIN_ERROR =
  'A call was not made: its input was too large'
export const REPL_CALL_TOO_LONG_NUMBERS_PLAIN_ERROR =
  'A call was not made: the numbers in its input were too long'
export const REPL_CALL_TOO_DEEP_PLAIN_ERROR =
  'A call was not made: its input was nested too deeply'
export const REPL_PRIMITIVE_ONLY_ARGS_ERROR =
  'REPL: only text, numbers and flags can be sent to the host.'
export const REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR =
  'REPL: the host takes no such call, or an argument is too long.'
export const REPL_TURN_BUDGET_EXCEEDED_ERROR =
  'REPL: too many calls, or too much data, in one turn. Await some of the calls before making more.'
export const REPL_CIRCULAR_TRANSFORM_ERROR =
  'A circular value cannot pass through a transform'
export const REPL_UNAWAITED_PROMISE_ERROR =
  "REPL: unawaited Promise coerced to string. A result used inline needs 'await' — e.g. const c = await file(f).text(); await write(f, c + s). Only the top-level keys of a returned object are awaited for you."
export const REPL_UNAWAITED_PROMISE_PLAIN_ERROR =
  'TypeError: a Promise was used without await'

export function formatReplCallTooDeepError(
  mostDepth: number = REPL_MOST_DEPTH,
): string {
  return `REPL: the call was not made, because an argument nests more than ${mostDepth} levels deep. Pass a flatter value.`
}

export function formatReplCallTooManyBigIntDigitsError(
  mostDigits: number = REPL_MOST_DIGITS,
): string {
  return `REPL: the call was not made, because its BigInts have over ${mostDigits} digits together. Pass them as text.`
}

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
