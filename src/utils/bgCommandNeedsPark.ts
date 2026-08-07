/**
 * densable 2.1.216 CUt / dRs / pRs / gQp / zpd / Kpd —
 * Park a "needs input" request on the bg job when an interactive command
 * (`/mcp`, `/install-github-app`, MCP reauth) runs with no attached terminal.
 *
 * CUt(needs, detail):
 *   if !SB() return false
 *   switch dRs(needs, detail):
 *     refused → false
 *     already → ensure restore watcher; true
 *     wrote   → gQp restore watcher with prior; true
 *
 * On attach (SB becomes false): restore prior tempo/needs/detail.
 */

import { getAttacherCaps, subscribeAttacherCaps } from '../bootstrap/state.js'
import type { BgJobState, BgSessionTempo } from '../daemon/jobState.js'
import { isBgSession } from './concurrentSessions.js'

export type BgNeedsParkKind = 'refused' | 'already' | 'wrote'

export type BgNeedsParkResult =
  | { kind: 'refused' }
  | { kind: 'already' }
  | {
      kind: 'wrote'
      prior: { tempo: BgSessionTempo; needs?: string; detail: string }
    }

/** densable EMPTY_PROMPT_NEEDS / Yx — do not refuse overwrite of this needs. */
export const EMPTY_PROMPT_NEEDS = 'send a prompt to start'

type Prior = { tempo: BgSessionTempo; needs?: string; detail: string }

type ActivePark = {
  needs: string
  prior: Prior
  unsubscribe: () => void
}

let activePark: ActivePark | null = null

/** densable SB() = Zi() && !vT() — bg without attached terminal. */
export function isBgNoTerminal(): boolean {
  if (!isBgSession()) return false
  return !getAttacherCaps()
}

function resolveJobShort(): string {
  if (process.env.CLAUDE_BG_SHORT) return process.env.CLAUDE_BG_SHORT
  const jobDir = process.env.CLAUDE_JOB_DIR
  if (!jobDir) return ''
  return (
    jobDir
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || ''
  )
}

/**
 * densable zpd — write tempo:blocked + needs/detail; refuse if another needs
 * already parks (except empty-prompt Yx).
 */
export async function writeBgCommandNeedsPark(
  needs: string,
  detail: string,
): Promise<BgNeedsParkResult> {
  const short = resolveJobShort()
  if (!short && !process.env.CLAUDE_JOB_DIR) return { kind: 'refused' }
  if (!short) return { kind: 'refused' }
  try {
    const { readBgJobState, writeBgJobState } = await import(
      '../daemon/jobState.js'
    )
    const n = readBgJobState(short)
    if (!n) return { kind: 'refused' }
    if (n.tempo === 'blocked' && n.needs === needs) return { kind: 'already' }
    if (n.tempo === 'blocked' && n.needs !== EMPTY_PROMPT_NEEDS) {
      return { kind: 'refused' }
    }
    const prior: Prior = {
      tempo: n.tempo,
      needs: n.needs,
      detail: n.detail,
    }
    const next: BgJobState = {
      ...n,
      tempo: 'blocked',
      detail,
      needs,
      updatedAt: new Date().toISOString(),
    }
    writeBgJobState(short, next)
    return { kind: 'wrote', prior }
  } catch {
    return { kind: 'refused' }
  }
}

/**
 * densable Kpd — restore prior only while still parked on the same needs.
 */
export async function clearBgCommandNeedsPark(
  needs: string,
  prior: Prior,
): Promise<void> {
  const short = resolveJobShort()
  if (!short) return
  try {
    const { readBgJobState, writeBgJobState } = await import(
      '../daemon/jobState.js'
    )
    const n = readBgJobState(short)
    if (!n || n.tempo !== 'blocked' || n.needs !== needs) return
    writeBgJobState(short, {
      ...n,
      tempo: prior.tempo,
      needs: prior.needs,
      detail: prior.detail,
      updatedAt: new Date().toISOString(),
    })
  } catch {
    // never throw into command path
  }
}

/**
 * densable gQp — watch attacher caps; on attach clear park + restore prior.
 */
function armParkRestore(needs: string, prior: Prior): void {
  activePark?.unsubscribe()
  const unsubscribe = subscribeAttacherCaps(() => {
    // densable: if(SB()) return — still no terminal
    if (isBgNoTerminal()) return
    const cur = activePark
    if (!cur || cur.needs !== needs) return
    activePark = null
    cur.unsubscribe()
    void clearBgCommandNeedsPark(needs, cur.prior)
  })
  activePark = { needs, prior, unsubscribe }
}

/**
 * densable CUt(needs, detail) — park needs-input for agent view.
 * @returns true when park was written or already present (show "needs input" copy).
 */
export async function parkBgCommandNeedsInput(
  needs: string,
  detail: string,
): Promise<boolean> {
  if (!isBgNoTerminal()) return false
  const r = await writeBgCommandNeedsPark(needs, detail)
  switch (r.kind) {
    case 'refused':
      return false
    case 'already':
      if (activePark?.needs !== needs) {
        armParkRestore(needs, {
          tempo: 'idle',
          needs: undefined,
          detail: '',
        })
      }
      return true
    case 'wrote':
      armParkRestore(needs, r.prior)
      return true
  }
}

/** densable hOb */
export const MCP_SETTINGS_NEEDS = 'open this session to manage MCP servers'
/** densable "MCP settings requested" detail */
export const MCP_SETTINGS_DETAIL = 'MCP settings requested'

/** densable install-github-app needs/detail */
export const INSTALL_GITHUB_APP_NEEDS =
  'open this session to finish /install-github-app'
export const INSTALL_GITHUB_APP_DETAIL = '/install-github-app requested'

/**
 * densable gOb — refuse /mcp panel without park success.
 */
export const BG_NO_TERMINAL_MCP_SETTINGS_MSG =
  "Can't open MCP settings while no terminal is attached to this background session. Attach to it and run /mcp again, or use `/mcp enable|disable|reconnect <server>` to steer without the panel."

/**
 * densable _Ob — refuse /mcp panel after successful park (agent view shows needs).
 */
export const BG_NO_TERMINAL_MCP_SETTINGS_PARKED_MSG =
  'Can\'t open MCP settings while no terminal is attached to this background session. This session now shows "needs input" in agent view — open it and run /mcp to manage servers, or use `/mcp enable|disable|reconnect <server>` to steer without the panel.'

/**
 * densable attach-path refuse for /install-github-app (no park).
 */
export const BG_NO_TERMINAL_INSTALL_GITHUB_APP_MSG =
  "Can't run /install-github-app while no terminal is attached to this background session. Attach to it and run the command again."

/**
 * densable parked refuse for /install-github-app.
 */
export const BG_NO_TERMINAL_INSTALL_GITHUB_APP_PARKED_MSG =
  'Can\'t run /install-github-app while no terminal is attached to this background session. This session now shows "needs input" in agent view — open it and run the command again.'

/** densable sof — /mcp panel refuse + optional park. */
export async function parkMcpSettingsNeedsInput(): Promise<string> {
  const parked = await parkBgCommandNeedsInput(
    MCP_SETTINGS_NEEDS,
    MCP_SETTINGS_DETAIL,
  )
  return parked
    ? BG_NO_TERMINAL_MCP_SETTINGS_PARKED_MSG
    : BG_NO_TERMINAL_MCP_SETTINGS_MSG
}

/** densable CRb park branch — /install-github-app refuse + optional park. */
export async function parkInstallGithubAppNeedsInput(): Promise<string> {
  const parked = await parkBgCommandNeedsInput(
    INSTALL_GITHUB_APP_NEEDS,
    INSTALL_GITHUB_APP_DETAIL,
  )
  return parked
    ? BG_NO_TERMINAL_INSTALL_GITHUB_APP_PARKED_MSG
    : BG_NO_TERMINAL_INSTALL_GITHUB_APP_MSG
}

/**
 * densable needs-auth reconnect copy.
 * When SB: CUt(`authenticate ${name} — open this session and run /mcp`, "MCP authentication needed")
 * then message + optional " It now shows \"needs input\" in agent view."
 */
export async function formatMcpNeedsAuthMessage(
  serverName: string,
): Promise<string> {
  if (!isBgNoTerminal()) {
    return `${serverName} requires authentication. Use /mcp to authenticate.`
  }
  const needs = `authenticate ${serverName} — open this session and run /mcp`
  const parked = await parkBgCommandNeedsInput(
    needs,
    'MCP authentication needed',
  )
  return (
    `${serverName} requires authentication. Open this session and run /mcp to authenticate.` +
    (parked ? ' It now shows "needs input" in agent view.' : '')
  )
}

/** Test helper. */
export function _resetBgCommandNeedsParkForTests(): void {
  activePark?.unsubscribe()
  activePark = null
}
