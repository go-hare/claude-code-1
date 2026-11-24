import { feature } from 'bun:bundle'
import type { QuerySource } from '../../constants/querySource.js'
import { clearSystemPromptSections } from '../../constants/systemPromptSections.js'
import {
  getUserContext,
  prefetchGitStatusForCompaction,
} from '../../context.js'
import { clearSpeculativeChecks } from '@claude-code/builtin-tools/tools/BashTool/bashPermissions.js'
import { resetSentSkillNames } from '../../utils/attachments.js'
import { clearClassifierApprovals } from '../../utils/classifierApprovals.js'
import { resetGetMemoryFilesCache } from '../../utils/claudemd.js'
import { logError } from '../../utils/log.js'
import { clearSessionMessagesCache } from '../../utils/sessionStorage.js'
import { clearBetaTracingState } from '../../utils/telemetry/betaSessionTracing.js'
import { resetMicrocompactState } from './microCompact.js'

/**
 * Compact-scoped cleanup callbacks registered by REPL or other long-lived
 * components. Called during runPostCompactCleanup() so instance-scoped state
 * (e.g. contentReplacementState) is freed alongside module-level caches.
 */
const compactCleanupCallbacks: Array<() => void> = []

export function registerCompactCleanup(callback: () => void): void {
  compactCleanupCallbacks.push(callback)
}

/**
 * Run cleanup of caches and tracking state after compaction.
 * Call this after both auto-compact and manual /compact to free memory
 * held by tracking structures that are invalidated by compaction.
 *
 * Note: We intentionally do NOT clear invoked skill content here.
 * Skill content must survive across multiple compactions so that
 * createSkillAttachmentIfNeeded() can include the full skill text
 * in subsequent compaction attachments.
 *
 * querySource: pass the compacting query's source so we can skip
 * resets that would clobber main-thread module-level state. Subagents
 * (agent:*) run in the same process and share module-level state
 * (context-collapse store, getMemoryFiles one-shot hook flag,
 * getUserContext cache); resetting those when a SUBAGENT compacts
 * would corrupt the MAIN thread's state. All compaction callers should
 * pass querySource — undefined is only safe for callers that are
 * genuinely main-thread-only (/compact, /clear).
 */
export function runPostCompactCleanup(querySource?: QuerySource): void {
  // Subagents (agent:*) run in the same process and share module-level
  // state with the main thread. Only reset main-thread module-level state
  // (context-collapse, memory file cache) for main-thread compacts.
  // Same startsWith pattern as isMainThread (index.ts:188).
  const isMainThreadCompact =
    querySource === undefined ||
    querySource.startsWith('repl_main_thread') ||
    querySource === 'sdk'

  resetMicrocompactState()
  if (feature('CONTEXT_COLLAPSE')) {
    if (isMainThreadCompact) {
      /* eslint-disable @typescript-eslint/no-require-imports */
      ;(
        require('../contextCollapse/index.js') as typeof import('../contextCollapse/index.js')
      ).resetContextCollapse()
      /* eslint-enable @typescript-eslint/no-require-imports */
    }
  }
  if (isMainThreadCompact) {
    // getUserContext is a memoized outer layer wrapping getClaudeMds() →
    // getMemoryFiles(). If only the inner getMemoryFiles cache is cleared,
    // the next turn hits the getUserContext cache and never reaches
    // getMemoryFiles(), so the armed InstructionsLoaded hook never fires.
    // Manual /compact already clears this explicitly at its call sites;
    // auto-compact and reactive-compact did not — this centralizes the
    // clear so all compaction paths behave consistently.
    getUserContext.cache.clear?.()
    resetGetMemoryFilesCache('compact')
    // Official 2.1.326 (#245): refresh git status asynchronously in the
    // background so the first message after /compact does not block re-running
    // `git status` cold.
    prefetchGitStatusForCompaction()
  }
  clearSystemPromptSections()
  // densable: stickyBetas reset in clearBetaHeaderLatches — re-eval o3 memo.
  if (isMainThreadCompact) {
    void import('../../utils/betas.js').then(({ clearBetasCaches }) =>
      clearBetasCaches(),
    )
  }
  clearClassifierApprovals()
  clearSpeculativeChecks()
  // 2.1.304 #1016: reset sentSkillNames so skill_listing is re-sent post-compact.
  resetSentSkillNames()
  clearBetaTracingState()
  clearSessionMessagesCache()
  for (const cb of compactCleanupCallbacks) {
    try {
      cb()
    } catch (error) {
      logError(error)
    }
  }
}
