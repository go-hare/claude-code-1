/**
 * densable `Zi` — first-run plugin-eval trust gate.
 * Gold: rSe("Trust this plugin directory?") then sIe persist
 * (`BFr` / hasTrustDialogAccepted) → source:"gate".
 */

import { createInterface } from 'readline'
import { acceptTrustForDirectory } from '../../../commands/cd/cdCommand.js'
import { findCanonicalGitRootUncached } from '../../git.js'
import { isPathTrusted } from '../../config.js'
import { logForDebugging } from '../../debug.js'
import { TRUST_FLAG } from './constants.js'
import type { TrustDecision } from './types.js'

export function isInteractiveEvalPrompt(
  json: boolean | string | undefined,
): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true && !json
}

/** densable `rSe` — readline `[y/N]`; close → false. */
export async function promptTrustYesNo(
  question: string,
  input: NodeJS.ReadableStream = process.stdin,
): Promise<boolean> {
  const rl = createInterface({ input, output: process.stdout })
  try {
    return await new Promise<boolean>(resolve => {
      let settled = false
      const finish = (value: boolean) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      rl.question(`${question} [y/N] `, answer => {
        const n = answer.trim().toLowerCase()
        finish(n === 'y' || n === 'yes')
        rl.close()
      })
      rl.once('close', () => finish(false))
    })
  } finally {
    rl.close()
  }
}

/** densable `sIe`/`BFr` — persist hasTrustDialogAccepted for the plugin dir. */
export async function persistPluginEvalTrust(
  pluginDir: string,
): Promise<void> {
  acceptTrustForDirectory(pluginDir)
}

function enclosingRepo(pluginDir: string): string | null {
  const root = findCanonicalGitRootUncached(pluginDir)
  if (!root) return null
  return root !== pluginDir ? root : null
}

/** densable `Zi`. */
export async function decidePluginTrust(params: {
  pluginDir: string
  installedPluginId?: string
  trustPluginFlag: boolean
  canPrompt: boolean
  input?: NodeJS.ReadableStream
}): Promise<TrustDecision> {
  if (params.installedPluginId !== undefined) {
    return { trusted: true, source: 'installed' }
  }
  if (isPathTrusted(params.pluginDir)) {
    return { trusted: true, source: 'folder' }
  }
  if (params.trustPluginFlag) {
    return { trusted: true, source: 'flag' }
  }
  const display = params.pluginDir
  if (!params.canPrompt) {
    return {
      trusted: false,
      reason: 'no_prompt',
      message: `Error: ${display} is not a trusted plugin directory, and this run cannot stop to ask you about it (no interactive terminal, or --json / CI). \`claude plugin eval\` loads the plugin and runs its eval suite on this machine as you - only evaluate plugins you trust. Run it once in a terminal to trust this directory, or pass ${TRUST_FLAG} to assert that you trust this plugin's code and eval suite (e.g. in CI).`,
    }
  }
  const repo = enclosingRepo(params.pluginDir)
  const marksRepo = repo !== null
  process.stdout.write(
    `\n\`claude plugin eval\` loads this plugin (its skills, hooks and MCP servers) and runs its eval suite - prompts and graders; scaffold scripts only with --scaffold - on this machine, as you. The run is sandboxed where the platform supports it, which limits what a malicious plugin can reach but is not a guarantee against one. A plugin's own suite passing says nothing about whether the plugin is safe.\n  Plugin directory: ${display}\n` +
      (marksRepo
        ? `  Trusting it marks the whole repository as trusted: ${repo}\n`
        : '') +
      `Only evaluate plugins you trust.\n`,
  )
  if (
    !(await promptTrustYesNo(
      'Trust this plugin directory?',
      params.input ?? process.stdin,
    ))
  ) {
    return {
      trusted: false,
      reason: 'declined',
      message: `Not trusted - nothing from ${display} was loaded or run.`,
    }
  }
  try {
    await persistPluginEvalTrust(params.pluginDir)
  } catch (error) {
    logForDebugging(
      `plugin eval: persisting trust failed: ${error instanceof Error ? error.message : String(error)}`,
      { level: 'error' },
    )
  }
  return { trusted: true, source: 'gate' }
}
