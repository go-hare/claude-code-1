/**
 * Official Bro / GMg / NNu / WMg / jMg portable subset — emit
 * post_turn_summary on requires_action so CCR/sidebar hosts can show blocked
 * status without scanning the event stream, and heuristic completed summaries
 * on idle (portable densable of completed-turn emit without LLM).
 *
 * Full official path also has LLM summary generation for completed turns
 * (tengu_classifier_summary_* flags). Portable: blocked-permission heuristic
 * payload + completed heuristic + GB/env mode resolution + default Haiku LLM
 * host densable (ensureCompletedClassifierLlmHost).
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { isEnvTruthy } from '../envUtils.js'
import type { RequiresActionDetails } from '../sessionState.js'

export type ClassifierSummaryMode = 'llm' | 'heuristic'

export type PostTurnSummaryPayload = {
  status_category:
    | 'blocked'
    | 'review_ready'
    | 'completed'
    | 'failed'
    | 'waiting'
  status_detail: string
  needs_action: string
}

/** Official LNu surface → capability map (subset). */
const SURFACE_CAPS: Record<string, ReadonlyArray<'state' | 'summary'>> = {
  bg: ['state'],
  watched: ['state'],
  ccr: ['summary'],
  bridge: ['summary'],
  desktop: ['summary'],
  cli: ['summary'],
  remote: ['summary'],
  remote_cowork: ['summary'],
  remote_desktop: ['summary'],
  remote_mobile: ['summary'],
}

/**
 * Official $ro — active classifier surfaces from entrypoint / client type.
 * Portable: derive from CLAUDE_CODE_ENTRYPOINT (+ optional explicit list).
 * Official also folds bg/watched/ccr/bridge/desktop via runtime probes; FNu()
 * (cli auto-add) is hard-false in 2.1.207 — we still map entrypoint=cli.
 */
export function resolveClassifierSurfaces(
  entrypoint: string | undefined = process.env.CLAUDE_CODE_ENTRYPOINT,
): Set<string> {
  const out = new Set<string>()
  const ep = (entrypoint ?? 'cli').toLowerCase()
  if (ep in SURFACE_CAPS) out.add(ep)
  else if (ep.startsWith('remote')) out.add(ep)
  else out.add('cli')
  // Explicit multi-surface override: CLAUDE_CODE_CLASSIFIER_SURFACES=ccr,bridge
  const extra = process.env.CLAUDE_CODE_CLASSIFIER_SURFACES
  if (extra) {
    for (const part of extra.split(',')) {
      const s = part.trim()
      if (s && s in SURFACE_CAPS) out.add(s)
    }
  }
  return out
}

/**
 * Official MNu / qMg — union of caps for active surfaces (minus disabled).
 * Disabled via CLAUDE_CODE_CLASSIFIER_DISABLED_SURFACES or GB
 * tengu_classifier_disabled_surfaces; kill via env or tengu_classifier_summary_kill.
 */
export function resolveClassifierCaps(
  surfaces: Set<string> = resolveClassifierSurfaces(),
  env: NodeJS.ProcessEnv = process.env,
): Set<'state' | 'summary'> {
  const caps = new Set<'state' | 'summary'>()
  const disabledEnv = (
    env.CLAUDE_CODE_CLASSIFIER_DISABLED_SURFACES ??
    // Official GB string of comma surfaces; empty default
    String(
      getFeatureValue_CACHED_MAY_BE_STALE(
        'tengu_classifier_disabled_surfaces',
        '',
      ) ?? '',
    )
  )
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  const disabled = new Set(disabledEnv)
  for (const s of surfaces) {
    if (disabled.has(s)) continue
    for (const c of SURFACE_CAPS[s] ?? []) caps.add(c)
  }
  // Official: bg surface drops summary even if other surfaces add it
  if (surfaces.has('bg')) caps.delete('summary')
  if (
    isEnvTruthy(env.CLAUDE_CODE_CLASSIFIER_SUMMARY_KILL) ||
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_classifier_summary_kill', false)
  ) {
    caps.delete('summary')
  }
  return caps
}

/**
 * Official jMg — GB fallback when env CLAUDE_CODE_CLASSIFIER_SUMMARY unset.
 */
export function resolveClassifierSummaryModeFromGrowthBook(): ClassifierSummaryMode | null {
  if (
    getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_classifier_summary_llm_emit',
      false,
    )
  ) {
    return 'llm'
  }
  if (
    getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_classifier_summary_heuristic_emit',
      false,
    )
  ) {
    return 'heuristic'
  }
  return null
}

/**
 * Official NNu — summary emit mode.
 * - caps empty → null
 * - has "state" (bg/watched) → "llm" (not used for blocked heuristic emit)
 * - CLAUDE_CODE_CLASSIFIER_SUMMARY set: truthy → llm, else heuristic
 * - else jMg GB flags
 * - tengu_cobalt_wren forces llm → heuristic (kill switch)
 * Portable default: when caps has summary and jMg null, enable heuristic so
 * requires_action blocked payloads reach host UIs without GB enrollment.
 */
export function resolveClassifierSummaryMode(
  caps: Set<'state' | 'summary'> = resolveClassifierCaps(),
  env: NodeJS.ProcessEnv = process.env,
): ClassifierSummaryMode | null {
  if (caps.size === 0) return null
  // Official: state cap alone selects llm (bg path)
  let mode: ClassifierSummaryMode | null
  if (caps.has('state') && !caps.has('summary')) {
    mode = 'llm'
  } else if (env.CLAUDE_CODE_CLASSIFIER_SUMMARY !== undefined) {
    mode = isEnvTruthy(env.CLAUDE_CODE_CLASSIFIER_SUMMARY) ? 'llm' : 'heuristic'
  } else {
    mode = resolveClassifierSummaryModeFromGrowthBook()
    // Portable default for summary-capable surfaces without GB
    if (mode === null && caps.has('summary')) mode = 'heuristic'
  }
  // Official tengu_cobalt_wren: demote llm → heuristic
  if (
    mode === 'llm' &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_wren', false)
  ) {
    return 'heuristic'
  }
  return mode
}

/** Official WMg — generic post_turn_summary payload builder. */
export function buildPostTurnSummary(input: {
  state:
    | 'blocked'
    | 'review_ready'
    | 'completed'
    | 'failed'
    | 'waiting'
    | string
  detail: string
  needs?: string | null
}): PostTurnSummaryPayload {
  const category: PostTurnSummaryPayload['status_category'] =
    input.state === 'blocked'
      ? 'blocked'
      : input.state === 'completed'
        ? 'completed'
        : input.state === 'failed'
          ? 'failed'
          : input.state === 'waiting'
            ? 'waiting'
            : 'review_ready'
  const needsAction =
    category === 'blocked' || category === 'waiting' ? (input.needs ?? '') : ''
  return {
    status_category: category,
    status_detail: input.detail,
    needs_action: needsAction,
  }
}

/** Official WMg / GMg blocked branch — pure payload builder. */
export function buildBlockedPostTurnSummary(
  details: RequiresActionDetails,
): PostTurnSummaryPayload {
  if (details.tool_name.startsWith('dialog:')) {
    return buildPostTurnSummary({
      state: 'blocked',
      detail: 'Waiting on a user dialog',
      needs: details.action_description,
    })
  }
  return buildPostTurnSummary({
    state: 'blocked',
    detail: `Waiting on permission: ${details.tool_name}`,
    needs: `Approve or deny ${details.tool_name}`,
  })
}

/**
 * Official GMg gate — whether to emit post_turn_summary for this blocked
 * requires_action transition.
 */
export function shouldEmitBlockedClassifierSummary(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const caps = resolveClassifierCaps(
    resolveClassifierSurfaces(env.CLAUDE_CODE_ENTRYPOINT),
    env,
  )
  if (!caps.has('summary')) return false
  const mode = resolveClassifierSummaryMode(caps, env)
  // llm/heuristic both get the blocked heuristic payload for permission waits
  return mode !== null
}

/**
 * Official completed-turn heuristic densable — pure payload when LLM emit is
 * unavailable. Prefer last assistant text snippet; fall back to tool/turn stats.
 */
export function buildCompletedPostTurnSummary(input?: {
  /** Last assistant text (truncated by caller or here). */
  assistantText?: string | null
  toolUseCount?: number
  /** Optional outcome label (e.g. success / error). */
  outcome?: 'success' | 'error' | string | null
}): PostTurnSummaryPayload {
  const text = (input?.assistantText ?? '').trim().replace(/\s+/g, ' ')
  const snippet =
    text.length > 0
      ? text.length > 160
        ? `${text.slice(0, 157)}...`
        : text
      : undefined
  const tools = input?.toolUseCount ?? 0
  const outcome = input?.outcome ?? 'success'
  const failed = outcome === 'error' || outcome === 'failed'
  const detail =
    snippet ??
    (tools > 0
      ? `Turn completed after ${tools} tool use${tools === 1 ? '' : 's'}`
      : 'Turn completed')
  return buildPostTurnSummary({
    state: failed ? 'failed' : 'completed',
    detail,
  })
}

/**
 * Official LLM completed-turn classifier host densable.
 * When mode is `llm`, hosts may inject a generator that returns a short
 * status_detail / needs_action. Without a host, callers fall back to heuristic.
 */
export type CompletedClassifierLlmInput = {
  assistantText?: string | null
  toolUseCount?: number
  outcome?: 'success' | 'error' | string | null
  /** Optional transcript / tool names for denser hosts. */
  context?: string | null
}

export type CompletedClassifierLlmHost = {
  generate: (
    input: CompletedClassifierLlmInput,
  ) => Promise<Partial<PostTurnSummaryPayload> | null | undefined>
}

let completedClassifierLlmHost: CompletedClassifierLlmHost | null = null
let defaultCompletedClassifierLlmHostInstalled = false

const COMPLETED_CLASSIFIER_SYSTEM_PROMPT = `Write a short one-line status for a coding agent turn that just finished. It is shown in a sidebar / status bar.

Rules:
- Past tense, ≤ 120 characters
- Lead with the outcome verb (Fixed, Added, Investigated, Failed, …)
- No quotes, no trailing period unless needed
- If the turn failed, say so plainly`

/**
 * Official default completed-turn LLM densable host (Haiku).
 * Injectable `generate` for tests; production uses queryHaiku via lazy require.
 */
export function createDefaultCompletedClassifierLlmHost(opts?: {
  generate?: CompletedClassifierLlmHost['generate']
  signal?: AbortSignal
  isNonInteractiveSession?: boolean
}): CompletedClassifierLlmHost {
  if (opts?.generate) {
    return { generate: opts.generate }
  }
  return {
    generate: async input => {
      const outcome = input.outcome ?? 'success'
      const failed = outcome === 'error' || outcome === 'failed'
      const text = (input.assistantText ?? '').trim().replace(/\s+/g, ' ')
      const context = (input.context ?? '').trim().replace(/\s+/g, ' ')
      const tools = input.toolUseCount ?? 0
      const userPrompt = [
        `Outcome: ${failed ? 'failed' : 'success'}`,
        tools > 0 ? `Tool uses: ${tools}` : null,
        text ? `Last assistant text: ${text.slice(0, 400)}` : null,
        context ? `Context: ${context.slice(0, 400)}` : null,
        'Status label:',
      ]
        .filter(Boolean)
        .join('\n')

      // Lazy require avoids bootstrap cycles (classifierSummary ↔ api/claude).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { queryHaiku } =
        require('../../services/api/claude.js') as typeof import('../../services/api/claude.js')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { asSystemPrompt } =
        require('../systemPromptType.js') as typeof import('../systemPromptType.js')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getIsNonInteractiveSession } =
        require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')

      const signal = opts?.signal ?? AbortSignal.timeout(8_000)
      const response = await queryHaiku({
        systemPrompt: asSystemPrompt([COMPLETED_CLASSIFIER_SYSTEM_PROMPT]),
        userPrompt,
        signal,
        options: {
          querySource: 'classifier_completed_summary',
          enablePromptCaching: true,
          agents: [],
          isNonInteractiveSession:
            opts?.isNonInteractiveSession ?? getIsNonInteractiveSession(),
          hasAppendSystemPrompt: false,
          mcpTools: [],
        },
      })
      const summary = (
        Array.isArray(response.message.content) ? response.message.content : []
      )
        .filter(block => block.type === 'text')
        .map(block => (block.type === 'text' ? block.text : ''))
        .join('')
        .trim()
        .replace(/\s+/g, ' ')
      if (!summary) return null
      const detail =
        summary.length > 160 ? `${summary.slice(0, 157)}...` : summary
      return {
        status_category: failed ? 'failed' : 'completed',
        status_detail: detail,
        needs_action: '',
      }
    },
  }
}

/**
 * Official install densable — install default Haiku host once when mode is llm
 * and no host is wired. Safe to call repeatedly; no-op when mode is not llm.
 */
export function ensureCompletedClassifierLlmHost(
  env: NodeJS.ProcessEnv = process.env,
): CompletedClassifierLlmHost | null {
  if (completedClassifierLlmHost) return completedClassifierLlmHost
  const mode = resolveClassifierSummaryMode(
    resolveClassifierCaps(
      resolveClassifierSurfaces(env.CLAUDE_CODE_ENTRYPOINT),
      env,
    ),
    env,
  )
  if (mode !== 'llm') return null
  if (!defaultCompletedClassifierLlmHostInstalled) {
    completedClassifierLlmHost = createDefaultCompletedClassifierLlmHost()
    defaultCompletedClassifierLlmHostInstalled = true
  }
  return completedClassifierLlmHost
}

export function setCompletedClassifierLlmHost(
  host: CompletedClassifierLlmHost | null,
): void {
  completedClassifierLlmHost = host
  // Explicit host (incl. null) wins over auto-install for this process.
  defaultCompletedClassifierLlmHostInstalled = host !== null
}

export function getCompletedClassifierLlmHost(): CompletedClassifierLlmHost | null {
  return completedClassifierLlmHost
}

export function resetCompletedClassifierLlmHostForTests(): void {
  completedClassifierLlmHost = null
  defaultCompletedClassifierLlmHostInstalled = false
}

/**
 * Official completed-turn LLM densable — try host when mode is llm, else
 * heuristic. Host failures / null fall back to heuristic (never throws).
 */
export async function buildCompletedPostTurnSummaryWithHost(
  input?: CompletedClassifierLlmInput,
  opts?: {
    env?: NodeJS.ProcessEnv
    host?: CompletedClassifierLlmHost | null
  },
): Promise<PostTurnSummaryPayload> {
  const env = opts?.env ?? process.env
  const mode = resolveClassifierSummaryMode(
    resolveClassifierCaps(
      resolveClassifierSurfaces(env.CLAUDE_CODE_ENTRYPOINT),
      env,
    ),
    env,
  )
  const host = opts?.host !== undefined ? opts.host : completedClassifierLlmHost
  if (mode === 'llm' && host) {
    try {
      const llm = await host.generate({
        assistantText: input?.assistantText,
        toolUseCount: input?.toolUseCount,
        outcome: input?.outcome,
        context: input?.context,
      })
      if (llm && typeof llm.status_detail === 'string' && llm.status_detail) {
        const outcome = input?.outcome ?? 'success'
        const failed = outcome === 'error' || outcome === 'failed'
        return {
          status_category:
            llm.status_category ?? (failed ? 'failed' : 'completed'),
          status_detail: llm.status_detail,
          needs_action:
            typeof llm.needs_action === 'string' ? llm.needs_action : '',
        }
      }
    } catch {
      // fall through to heuristic
    }
  }
  return buildCompletedPostTurnSummary(input)
}

/**
 * Official completed-turn emit gate densable.
 * - requires summary cap
 * - heuristic mode always eligible
 * - llm mode also gets heuristic fallback when no denser LLM host is wired
 *   (same portable default as blocked path)
 */
export function shouldEmitCompletedClassifierSummary(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const caps = resolveClassifierCaps(
    resolveClassifierSurfaces(env.CLAUDE_CODE_ENTRYPOINT),
    env,
  )
  if (!caps.has('summary')) return false
  return resolveClassifierSummaryMode(caps, env) !== null
}
