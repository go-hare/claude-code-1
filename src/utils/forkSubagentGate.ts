/**
 * densable 2.1.232 #1 — FORK_SUBAGENT product default ON (non-ant).
 *
 * Gold (SEA):
 *   function Drb(){
 *     if (X.CLAUDE_CODE_FORK_SUBAGENT===true) return "env";
 *     if (Nn()) return "disabled"; // USER_TYPE=ant
 *     return "default"; // product default ON
 *   }
 *   function FDd(){
 *     if (Ige()) return "disabled"; // coordinator (caller applies)
 *     if (X.CLAUDE_CODE_FORK_SUBAGENT===false) return "disabled";
 *     if (session.forkSubagentEnabledSource !== undefined) return session source;
 *     let t = Drb();
 *     if (t !== "disabled") session.forkSubagentEnabledSource = t;
 *     return t;
 *   }
 *   function _Ie(){ return FDd() !== "disabled"; }
 *
 * Local: env force/disable + ant disable + default ON + session sticky
 * (`forkSubagentEnabledSource`). This stays the 2.1.232 Drb resolver.
 * 2.1.289 Yne (`isForkSubagentProductEnabled`) does not consult it:
 * Imo ignores USER_TYPE, and Ce lives on Yne.
 */

import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
import { isForkSubagentDisabled } from './sessionBackgroundGates.js'
import { getBootstrapSession, RootSessionSlot } from './sessionHost.js'

export type ForkSubagentSource = 'env' | 'default' | 'disabled' | 'disabled_ant'

/**
 * densable UL().forkSubagentEnabledSource — session sticky.
 * Only the live (no-input) path writes/reads it. Explicit `{env,isAnt}`
 * injection is Drb-only so tests do not pin the session.
 */
const fallbackForkSubagentSession = { root: {} as object }
const forkSubagentSourceBySession = new RootSessionSlot<{
  source: ForkSubagentSource | undefined
}>(() => ({ source: undefined }))

function getForkSubagentSourceSlot(): {
  source: ForkSubagentSource | undefined
} {
  try {
    const session = getBootstrapSession()
    if (session?.root) return forkSubagentSourceBySession.of(session)
  } catch {
    // Fall back when sessionHost is mocked
  }
  return forkSubagentSourceBySession.of(fallbackForkSubagentSession)
}

/** Test helper — gold new UL() drops the sticky. */
export function resetForkSubagentSessionSource(): void {
  getForkSubagentSourceSlot().source = undefined
}

/**
 * densable Drb — env true→env; ant→disabled; else default.
 */
export function resolveForkSubagentDrb(input?: {
  env?: NodeJS.ProcessEnv
  isAnt?: boolean
}): ForkSubagentSource {
  const env = input?.env ?? process.env
  if (isEnvTruthy(env.CLAUDE_CODE_FORK_SUBAGENT)) return 'env'
  if (input?.isAnt === true) return 'disabled_ant'
  if (
    input?.isAnt === undefined &&
    (env.USER_TYPE === 'ant' || process.env.USER_TYPE === 'ant')
  ) {
    return 'disabled_ant'
  }
  return 'default'
}

/**
 * densable FDd env/ant/default arm (coordinator stays in AgentTool).
 *
 * Gold FDd: env false → disabled (no write); else session sticky; else Drb
 * and write when not disabled. Live path only.
 */
export function resolveForkSubagentSource(input?: {
  env?: NodeJS.ProcessEnv
  isAnt?: boolean
  /**
   * @deprecated densable Drb does not consult GB for default-on; ignored.
   * Kept for call-site compat.
   */
  gbValue?: boolean
}): ForkSubagentSource {
  if (isForkSubagentDisabled()) return 'disabled'
  const env = input?.env ?? process.env
  // densable FDd: CLAUDE_CODE_FORK_SUBAGENT===false → "disabled" (before sticky)
  if (isEnvDefinedFalsy(env.CLAUDE_CODE_FORK_SUBAGENT)) return 'disabled'
  const useSticky = input?.env === undefined && input?.isAnt === undefined
  const slot = useSticky ? getForkSubagentSourceSlot() : undefined
  if (slot && slot.source !== undefined) {
    return slot.source
  }
  const resolved = resolveForkSubagentDrb(input)
  if (slot && resolved !== 'disabled' && resolved !== 'disabled_ant') {
    slot.source = resolved
  }
  return resolved
}

/**
 * densable _Ie — true when source is not disabled / disabled_ant.
 */
export function isForkSubagentEnabled(input?: {
  env?: NodeJS.ProcessEnv
  isAnt?: boolean
  gbValue?: boolean
}): boolean {
  const src = resolveForkSubagentSource(input)
  return src === 'env' || src === 'default'
}

/**
 * Official 2.1.328 (#669) `tengu_graceful_pudding` (default `true`):
 * In `claude -p`, Agent SDK, Claude Desktop, and VS Code, when
 * `CLAUDE_CODE_FORK_SUBAGENT=0`, subagents wait for their own background
 * subagents by default before returning so results are not dropped.
 */
export function shouldSubagentWaitForOwnSubagents(input?: {
  env?: NodeJS.ProcessEnv
  isNonInteractive?: boolean
  entrypoint?: string
  gbValue?: boolean
}): boolean {
  const env = input?.env ?? process.env
  if (!isEnvDefinedFalsy(env.CLAUDE_CODE_FORK_SUBAGENT)) {
    return false
  }
  const entrypoint = input?.entrypoint ?? env.CLAUDE_CODE_ENTRYPOINT ?? ''
  const isHostNonInteractiveOrIde =
    input?.isNonInteractive === true ||
    entrypoint === 'sdk-cli' ||
    entrypoint === 'sdk-ts' ||
    entrypoint === 'sdk-py' ||
    entrypoint === 'claude-vscode' ||
    entrypoint === 'claude-desktop' ||
    entrypoint === 'desktop'
  if (!isHostNonInteractiveOrIde) {
    return false
  }
  if (input?.gbValue !== undefined) {
    return input.gbValue
  }
  try {
    const { getFeatureValue_CACHED_MAY_BE_STALE } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../services/analytics/growthbook.js') as typeof import('../services/analytics/growthbook.js')
    return getFeatureValue_CACHED_MAY_BE_STALE('tengu_graceful_pudding', true)
  } catch {
    return true
  }
}
