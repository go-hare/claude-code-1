/**
 * Official 2.1.331 `Fo` / `Do` non-command word hints (used when a user runs a
 * nonexistent top-level word like `claude config` or `claude migrate-installer`).
 */

export const NON_COMMAND_WORD_HINTS: ReadonlyMap<string, string> = new Map([
  ['help', 'For help, run claude --help'],
  ['version', 'For the version, run claude --version'],
  ['login', 'To log in, run claude auth login'],
  ['logout', 'To log out, run claude auth logout'],
  ['status', 'To see whether you are logged in, run claude auth status'],
  [
    'config',
    'To see or change settings, run claude at a terminal and type /config, or open your settings files',
  ],
  ['migrate-installer', 'To move to the native installer, run claude install'],
])

/**
 * Words that used to exist as CLI subcommands and exit 0 with a redirect hint
 * when invoked non-interactively (official `Do` set).
 */
export const RETIRED_COMMAND_WORDS: ReadonlySet<string> = new Set([
  'config',
  'migrate-installer',
])

export function getCommandWordHint(word: string): string | undefined {
  return NON_COMMAND_WORD_HINTS.get(word.toLowerCase())
}

export function isRetiredCommandWord(word: string): boolean {
  return RETIRED_COMMAND_WORDS.has(word.toLowerCase())
}
