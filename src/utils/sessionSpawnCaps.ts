/**
 * densable 2.1.212 session runaway guards — taskRegistry counter subset.
 *
 * densable: Etu/vtu + taskRegistry
 *   increment/get/reset × (TotalAgentSpawns, WebSearchCalls)
 * defaults qpg=200 / zpg=200
 *
 * Local product: session-scoped module counters (single CLI process = session).
 * /clear calls reset*; WebSearchTool + AgentTool call get/increment.
 */

/** densable qpg / zpg */
export const DEFAULT_MAX_SUBAGENTS_PER_SESSION = 200
export const DEFAULT_MAX_WEB_SEARCHES_PER_SESSION = 200

let totalAgentSpawns = 0
let webSearchCalls = 0

/** densable Etu — CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION ?? 200 */
export function resolveMaxSubagentsPerSession(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return parseSessionCap(
    env.CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION,
    DEFAULT_MAX_SUBAGENTS_PER_SESSION,
  )
}

/** densable vtu — CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION ?? 200 */
export function resolveMaxWebSearchesPerSession(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return parseSessionCap(
    env.CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION,
    DEFAULT_MAX_WEB_SEARCHES_PER_SESSION,
  )
}

function parseSessionCap(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.floor(n)
}

// --- densable taskRegistry counter API ---

export function getTotalAgentSpawns(): number {
  return totalAgentSpawns
}

export function incrementTotalAgentSpawns(): number {
  totalAgentSpawns += 1
  return totalAgentSpawns
}

export function resetTotalAgentSpawns(): void {
  totalAgentSpawns = 0
}

export function getWebSearchCalls(): number {
  return webSearchCalls
}

export function incrementWebSearchCalls(): number {
  webSearchCalls += 1
  return webSearchCalls
}

export function resetWebSearchCalls(): void {
  webSearchCalls = 0
}

/** densable /clear — both budgets */
export function resetSessionSpawnCaps(): void {
  resetTotalAgentSpawns()
  resetWebSearchCalls()
}

/**
 * densable AgentTool N(): abort → throw AbortError-like; at cap → throw message;
 * else increment. Returns null when allowed (caller continues).
 */
export function assertCanSpawnSubagent(options?: {
  abortSignal?: AbortSignal
  env?: NodeJS.ProcessEnv
}): void {
  if (options?.abortSignal?.aborted) {
    const err = new Error('Aborted')
    err.name = 'AbortError'
    throw err
  }
  const max = resolveMaxSubagentsPerSession(options?.env)
  const used = getTotalAgentSpawns()
  if (used >= max) {
    throw new Error(
      `Subagent spawn limit reached (${used} of ${max} agents spawned). Complete the remaining work directly with your tools instead of spawning more agents. If more agents are genuinely needed, ask the user to raise CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION.`,
    )
  }
  incrementTotalAgentSpawns()
}

/** densable WebSearch soft budget message body (results[0] string). */
export function formatWebSearchSessionCapMessage(
  used: number,
  max: number,
): string {
  return `Web search was not performed: this session has used its web search budget (${used} of ${max} WebSearch calls). Continue with the information already gathered instead of issuing more searches. If more searches are genuinely needed, ask the user to raise CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION.`
}

/**
 * densable WebSearch preflight: if at cap, return soft-fail payload fields;
 * else increment and return null (caller proceeds).
 */
export function consumeWebSearchBudgetOrCapMessage(options?: {
  env?: NodeJS.ProcessEnv
}): { capped: true; used: number; max: number; message: string } | null {
  const max = resolveMaxWebSearchesPerSession(options?.env)
  const used = getWebSearchCalls()
  if (used >= max) {
    return {
      capped: true,
      used,
      max,
      message: formatWebSearchSessionCapMessage(used, max),
    }
  }
  incrementWebSearchCalls()
  return null
}
