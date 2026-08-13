// Engine-level constants. No runtime dependencies.

/**
 * Workflow tool name. PascalCase matches the system's other tools (Agent/Bash/CronCreate…),
 * otherwise the case-sensitive toolMatchesName would fail on the model's natural select:Workflow.
 */
export const WORKFLOW_TOOL_NAME = 'Workflow'

/** Directory for user-named workflow files (relative to project root). */
export const WORKFLOW_DIR_NAME = '.claude/workflows'

/** Persistence directory for workflow runs (journal + run records). */
export const WORKFLOW_RUNS_DIR = '.claude/workflow-runs'

/** Supported script extensions for named workflows (in priority order). */
export const WORKFLOW_SCRIPT_EXTENSIONS = ['.ts', '.js', '.mjs'] as const

/**
 * densable `__S(e)` — map host/container parallelism → default agent concurrency:
 *   Math.min(16, Math.max(2, e - 2))
 * densable 2.1.229 #17: use `os.availableParallelism()` (cgroup-aware on Linux),
 * not raw host `os.cpus().length`, so CPU-limited containers do not fan out
 * to the host core count.
 */
export function workflowDefaultConcurrencyFromParallelism(
  parallelism: number,
): number {
  const n = Number.isFinite(parallelism) ? Math.floor(parallelism) : 2
  return Math.min(16, Math.max(2, n - 2))
}

/**
 * densable `b_S = __S(os.availableParallelism())` at module init.
 * Falls back to 3 when the OS APIs are unavailable.
 */
export function resolveDefaultMaxConcurrency(
  availableParallelismFn?: () => number,
): number {
  try {
    if (availableParallelismFn) {
      return workflowDefaultConcurrencyFromParallelism(availableParallelismFn())
    }
    // Lazy require keeps constants free of hard os import for tree-shaking tests
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require('node:os') as typeof import('node:os')
    const n =
      typeof os.availableParallelism === 'function'
        ? os.availableParallelism()
        : os.cpus().length
    return workflowDefaultConcurrencyFromParallelism(n)
  } catch {
    return 3
  }
}

/**
 * Concurrency: default semaphore permits per workflow run.
 * densable pins at process start via availableParallelism (cgroup-aware).
 * A single run can override via Workflow tool maxConcurrency (still clamped by CAP).
 */
export const DEFAULT_MAX_CONCURRENCY = resolveDefaultMaxConcurrency()

/** Absolute cap on user-supplied maxConcurrency (anti-abuse). densable 16. */
export const MAX_CONCURRENCY_CAP = 16

/** Total cap on agent() calls within a single workflow lifecycle. */
export const MAX_TOTAL_AGENTS = 1000

/** Items cap per single parallel()/pipeline() call. */
export const MAX_ITEMS_PER_CALL = 4096
