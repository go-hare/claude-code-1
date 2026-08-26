import { getClaudeAIOAuthTokens } from './auth.js'
import { getCurrentProjectConfig, getGlobalConfig } from './config.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { findGitRoot } from './git.js'
import { hasWorktreeCreateHook } from './hooks.js'
import { getAPIProvider } from './model/providers.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'

/** Official `Iq` — keep local to avoid src ↔ builtin-tools cycles. */
function isBuiltInWebFetchAgent(agent: {
  source?: string
  agentType: string
}): boolean {
  return agent.source === 'built-in' && agent.agentType === 'web-fetch'
}

export type AgentIsolationMode = 'worktree' | 'remote'

/**
 * Official `Tno`.
 * firstParty + OAuth accessToken + prior remote session/env + GB
 * `tengu_neapolitan`. Off inside CLAUDE_CODE_REMOTE.
 */
export function isRemoteIsolationAvailable(): boolean {
  if (getAPIProvider() !== 'firstParty') {
    return false
  }
  // Official Tno: raw `V.CLAUDE_CODE_REMOTE`, not isEnvTruthy.
  if (process.env.CLAUDE_CODE_REMOTE) {
    return false
  }
  if (getClaudeAIOAuthTokens()?.accessToken == null) {
    return false
  }
  if (
    !getCurrentProjectConfig().hasUsedRemoteSession ||
    !getGlobalConfig().hasRemoteEnvironment
  ) {
    return false
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_neapolitan', false)
}

/**
 * Official `mSl` — worktree isolation is usable with a WorktreeCreate hook
 * or a git root.
 */
export function canUseWorktreeIsolation(): boolean {
  return hasWorktreeCreateHook() || findGitRoot(getCwd()) !== null
}

/** Official `Gji`. */
export function assertWorktreeIsolationAvailable(): void {
  if (canUseWorktreeIsolation()) {
    return
  }
  logEvent('tengu_feature_bad', {
    feature_name:
      'git_worktree_create' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    error_code:
      'git_worktree_create_not_git_repo' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  throw new Error(
    'Cannot create agent worktree: not in a git repository and no WorktreeCreate hooks are configured. Configure WorktreeCreate/WorktreeRemove hooks in settings.json to use worktree isolation with other VCS systems.',
  )
}

/**
 * Official isolation resolve after agent pick:
 * Gji → web-fetch ignore (`Iq`) → `Tno` remote fallback.
 */
export function resolveEffectiveIsolation(
  inputIsolation: AgentIsolationMode | undefined,
  agent: { source?: string; agentType: string; isolation?: AgentIsolationMode },
): AgentIsolationMode | undefined {
  const requested = inputIsolation ?? agent.isolation
  if (
    requested === 'worktree' &&
    !isBuiltInWebFetchAgent(agent) &&
    !canUseWorktreeIsolation()
  ) {
    assertWorktreeIsolationAvailable()
  }

  let resolved = requested
  if (resolved && isBuiltInWebFetchAgent(agent)) {
    logForDebugging(
      `[web-fetch agent] isolation:'${resolved}' ignored; the built-in web-fetch agent always runs as a local agent`,
    )
    resolved = undefined
  }

  if (resolved === 'remote' && !isRemoteIsolationAvailable()) {
    resolved =
      process.env.CLAUDE_CODE_REMOTE || !canUseWorktreeIsolation()
        ? undefined
        : 'worktree'
    logForDebugging(
      "[remote agent] isolation:'remote' is unavailable " +
        (process.env.CLAUDE_CODE_REMOTE
          ? '(already inside a CCR session); running as a local agent'
          : resolved === 'worktree'
            ? "(no claude.ai login or feature gate off); falling back to isolation:'worktree'"
            : '(no claude.ai login or feature gate off) and no git root; running as a local agent'),
    )
  }

  return resolved
}
