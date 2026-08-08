/**
 * densable 2.1.218 #22 — QEt: apply main-thread agent frontmatter hooks only
 * when origin workspace trust passes (mvo) and hooks policy allows.
 *
 * densable:
 *   function QEt(e){
 *     if(!e||!gvo(e.hooks)){b1r(void 0);return}
 *     let t=!VR("hooks")||J0e(e.source), r=mvo(e);
 *     if(t&&r){b1r(e.hooks);return}
 *     if(t&&!r)hvo(e,"mainThread");
 *     b1r(void 0)
 *   }
 */
import { setMainThreadAgentHooks } from '../../bootstrap/state.js'
import type { HooksSettings } from '../settings/types.js'
import {
  isRestrictedToPluginOnly,
  isSourceAdminTrusted,
} from '../settings/pluginOnlyPolicy.js'
import {
  isAgentHooksOriginTrusted,
  logAgentHooksOriginUntrusted,
  type AgentHooksOrigin,
} from './agentHooksOriginTrust.js'

export type MainThreadAgentForHooks = AgentHooksOrigin & {
  hooks?: HooksSettings
}

/** densable gvo — any event has at least one non-empty hooks array. */
export function hasNonEmptyAgentHooks(
  hooks: HooksSettings | undefined | null,
): boolean {
  if (!hooks || typeof hooks !== 'object') return false
  for (const value of Object.values(hooks)) {
    if (!Array.isArray(value) || value.length === 0) continue
    for (const matcher of value) {
      const list =
        matcher && typeof matcher === 'object' && 'hooks' in matcher
          ? (matcher as { hooks?: unknown[] }).hooks
          : undefined
      if (Array.isArray(list) && list.length > 0) return true
    }
  }
  return false
}

/**
 * densable QEt — store trusted main-thread agent hooks (or clear).
 * Call when resolving --agent / resume mainThreadAgentDefinition.
 */
export function applyMainThreadAgentHooks(
  agent: MainThreadAgentForHooks | undefined | null,
): void {
  if (!agent || !hasNonEmptyAgentHooks(agent.hooks)) {
    setMainThreadAgentHooks(undefined)
    return
  }
  // densable: !VR("hooks") || J0e(source) — policy allows this agent's hooks
  const hooksAllowed =
    !isRestrictedToPluginOnly('hooks') || isSourceAdminTrusted(agent.source)
  const originTrusted = isAgentHooksOriginTrusted(agent)
  if (hooksAllowed && originTrusted) {
    setMainThreadAgentHooks(agent.hooks)
    return
  }
  if (hooksAllowed && !originTrusted) {
    logAgentHooksOriginUntrusted(agent, 'mainThread')
  }
  setMainThreadAgentHooks(undefined)
}
