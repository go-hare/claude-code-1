/**
 * Official 2.1.331 hidden `claude workspace-trust --json` handler (`_s` / `Ni`).
 *
 * Reports whether the current directory holds a persisted workspace trust
 * record, as JSON (used by the VS Code extension).
 */
import type { Command as CommanderCommand } from '@commander-js/extra-typings'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { parse, resolve } from 'node:path'
import { isPathTrusted } from '../../utils/config.js'
import { getCwd } from '../../utils/cwd.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { cliError, cliOk } from '../exit.js'

export type WorkspaceTrustReport = {
  trusted: boolean
  directory: string
  root?: string
  unsafe_path?: boolean
  sandbox_limits_files: boolean
  may_renew_sign_in: boolean
}

function isUnsafeTrustDirectory(dir: string): boolean {
  const normalized = resolve(dir)
  const parsed = parse(normalized)
  if (normalized === parsed.root) return true
  try {
    if (normalized === resolve(homedir())) return true
  } catch {
    // ignore homedir errors
  }
  return false
}

export function buildWorkspaceTrustReport(
  directory: string = getCwd(),
): WorkspaceTrustReport {
  let realDir = directory
  try {
    realDir = realpathSync(directory)
  } catch {
    realDir = resolve(directory)
  }
  const trusted = isPathTrusted(realDir)
  const unsafePath =
    !trusted && [directory, realDir].some(p => isUnsafeTrustDirectory(p))

  const sandboxLimitsFiles = SandboxManager.isSandboxingEnabled()
  return {
    trusted,
    directory,
    ...(unsafePath ? { unsafe_path: true } : {}),
    sandbox_limits_files: sandboxLimitsFiles,
    may_renew_sign_in: true,
  }
}

export async function workspaceTrustHandler(): Promise<void> {
  let report: WorkspaceTrustReport
  try {
    report = buildWorkspaceTrustReport(getCwd())
  } catch (err) {
    return cliError(
      `claude workspace-trust: the trust record could not be read: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return cliOk(jsonStringify(report))
}

export function registerWorkspaceTrustCommand(
  program: CommanderCommand,
): CommanderCommand {
  return program
    .command('workspace-trust', { hidden: true })
    .allowExcessArguments(false)
    .description(
      'Report whether the current directory holds a persisted workspace trust record, as JSON (used by the VS Code extension)',
    )
    .requiredOption('--json', 'Write one JSON object to stdout')
    .action(async () => {
      await workspaceTrustHandler()
    })
}
