/**
 * densable 2.1.283 `AXn` — hidden stdin JSON commands the VS Code extension
 * runs. Gold commander @191873466–191878408. CLI body lives here; this is not
 * a VS Code extension project.
 */
import type { Command as CommanderCommand } from '@commander-js/extra-typings'
import { jsonStringify } from '../../utils/slowOperations.js'
import { isChildSession } from '../../utils/sessionRoleEnv.js'
import { getPinnedStorageV5 } from '../../utils/storageV5/index.js'
import { safeParseJSON } from '../../utils/json.js'
import { cliError, cliOk } from '../exit.js'
import { readStdinUpTo, VSCODE_CHILD_SESSION_REFUSAL } from '../vscodeStdin.js'

function childSessionRefusal(): string | undefined {
  return isChildSession() ? VSCODE_CHILD_SESSION_REFUSAL : undefined
}

async function readJsonEdit(
  maxBytes: number,
  emptyMessage: string,
): Promise<unknown> {
  const raw = await readStdinUpTo(maxBytes)
  const parsed = raw === null ? null : safeParseJSON(raw, false)
  if (parsed === null) {
    return cliError(emptyMessage)
  }
  return parsed
}

export function registerVscodeExtensionHostCommands(
  program: CommanderCommand,
): void {
  program
    .command('edit-permission-rules', { hidden: true })
    .allowExcessArguments(false)
    .description(
      'Apply one permission-rule edit read as JSON from stdin (used by the VS Code extension)',
    )
    .requiredOption('--json', 'Read the edit as JSON from stdin')
    .action(async () => {
      if (process.stdin.isTTY) {
        return cliError(
          'claude edit-permission-rules reads one JSON edit from stdin; it is run by the VS Code extension, not by hand',
        )
      }
      const child = childSessionRefusal()
      if (child !== undefined) return cliError(child)
      const { runPermissionRuleEdit } = await import('./permissionRuleEdit.js')
      const edit = await readJsonEdit(
        2_097_152,
        'claude edit-permission-rules: stdin is not a JSON edit',
      )
      const result = await runPermissionRuleEdit(edit, getPinnedStorageV5())
      if (!result.ok) return cliError(result.error)
      process.stdout.write(
        `${jsonStringify({
          ok: true,
          warnings: result.warnings,
          stored: result.stored,
        })}\n`,
      )
      process.exit(0)
    })

  program
    .command('edit-memory-settings', { hidden: true })
    .allowExcessArguments(false)
    .description(
      'Apply one memory-settings edit read as JSON from stdin (used by the VS Code extension)',
    )
    .requiredOption('--json', 'Read the edit as JSON from stdin')
    .action(async () => {
      if (process.stdin.isTTY) {
        return cliError(
          'claude edit-memory-settings reads one JSON edit from stdin; it is run by the VS Code extension, not by hand',
        )
      }
      const child = childSessionRefusal()
      if (child !== undefined) return cliError(child)
      const { runMemorySettingsEdit } = await import('./memorySettingsEdit.js')
      const edit = await readJsonEdit(
        4096,
        'claude edit-memory-settings: stdin is not a JSON edit',
      )
      const result = await runMemorySettingsEdit(edit, getPinnedStorageV5())
      if (!result.ok) return cliError(result.error)
      return cliOk(jsonStringify({ ok: true, written: result.written }))
    })

  program
    .command('edit-skill-overrides', { hidden: true })
    .allowExcessArguments(false)
    .description(
      'Apply one skill state edit read as JSON from stdin (used by the VS Code extension)',
    )
    .requiredOption('--json', 'Read the edit as JSON from stdin')
    .action(async () => {
      if (process.stdin.isTTY) {
        return cliError(
          'claude edit-skill-overrides reads one JSON edit from stdin; it is run by the VS Code extension, not by hand',
        )
      }
      if (isChildSession()) return cliError(VSCODE_CHILD_SESSION_REFUSAL)
      const { runSkillOverrideEdit } = await import('./skillOverrideEdit.js')
      const edit = await readJsonEdit(
        4096,
        'claude edit-skill-overrides: stdin is not a JSON edit',
      )
      const result = await runSkillOverrideEdit(
        edit,
        process.cwd(),
        getPinnedStorageV5(),
      )
      if (!result.ok) return cliError(result.error)
      process.stdout.write(
        `${jsonStringify({
          ok: true,
          written: result.written,
          changed: result.changed,
        })}\n`,
      )
      process.exit(0)
    })

  program
    .command('edit-sandbox-settings', { hidden: true })
    .allowExcessArguments(false)
    .description(
      'Apply one sandbox settings edit read as JSON from stdin (used by the VS Code extension)',
    )
    .requiredOption('--json', 'Read the edit as JSON from stdin')
    .action(async () => {
      if (process.stdin.isTTY) {
        return cliError(
          'claude edit-sandbox-settings reads one JSON edit from stdin; it is run by the VS Code extension, not by hand',
        )
      }
      const child = childSessionRefusal()
      if (child !== undefined) return cliError(child)
      const { runSandboxSettingsEdit } = await import(
        './sandboxSettingsEdit.js'
      )
      const edit = await readJsonEdit(
        4096,
        'claude edit-sandbox-settings: stdin is not a JSON edit',
      )
      const result = await runSandboxSettingsEdit(edit)
      if (!result.ok) return cliError(result.error)
      return cliOk(jsonStringify({ ok: true, written: result.written }))
    })

  program
    .command('design-login', { hidden: true })
    .allowExcessArguments(false)
    .description(
      'Run the Claude Design sign-in, or report its state, as JSON lines (used by the VS Code extension)',
    )
    .requiredOption('--json', 'Write JSON lines to stdout')
    .option(
      '--status',
      'Report whether design-system access is authorized, and exit',
    )
    .action(async (opts: { status?: boolean }) => {
      if (process.stdin.isTTY) {
        return cliError(
          'claude design-login --json is run by the VS Code extension, not by hand; use /design-login in a session',
        )
      }
      if (isChildSession()) {
        return cliError(
          'claude design-login --json is not available from inside a Claude Code session',
        )
      }
      const { designLoginStatus, runDesignLoginSignIn } = await import(
        './designLogin.js'
      )
      if (opts.status) {
        return cliOk(jsonStringify(await designLoginStatus()))
      }
      const abort = new AbortController()
      const { markPrintModeSignalHandlersRegistered } = await import(
        '../../utils/gracefulShutdown.js'
      )
      process.once('SIGTERM', () => abort.abort())
      process.once('SIGINT', () => abort.abort())
      markPrintModeSignalHandlersRegistered()
      const result = await runDesignLoginSignIn({
        stdin: process.stdin,
        write: async line => {
          process.stdout.write(`${line}\n`)
        },
        signal: abort.signal,
      })
      process.exit(result.ok ? 0 : 1)
    })

  program
    .command('edit-chrome-settings', { hidden: true })
    .allowExcessArguments(false)
    .description(
      'Apply one Claude in Chrome settings edit read as JSON from stdin (used by the VS Code extension)',
    )
    .requiredOption('--json', 'Read the edit as JSON from stdin')
    .action(async () => {
      if (process.stdin.isTTY) {
        return cliError(
          'claude edit-chrome-settings reads one JSON edit from stdin; it is run by the VS Code extension, not by hand',
        )
      }
      if (isChildSession()) return cliError(VSCODE_CHILD_SESSION_REFUSAL)
      const { runChromeSettingsEdit } = await import('./chromeSettingsEdit.js')
      const edit = await readJsonEdit(
        4096,
        'claude edit-chrome-settings: stdin is not a JSON edit',
      )
      const result = await runChromeSettingsEdit(edit, getPinnedStorageV5())
      if (!result.ok) return cliError(result.error)
      process.stdout.write(
        `${jsonStringify({ ok: true, written: result.written })}\n`,
      )
      process.exit(0)
    })
}
