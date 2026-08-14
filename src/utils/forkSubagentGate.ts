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
 * Local: env force/disable + ant disable + default ON. Coordinator /
 * non-interactive still applied in AgentTool `isForkSubagentEnabled()`.
 */

import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'

export type ForkSubagentSource = 'env' | 'default' | 'disabled' | 'disabled_ant'

/**
 * densable Drb + FDd env/ant/default arm (without session sticky / coordinator).
 * Coordinator and non-interactive gates stay in AgentTool.forkSubagent.ts.
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
  // densable: CLAUDE_CODE_FORK_SUBAGENT===true → "env"
  if (isEnvTruthy(env.CLAUDE_CODE_FORK_SUBAGENT)) return 'env'
  // densable: CLAUDE_CODE_FORK_SUBAGENT===false → "disabled" (FDd)
  if (isEnvDefinedFalsy(env.CLAUDE_CODE_FORK_SUBAGENT)) return 'disabled'
  // densable Nn() → disabled_ant
  if (input?.isAnt === true) return 'disabled_ant'
  if (
    input?.isAnt === undefined &&
    (env.USER_TYPE === 'ant' || process.env.USER_TYPE === 'ant')
  ) {
    return 'disabled_ant'
  }
  // densable Drb: return "default" (enabled)
  return 'default'
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
