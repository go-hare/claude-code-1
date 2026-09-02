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
 * (`forkSubagentEnabledSource`). Coordinator / non-interactive still
 * applied in AgentTool `isForkSubagentEnabled()`.
 */

import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'

export type ForkSubagentSource = 'env' | 'default' | 'disabled' | 'disabled_ant'

/**
 * densable UL().forkSubagentEnabledSource — process/session sticky.
 * Only the live (no-input) path writes/reads it. Explicit `{env,isAnt}`
 * injection is Drb-only so tests do not pin the session.
 */
let forkSubagentEnabledSource: ForkSubagentSource | undefined

/** Test helper — gold new UL() drops the sticky. */
export function resetForkSubagentSessionSource(): void {
  forkSubagentEnabledSource = undefined
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
  const env = input?.env ?? process.env
  // densable FDd: CLAUDE_CODE_FORK_SUBAGENT===false → "disabled" (before sticky)
  if (isEnvDefinedFalsy(env.CLAUDE_CODE_FORK_SUBAGENT)) return 'disabled'
  const useSticky = input?.env === undefined && input?.isAnt === undefined
  if (useSticky && forkSubagentEnabledSource !== undefined) {
    return forkSubagentEnabledSource
  }
  const resolved = resolveForkSubagentDrb(input)
  if (useSticky && resolved !== 'disabled' && resolved !== 'disabled_ant') {
    forkSubagentEnabledSource = resolved
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
