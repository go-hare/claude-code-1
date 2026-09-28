/**
 * densable 2.1.283 plugin CLI `--accept-command` / `--json` (j / F / M / Qxe).
 *
 * Catalog revision (Y) is a stable marketplace-cache fingerprint so a later
 * `--accept-command <sha256>` only matches the same plugin + catalog.
 */
import { createHash, randomUUID } from 'crypto'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { jsonStringify } from '../slowOperations.js'
import { writeToStdout } from '../process.js'
import { parsePluginIdentifier } from './pluginIdentifier.js'

/** densable `Ait` — child/session Claude Code process. */
export function isInsideClaudeCodeSession(): boolean {
  return Boolean(
    process.env.CLAUDE_CODE_CHILD_SESSION || process.env.CLAUDECODE,
  )
}

export type CommandSourceShownCommand = {
  kind: 'command_source'
  pluginId: string
  command: string
  mode: 'link' | 'copy'
  catalogRevision: string
}

export type EntryHelperShownCommand = {
  kind: 'entry_helper'
  pluginId: string
  command: string
  archiveUrl: string
  catalogRevision: string
}

export type MarketplaceShownCommand =
  | CommandSourceShownCommand
  | EntryHelperShownCommand

export type MarketplaceShownCommandWithSha = MarketplaceShownCommand & {
  sha256: string
  acceptCommandMatched?: boolean
}

export type PluginCliJsonCommand =
  | 'install'
  | 'uninstall'
  | 'enable'
  | 'disable'
  | 'update'

export type PluginCliJsonLine = {
  command: PluginCliJsonCommand
  outcome: 'ok' | 'failed'
  plugin?: string
  pluginId?: string
  scope?: string
  message: string
  failureCode?: string
  shownCommand?: MarketplaceShownCommandWithSha
  [key: string]: unknown
}

/** densable `se` — keep shownCommand on these failure codes only. */
export const PLUGIN_JSON_SHOWN_COMMAND_FAILURE_CODES = new Set([
  'command_source_refused',
  'command_source_declined',
  'entry_helper_unconfirmed',
  'entry_helper_declined',
])

export type MarketplaceCommandConfirmVerdict =
  | 'accepted'
  | 'declined'
  | 'unconfirmed'

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return ['[', ...value.map(canonicalJson)]
  }
  if (value !== null && typeof value === 'object') {
    const rec = value as Record<string, unknown>
    return [
      '{',
      ...Object.keys(rec)
        .sort()
        .map(k => [k, canonicalJson(rec[k])]),
    ]
  }
  return value
}

function sha256Utf8(payload: unknown): string {
  return createHash('sha256')
    .update(jsonStringify(payload), 'utf8')
    .digest('hex')
}

/** densable `j` */
export function hashShownCommand(shown: MarketplaceShownCommand): string {
  const parts =
    shown.kind === 'command_source'
      ? [
          shown.kind,
          shown.pluginId,
          shown.command,
          shown.mode,
          shown.catalogRevision,
        ]
      : [
          shown.kind,
          shown.pluginId,
          shown.command,
          shown.archiveUrl,
          shown.catalogRevision,
        ]
  return sha256Utf8(parts)
}

/** densable `rXn` */
export function withShownCommandSha256(
  shown: MarketplaceShownCommand,
): MarketplaceShownCommandWithSha {
  return { ...shown, sha256: hashShownCommand(shown) }
}

/** densable `F` */
export function acceptCommandMatches(
  acceptCommand: string | undefined,
  shown: MarketplaceShownCommand,
): boolean {
  return (
    acceptCommand !== undefined &&
    acceptCommand.trim().toLowerCase() === hashShownCommand(shown)
  )
}

/** densable `U` */
export function withAcceptCommandMatched(
  shown: MarketplaceShownCommand,
  acceptCommand: string | undefined,
): MarketplaceShownCommandWithSha {
  const hashed = withShownCommandSha256(shown)
  if (acceptCommand === undefined) {
    return hashed
  }
  return {
    ...hashed,
    acceptCommandMatched: acceptCommandMatches(acceptCommand, shown),
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}

async function hashMarketplaceCatalogFiles(
  installLocation: string,
): Promise<string> {
  let marketplaceJson: string
  let nested = true
  try {
    marketplaceJson = await readFile(
      join(installLocation, '.claude-plugin', 'marketplace.json'),
      'utf8',
    )
  } catch (error) {
    if (!isMissingPathError(error)) throw error
    marketplaceJson = await readFile(installLocation, 'utf8')
    nested = false
  }
  let packageJson: string | null = null
  if (nested) {
    try {
      packageJson = await readFile(join(installLocation, 'package.json'), 'utf8')
    } catch (error) {
      if (!isMissingPathError(error)) throw error
    }
  }
  const parsedMarketplace = JSON.parse(marketplaceJson) as unknown
  const parsedPackage =
    packageJson === null ? null : (JSON.parse(packageJson) as unknown)
  return sha256Utf8([
    canonicalJson(parsedMarketplace),
    parsedPackage === null ? null : canonicalJson(parsedPackage),
  ])
}

/**
 * densable `Y` — catalog fingerprint mixed into shownCommand.sha256.
 * Remote/unreadable caches fall back to `unreadable:<uuid>` (not reusable).
 */
export async function resolveMarketplaceCatalogRevision(
  pluginId: string,
): Promise<string> {
  const unread = `unreadable:${randomUUID()}`
  const { marketplace } = parsePluginIdentifier(pluginId)
  if (!marketplace) return unread
  try {
    const { loadKnownMarketplacesConfig } = await import(
      './marketplaceManager.js'
    )
    const known = await loadKnownMarketplacesConfig()
    const entry = known[marketplace]
    if (!entry) return unread
    if (entry.source.source === 'claudeai') return unread
    const installLocation = entry.installLocation
    if (!installLocation) return unread
    if (entry.source.source === 'github' || entry.source.source === 'git') {
      const { execFileNoThrowWithCwd } = await import('../execFileNoThrow.js')
      const rev = await execFileNoThrowWithCwd('git', ['rev-parse', 'HEAD'], {
        cwd: installLocation,
        useCwd: false,
      })
      if (rev.code === 0 && rev.stdout.trim()) {
        return `git:${rev.stdout.trim()}`
      }
    }
    return `sha256:${await hashMarketplaceCatalogFiles(installLocation)}`
  } catch {
    return unread
  }
}

export async function describeCommandSourceShown(options: {
  pluginId: string
  command: string
  mode: 'link' | 'copy'
}): Promise<CommandSourceShownCommand> {
  return {
    kind: 'command_source',
    pluginId: options.pluginId,
    command: options.command,
    mode: options.mode,
    catalogRevision: await resolveMarketplaceCatalogRevision(options.pluginId),
  }
}

export async function describeEntryHelperShown(options: {
  pluginId: string
  command: string
  archiveUrl: string
}): Promise<EntryHelperShownCommand> {
  let archiveUrl = options.archiveUrl
  try {
    archiveUrl = new URL(options.archiveUrl).origin
  } catch {
    // keep raw
  }
  return {
    kind: 'entry_helper',
    pluginId: options.pluginId,
    command: options.command,
    archiveUrl,
    catalogRevision: await resolveMarketplaceCatalogRevision(options.pluginId),
  }
}

/**
 * densable `M` — TTY / `-y` / `--accept-command` gates.
 */
export async function confirmMarketplaceDeclaredCommand(options: {
  yes?: boolean
  acceptCommand?: string
  shown?: MarketplaceShownCommand
  write?: (text: string) => void
}): Promise<MarketplaceCommandConfirmVerdict> {
  const write =
    options.write ??
    ((text: string) => {
      try {
        process.stdout.write(text)
      } catch {
        // ignore
      }
    })
  const isTty = Boolean(process.stdout.isTTY && process.stdin.isTTY)
  const yes = options.yes === true
  const shown = options.shown
  const acceptCommand = options.acceptCommand
  if (yes || (shown !== undefined && acceptCommandMatches(acceptCommand, shown))) {
    if (!isInsideClaudeCodeSession()) return 'accepted'
    if (!isTty) {
      write(
        `${yes ? '-y/--yes' : '--accept-command'} is ignored inside a Claude Code session: run this in your own terminal to accept the command shown above.\n`,
      )
      return 'unconfirmed'
    }
  }
  if (
    !isTty &&
    acceptCommand !== undefined &&
    shown !== undefined &&
    !acceptCommandMatches(acceptCommand, shown)
  ) {
    write(
      '--accept-command does not name the command shown above (it may have changed since it was shown), so it was not run. Show it to the person again before accepting it.\n',
    )
    return 'unconfirmed'
  }
  if (!isTty) {
    write(
      isInsideClaudeCodeSession()
        ? 'Not an interactive terminal, so the command was only displayed, not accepted. Run this in your own terminal (outside the Claude Code session) to confirm the command shown above.\n'
        : 'Not an interactive terminal, so the command was only displayed, not accepted. Re-run in a terminal to confirm it, or pass -y/--yes to accept the command shown above.\n',
    )
    return 'unconfirmed'
  }
  write('Run this command now? [y/N] ')
  const ok = await readYesNoFromStdin()
  return ok ? 'accepted' : 'declined'
}

/** densable `z` — y/yes from one stdin line. */
async function readYesNoFromStdin(
  input: NodeJS.ReadableStream = process.stdin,
): Promise<boolean> {
  const readline = await import('readline')
  const rl = readline.createInterface({ input })
  try {
    for await (const line of rl) {
      return /^y(es)?$/i.test(String(line).trim())
    }
    return false
  } finally {
    rl.close()
  }
}

/** densable `Qxe` */
export async function printPluginCliJsonLine(
  line: PluginCliJsonLine,
): Promise<void> {
  const payload =
    line.failureCode !== undefined &&
    PLUGIN_JSON_SHOWN_COMMAND_FAILURE_CODES.has(line.failureCode)
      ? line
      : { ...line, shownCommand: undefined }
  writeToStdout(`${jsonStringify(payload)}\n`)
}
