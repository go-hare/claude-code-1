/**
 * Official 2.1.331 `claude import` and `claude import-conversations` CLI
 * subcommands (`Lnl`, `Hnl`, `zEi`, `Dnl`).
 */
import type {
  Command as CommanderCommand,
  CommandUnknownOpts,
} from '@commander-js/extra-typings'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { cliError } from '../exit.js'

export const IMPORT_NOT_AVAILABLE_MESSAGE =
  '`claude import` is not yet available in this build. Run `claude` and use /mcp or edit ~/.claude/settings.json directly.'

export const IMPORT_CONFIG_ERROR_MESSAGE =
  'Could not read Claude Code config — run `claude` with no arguments to recover it.'

export const IMPORT_USAGE_MESSAGE =
  'Usage: claude import [codex|gemini|cursor] [--dry-run] [--yes[=<digest>]]\n\nStarts an interactive session and runs /import.'

const VALID_IMPORT_TOKENS = new Set([
  'codex',
  'gemini',
  'cursor',
  '--dry-run',
  '--yes',
])

const IMPORT_STOP_PREFIX_FLAGS = new Set([
  '--',
  '-h',
  '--help',
  '-v',
  '-V',
  '--version',
])

export type ParsedImportCliArgs = {
  prefix: string[]
  rest: string[]
}

export type RewriteImportCliResult =
  | { kind: 'config-error' }
  | { kind: 'not-available' }
  | { kind: 'rewrite'; argv: string[] }

export function isImportCliEnabled(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_ENABLE_IMPORT)
}

/**
 * Official 2.1.331 `Lnl`: detect `claude [flags...] import [codex|gemini|cursor] [--dry-run] [--yes[=<digest>]]`.
 */
export function parseImportCliArgs(
  argv: readonly string[],
): ParsedImportCliArgs | null {
  const idx = argv.indexOf('import')
  if (idx < 0) return null
  const prefix = argv.slice(0, idx)
  if (prefix.some(tok => IMPORT_STOP_PREFIX_FLAGS.has(tok))) return null
  const rest = argv.slice(idx + 1)
  if (prefix.length > 0 && rest.length === 0) return null
  if (
    !prefix.every(
      (tok, i) => tok.startsWith('-') || prefix[i - 1]?.startsWith('-'),
    )
  ) {
    return null
  }
  const allRestValid = rest.every(
    tok => VALID_IMPORT_TOKENS.has(tok) || tok.startsWith('--yes='),
  )
  if (!allRestValid) return null
  return { prefix, rest }
}

/**
 * Official 2.1.331 `Hnl`: rewrite `claude import ...` into interactive `/import ...`.
 */
export function rewriteImportCliArgs(
  parsed: ParsedImportCliArgs,
  enabled: boolean | undefined,
): RewriteImportCliResult {
  if (enabled === undefined) return { kind: 'config-error' }
  if (!enabled) return { kind: 'not-available' }
  return {
    kind: 'rewrite',
    argv: [...parsed.prefix, '--', ['/import', ...parsed.rest].join(' ')],
  }
}

export function importCliHandler(): never {
  if (!isImportCliEnabled()) {
    return cliError(IMPORT_NOT_AVAILABLE_MESSAGE)
  }
  return cliError(IMPORT_USAGE_MESSAGE)
}

export function registerImportCommands(program: CommanderCommand): {
  importCmd: CommandUnknownOpts
  importConversationsCmd: CommandUnknownOpts
} {
  const importCmd = program
    .command('import')
    .argument('[source]', 'Which agent to import from (codex, gemini, cursor)')
    .option('--dry-run', 'Show what would be imported without writing anything')
    .option(
      '--yes',
      'Skip the interactive picker. In non-interactive mode, pass --yes=<digest> from the `/import` preview.',
    )
    .description('Import config from another AI coding agent into Claude Code')
    .action(() => {
      importCliHandler()
    })

  const importConversationsCmd = program
    .command('import-conversations <exportPath>', { hidden: true })
    .option('--cwd <dir>', 'Archive directory the imported sessions anchor to')
    .option('--dry-run', 'Parse and verify manifest without writing files')
    .action(
      async (
        exportPath: string,
        options: { cwd?: string; dryRun?: boolean },
      ) => {
        const { importConversationsHandler } = await import(
          './importConversations.js'
        )
        await importConversationsHandler(exportPath, options)
      },
    )

  return { importCmd, importConversationsCmd }
}
