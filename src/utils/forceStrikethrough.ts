/**
 * Official wLr portable — CLAUDE_CODE_FORCE_STRIKETHROUGH + terminal heuristics.
 *
 * Apple Terminal and linux console disable strikethrough by default; known
 * modern terminals enable it. FORCE env forces on.
 */

import { isEnvTruthy } from './envUtils.js'

const STRIKETHROUGH_TERM_PROGRAMS = new Set([
  'iTerm.app',
  'vscode',
  'WarpTerminal',
  'WezTerm',
  'Alacritty',
  'kitty',
  'Hyper',
  'Tabby',
  'rio',
  'ghostty',
])

export function isForceStrikethroughEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_FORCE_STRIKETHROUGH)
}

/**
 * Whether the terminal is likely to render strikethrough correctly.
 * Pure heuristic matching official wLr shape (FORCE → known-bad → known-good).
 */
export function supportsStrikethrough(input?: {
  env?: NodeJS.ProcessEnv
  termProgram?: string
  term?: string
  isGhostty?: boolean
  isMintty?: boolean
  isJetBrainsIde?: boolean
}): boolean {
  const env = input?.env ?? process.env
  if (isForceStrikethroughEnabled(env)) return true
  const termProgram = input?.termProgram ?? env.TERM_PROGRAM ?? ''
  const term = input?.term ?? env.TERM ?? ''
  if (termProgram === 'Apple_Terminal' || term === 'linux') return false
  if (STRIKETHROUGH_TERM_PROGRAMS.has(termProgram)) return true
  if (input?.isGhostty || input?.isMintty || input?.isJetBrainsIde) return true
  // VTE ≥ 6800
  const vte = env.VTE_VERSION
  if (vte) {
    const n = parseInt(vte, 10)
    if (!Number.isNaN(n) && n >= 6800) return true
  }
  if (env.ZED_TERM) return true
  if (env.WT_SESSION) return true
  return false
}
