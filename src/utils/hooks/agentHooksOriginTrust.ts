/**
 * densable 2.1.218 #22 — agent frontmatter hooks require origin workspace trust.
 *
 * densable symbols:
 * - mvo(e) → isAgentHooksOriginTrusted
 * - psd(e) → resolveAgentHooksTrustRoot (unwrap .claude/agents → project root)
 * - AI_(e) → resolveAgentHooksTrustKeyPath
 * - hvo(e,t) → logAgentHooksOriginUntrusted
 * - tdr(path) ≈ isPathTrusted(path) (persisted hasTrustDialogAccepted walk)
 * - iB() ≈ checkHasTrustDialogAccepted() when no baseDir
 */
import { basename, dirname, join } from 'path'
import { homedir } from 'os'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { checkHasTrustDialogAccepted, isPathTrusted } from '../config.js'
import { getCwd } from '../cwd.js'
import { logForDebugging } from '../debug.js'
import { isSourceAdminTrusted } from '../settings/pluginOnlyPolicy.js'

export type AgentHooksOrigin = {
  agentType: string
  source?: string
  baseDir?: string
  fromAdditionalDirectory?: boolean
}

/**
 * densable psd: if baseDir ends with `.claude/agents`, trust the project root
 * (parent of `.claude`); otherwise trust baseDir itself.
 */
export function resolveAgentHooksTrustRoot(baseDir: string): string {
  const parent = dirname(baseDir)
  if (basename(baseDir) === 'agents' && basename(parent) === '.claude') {
    return dirname(parent)
  }
  return baseDir
}

/**
 * densable mvo(e): may we register frontmatter hooks for this agent definition?
 * Admin-trusted / userSettings / flagSettings always pass. Otherwise the
 * definition's origin folder (or cwd when baseDir missing) must have accepted
 * the trust dialog.
 */
export function isAgentHooksOriginTrusted(agent: AgentHooksOrigin): boolean {
  if (isSourceAdminTrusted(agent.source)) return true
  // densable: userSettings / flagSettings always trusted for hook registration
  if (agent.source === 'userSettings' || agent.source === 'flagSettings') {
    return true
  }
  if (!agent.baseDir || agent.baseDir === 'built-in') {
    // densable iB() — current workspace trust
    return checkHasTrustDialogAccepted()
  }
  // densable tdr(psd(baseDir))
  return isPathTrusted(resolveAgentHooksTrustRoot(agent.baseDir))
}

/**
 * densable hvo — log + telemetry when frontmatter hooks are skipped for origin.
 */
export function logAgentHooksOriginUntrusted(
  agent: AgentHooksOrigin,
  surface: 'subagent' | 'mainThread',
): void {
  const trustKey =
    agent.baseDir && agent.baseDir !== 'built-in'
      ? resolveAgentHooksTrustRoot(agent.baseDir)
      : getCwd()
  const surfaceLabel = surface === 'mainThread' ? 'main-thread agent' : 'agent'
  const name = agent.agentType
  const configPath = join(homedir(), '.claude.json')

  logForDebugging(
    `Skipping frontmatter hooks for ${surfaceLabel} '${name}': the folder its definition file came from is not trusted (source: ${agent.source ?? 'unknown'}, trust key: ${trustKey}). Run Claude Code there once and accept the trust dialog, or set projects[${trustKey}].hasTrustDialogAccepted: true in ${configPath}.`,
    { level: 'error' },
  )
  logEvent('tengu_agent_hooks_origin_untrusted', {
    source: (agent.source ??
      'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    surface:
      surface as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    fromAdditionalDirectory: (agent.fromAdditionalDirectory === true
      ? 'true'
      : 'false') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}
