/**
 * densable 2.1.229 #24 — workflow same-prefix prompt-cache warm-up stagger.
 *
 * SEA: class FZp / g_S / y_S / BZp / $Zp
 * - m_S = 5000 (default cap when env unset)
 * - h_S = 270000 (warm TTL after first response)
 * - enter(prefix, {capMs, signal}) holds followers until leader responds or cap
 * - responded() marks prefix warm for h_S; done() drops leader if never responded
 *
 * Env: CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS (cap; DISABLE_PROMPT_CACHING → 0).
 */

import { sleep } from '../utils/sleep.js'
import { isEnvTruthy } from '../utils/envUtils.js'
import { logForDebugging } from '../utils/debug.js'

/** densable m_S */
export const WORKFLOW_PREFIX_STAGGER_DEFAULT_MS = 5000
/** densable h_S — warm window after first same-prefix response */
export const WORKFLOW_PREFIX_WARM_TTL_MS = 270_000

type WarmingEntry = {
  state: 'warming'
  ready: Promise<void>
  release: () => void
}

type WarmEntry = {
  state: 'warm'
  until: number
}

type PrefixEntry = WarmingEntry | WarmEntry

export type PrefixStaggerEnterResult = {
  /** True when this call created the warming leader for the prefix. */
  leader: boolean
  waitedMs: number
  /** densable responded() — mark warm after first real model response. */
  responded: () => void
  /** densable done() — drop leader if it never responded. */
  done: () => void
}

/** densable g_S */
function createWarmingEntry(): WarmingEntry {
  let release!: () => void
  const ready = new Promise<void>(resolve => {
    release = resolve
  })
  return { state: 'warming', ready, release }
}

/**
 * densable y_S — race ready with capMs sleep; abort resolves immediately.
 */
async function waitWithCap(
  ready: Promise<void>,
  capMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return
  const local = new AbortController()
  const onAbort = (): void => local.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    await Promise.race([ready, sleep(capMs, local.signal)])
  } finally {
    local.abort()
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * densable FZp — process-wide same-prefix stagger gate.
 */
export class WorkflowPrefixStagger {
  private readonly now: () => number
  private readonly entries = new Map<string, PrefixEntry>()

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  async enter(
    prefix: string,
    opts: { capMs: number; signal?: AbortSignal },
  ): Promise<PrefixStaggerEnterResult> {
    const t0 = this.now()
    // drop expired warm entries
    for (const [key, entry] of this.entries) {
      if (entry.state === 'warm' && entry.until <= t0) {
        this.entries.delete(key)
      }
    }

    const existing = this.entries.get(prefix)
    let leaderEntry: WarmingEntry | undefined
    let waitedMs = 0

    if (existing === undefined) {
      leaderEntry = createWarmingEntry()
      this.entries.set(prefix, leaderEntry)
    } else if (existing.state === 'warming' && opts.capMs > 0) {
      const waitStart = this.now()
      await waitWithCap(existing.ready, opts.capMs, opts.signal)
      waitedMs = Math.max(0, this.now() - waitStart)
    }

    let responded = false
    return {
      leader: leaderEntry !== undefined,
      waitedMs,
      responded: () => {
        responded = true
        this.markWarm(prefix)
      },
      done: () => {
        if (responded || leaderEntry === undefined) return
        if (
          this.entries.get(prefix) === leaderEntry &&
          leaderEntry.state === 'warming'
        ) {
          this.entries.delete(prefix)
          leaderEntry.release()
        }
      },
    }
  }

  stateOf(prefix: string): 'cold' | 'warming' | 'warm' {
    const entry = this.entries.get(prefix)
    if (entry === undefined) return 'cold'
    if (entry.state === 'warm') {
      return entry.until > this.now() ? 'warm' : 'cold'
    }
    return 'warming'
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      if (entry.state === 'warming') entry.release()
    }
    this.entries.clear()
  }

  /** densable markWarm */
  markWarm(prefix: string): void {
    const prev = this.entries.get(prefix)
    this.entries.set(prefix, {
      state: 'warm',
      until: this.now() + WORKFLOW_PREFIX_WARM_TTL_MS,
    })
    if (prev?.state === 'warming') prev.release()
  }
}

let singleton: WorkflowPrefixStagger | undefined

/** densable BZp */
export function getWorkflowPrefixStagger(): WorkflowPrefixStagger {
  return (singleton ??= new WorkflowPrefixStagger())
}

/** @internal tests */
export function resetWorkflowPrefixStaggerForTests(
  instance?: WorkflowPrefixStagger,
): void {
  singleton = instance
}

/** densable $Zp — env value or default 5000 */
export function resolveWorkflowPrefixStaggerCapMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (isEnvTruthy(env.DISABLE_PROMPT_CACHING)) return 0
  const raw = env.CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS
  if (raw === undefined || raw === '') return WORKFLOW_PREFIX_STAGGER_DEFAULT_MS
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return WORKFLOW_PREFIX_STAGGER_DEFAULT_MS
  return n
}

/**
 * densable Ze key — model, effort, agentType, tool names, schema, cwd.
 * Newline-joined so same-prefix siblings share prompt-cache warm-up.
 */
export function buildWorkflowPrefixKey(parts: {
  model?: string | null
  effort?: string | number | null
  agentType?: string | null
  toolNames?: readonly string[] | null
  schemaJson?: string | null
  cwd?: string | null
}): string {
  return [
    parts.model ?? '',
    String(parts.effort ?? ''),
    parts.agentType ?? '',
    (parts.toolNames ?? []).join(','),
    parts.schemaJson ?? '',
    parts.cwd ?? '',
  ].join('\n')
}

/**
 * Hold until same-prefix leader responds (or cap). Logs densable warm-up message.
 */
export async function enterWorkflowPrefixStagger(input: {
  prefix: string
  agentLabel?: string
  signal?: AbortSignal
  env?: NodeJS.ProcessEnv
}): Promise<PrefixStaggerEnterResult> {
  const capMs = resolveWorkflowPrefixStaggerCapMs(input.env)
  const gate = await getWorkflowPrefixStagger().enter(input.prefix, {
    capMs,
    signal: input.signal,
  })
  if (gate.waitedMs > 0) {
    const label = input.agentLabel ?? 'agent'
    logForDebugging(
      `workflow agent [${label}] held ${gate.waitedMs}ms for a same-prefix sibling's first response (prompt-cache warm-up)`,
    )
  }
  return gate
}
