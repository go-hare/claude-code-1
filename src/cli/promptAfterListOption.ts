/**
 * Official 2.1.326 CLI argv helpers:
 * - #45 (`oTt`): detect a prompt typed after a variadic list option such as
 *   `--add-dir` or `--allowedTools` that Commander consumed as an option value.
 * - #173: detect `claude --help | less` (piped help) so early raw-mode stdin
 *   capture does not steal keys from the pager.
 * - #341 (`rt` / `Ae`): refuse `--await-initialize`, `--managed-settings-in-initialize`,
 *   and `--initialize-fields` with `--bg`, `--background`, `--routine`,
 *   `--worktree --tmux`, or background session commands like `claude logs`.
 */

/** Options taking one or more space-separated values (Commander `<items...>`). */
export const VARIADIC_LIST_OPTIONS = new Set<string>([
  '--allowedTools',
  '--allowed-tools',
  '--disallowedTools',
  '--disallowed-tools',
  '--tools',
  '--add-dir',
  '--mcp-config',
  '--betas',
  '--file',
  '--channels',
  '--dangerously-load-development-channels',
])

/** Options taking an optional single value (only consumed when next token is not a flag). */
const OPTIONAL_VALUE_OPTIONS = new Set<string>([
  '-d',
  '--debug',
  '-r',
  '--resume',
  '--from-pr',
  '-w',
  '--worktree',
  '--teleport',
  '--cloud',
  '--remote',
  '--project',
  '--remote-control',
  '--rc',
  '--prompt-suggestions',
])

/** Options taking a required value (including all variadic options). */
const VALUE_TAKING_OPTIONS = new Set<string>([
  ...VARIADIC_LIST_OPTIONS,
  '--model',
  '--effort',
  '--agent',
  '--permission-mode',
  '--inherit-permission-mode',
  '--settings',
  '--managed-settings',
  '--setting-sources',
  '--debug-file',
  '--system-prompt',
  '--system-prompt-file',
  '--append-system-prompt',
  '--append-system-prompt-file',
  '--system-prompt-snapshot',
  '--append-subagent-system-prompt',
  '--append-subagent-system-prompt-file',
  '--plan-mode-instructions',
  '--permission-prompt-tool',
  '--permission-prompts',
  '--json-schema',
  '--fallback-model',
  '--advisor',
  '--agents',
  '--name',
  '-n',
  '--plugin-dir',
  '--plugin-dir-no-mcp',
  '--plugin-url',
  '--remote-control-session-name-prefix',
  '--exec',
  '-m',
  '--sdk-url',
  '--thinking',
  '--thinking-display',
  '--max-thinking-tokens',
  '--max-turns',
  '--max-budget-usd',
  '--task-budget',
  '--autocompact',
  '--rewind-files',
  '--resume-session-at',
  '--resume-drops-turn',
  '--workload',
  '--output-format',
  '--input-format',
  '--teammate-mode',
  '--messaging-socket-path',
  '--session-id',
  '--environment',
  '--pool',
  '--ref',
  '--on-branch',
  '--correlation-id',
  '--metadata',
  '--forward-home-settings',
  '--project-config-root',
  '--attach-serve',
  '--runner-declares',
  '--session-began-as-copy',
  '--initialize-fields',
])

function isFlagToken(token: string): boolean {
  return token.length > 1 && token.startsWith('-')
}

/** Official `ije(argv, index)` — return last index consumed by argv[index]. */
export function stepCliArgIndex(
  argv: readonly string[],
  index: number,
): number {
  const token = argv[index]
  if (token !== undefined && OPTIONAL_VALUE_OPTIONS.has(token)) {
    const next = argv[index + 1]
    return next !== undefined && !isFlagToken(next) ? index + 1 : index
  }
  if (token === undefined || !VALUE_TAKING_OPTIONS.has(token)) {
    return index
  }
  let end = index + 1
  if (VARIADIC_LIST_OPTIONS.has(token)) {
    while (end + 1 < argv.length && !isFlagToken(argv[end + 1]!)) {
      end++
    }
  }
  return Math.min(end, argv.length - 1)
}

/** Official `Han(argv)` — index of first positional arg, or -1 if none. */
export function findFirstPositionalIndex(argv: readonly string[]): number {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!
    if (token === '--') {
      return i + 1 < argv.length ? i + 1 : -1
    }
    if (!isFlagToken(token)) {
      return i
    }
    i = stepCliArgIndex(argv, i)
  }
  return -1
}

/** Official `fit(predicate, argv)` — find first matching token before `--`, skipping option values. */
export function eagerFindCliArg(
  predicate: (token: string) => boolean,
  argv: readonly string[],
): number {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--') break
    if (token !== undefined && predicate(token)) return i
    i = stepCliArgIndex(argv, i)
  }
  return -1
}

export function eagerHasCliFlag(
  flag: string,
  argv: readonly string[],
): boolean {
  return eagerFindCliArg(t => t === flag, argv) !== -1
}

const HAS_SPACE_OR_NON_ASCII = /\s|\P{ASCII}/u
const LOOKS_LIKE_PATH_OR_JSON_OR_URI = /^(?:[.~{\\]|\/[^\s/]*\/|\w+:\S)/
const HAS_NON_TOOL_WORD = /(?:^|[\s,])(?![A-Z\s,]|mcp__|$)/

function collapseWs(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function truncateChars(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}\u2026`
}

export type PromptReadAsOptionWarning = {
  problem: string
  fix: string
}

/**
 * Official 2.1.326 #45 (`oTt`) — returns a warning when argv has no positional
 * prompt AND a variadic list option (`--add-dir`, `--allowedTools`, etc.)
 * consumed more than one value whose last token looks like natural-language
 * prompt text rather than a path, JSON object, URI, or tool name list.
 */
export function detectPromptReadAsOptionValue(
  argv: readonly string[] = process.argv.slice(2),
): PromptReadAsOptionWarning | undefined {
  if (findFirstPositionalIndex(argv) !== -1) return undefined
  for (let i = 0; i < argv.length; i++) {
    const opt = argv[i]!
    const end = stepCliArgIndex(argv, i)
    const lastValue = argv[end]?.trim()
    if (
      VARIADIC_LIST_OPTIONS.has(opt) &&
      end > i + 1 &&
      lastValue !== undefined &&
      HAS_SPACE_OR_NON_ASCII.test(lastValue) &&
      !LOOKS_LIKE_PATH_OR_JSON_OR_URI.test(lastValue) &&
      HAS_NON_TOOL_WORD.test(lastValue.replace(/\(.*\)/s, ''))
    ) {
      return {
        problem: `"${truncateChars(collapseWs(lastValue), 40)}" was read as a value of ${opt}, not as a prompt`,
        fix: `put a prompt before ${opt} or after --`,
      }
    }
    i = end
  }
  return undefined
}

/**
 * Official 2.1.326 #173 — returns true when `-h` or `--help` is passed and stdout
 * is not a TTY (e.g. `claude --help | less`), so early raw-mode stdin capture
 * must be skipped to leave the pager in control of the terminal.
 */
export function shouldSkipEarlyInputForPipedHelp(
  argv: readonly string[] = process.argv.slice(2),
  stdoutIsTTY: boolean = process.stdout.isTTY === true,
): boolean {
  if (stdoutIsTTY) return false
  return eagerFindCliArg(t => t === '-h' || t === '--help', argv) !== -1
}

/**
 * Official 2.1.326 #341 (`rt`) — returns whichever initialize-stdin option is
 * present in argv before `--`, if any.
 */
export function findInitializeCliOption(
  argv: readonly string[],
): string | undefined {
  if (eagerHasCliFlag('--managed-settings-in-initialize', argv)) {
    return '--managed-settings-in-initialize'
  }
  if (
    eagerFindCliArg(
      t => t === '--initialize-fields' || t.startsWith('--initialize-fields='),
      argv,
    ) !== -1
  ) {
    return '--initialize-fields'
  }
  return eagerHasCliFlag('--await-initialize', argv)
    ? '--await-initialize'
    : undefined
}

/**
 * Official 2.1.326 #341 (`Ae`) — format the refusal error message when an
 * initialize-stdin option is combined with `--bg`, `--background`, `--routine`,
 * `--worktree --tmux`, or a background session command.
 */
export function formatInitializeConflictError(
  argv: readonly string[],
): string | undefined {
  const opt = findInitializeCliOption(argv)
  if (opt === undefined) return undefined
  return `Error: ${opt} can't be combined with \`--bg\`, \`--background\`, \`--routine\`, \`--worktree --tmux\` or a background session command such as \`claude logs\`: none of those reads the initialize request, so managed settings, settings, denied tools, plugins or MCP servers sent in it would be lost. Nothing was started. Remove those options, or remove ${opt} and pass the values with --managed-settings, --settings, --disallowedTools, --plugin-dir or --mcp-config.`
}
