/**
 * densable ScheduleWakeup prompt builders (SEA 2.1.221).
 *
 * Mirrors:
 *   EU_ — base tool prompt body
 *   FKu — EU_ + optional noop fold + cache-TTL delay guidance + reason field
 *   DUe — 1h prompt-cache eligibility (simplified for repl_main_thread / sdk)
 *   BKu — short description (constants)
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { isClaudeAISubscriber } from 'src/utils/auth.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { getAPIProvider } from 'src/utils/model/providers.js'
import { CRON_DELETE_TOOL_NAME } from '../ScheduleCronTool/prompt.js'
import {
  AUTONOMOUS_LOOP_DYNAMIC_SENTINEL,
  AUTONOMOUS_LOOP_SENTINEL,
  SCHEDULE_WAKEUP_DESCRIPTION,
  SCHEDULE_WAKEUP_TOOL_NAME,
} from './constants.js'

export {
  AUTONOMOUS_LOOP_DYNAMIC_SENTINEL,
  AUTONOMOUS_LOOP_SENTINEL,
  SCHEDULE_WAKEUP_DESCRIPTION,
  SCHEDULE_WAKEUP_TOOL_NAME,
}

/** densable `jKe` */
export function isKairosLoopDynamicEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_kairos_loop_dynamic', false)
}

/** densable `Cfr` */
export function isLoopNoopFoldEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_loop_noop_fold', false)
}

/**
 * densable `DUe` (subset used by ScheduleWakeup prompt).
 * Returns whether this query-source is eligible for 1h Anthropic prompt cache.
 */
export function isPromptCache1hForQuerySource(querySource: string): boolean {
  if (isEnvTruthy(process.env.FORCE_PROMPT_CACHING_5M)) return false
  if (isEnvTruthy(process.env.ENABLE_PROMPT_CACHING_1H)) return true
  if (
    getAPIProvider() === 'bedrock' &&
    isEnvTruthy(process.env.ENABLE_PROMPT_CACHING_1H_BEDROCK)
  ) {
    return true
  }
  // densable: if(!hi()||yle().isUsingOverage)return!1 — Claude subscriber only,
  // and not while on usage overage (5m TTL). Overage state is session-ephemeral;
  // when unknown, subscriber → 1h allowlist path.
  if (!isClaudeAISubscriber()) return false

  // densable allowlist default: repl_main_thread*, sdk, auto_mode, memdir_relevance
  const allowlist =
    getFeatureValue_CACHED_MAY_BE_STALE<{ allowlist?: string[] }>(
      'tengu_prompt_cache_1h_config',
      {
        allowlist: [
          'repl_main_thread*',
          'sdk',
          'auto_mode',
          'memdir_relevance',
        ],
      },
    ).allowlist ?? []

  return allowlist.some(pattern => {
    if (pattern.endsWith('*')) {
      return querySource.startsWith(pattern.slice(0, -1))
    }
    return querySource === pattern
  })
}

/**
 * densable prompt() cache arg:
 *   e=DUe("repl_main_thread"), t=DUe("sdk"); e===t ? e : void 0
 */
export function resolveScheduleWakeupCacheGuidance(): boolean | undefined {
  const repl = isPromptCache1hForQuerySource('repl_main_thread')
  const sdk = isPromptCache1hForQuerySource('sdk')
  return repl === sdk ? repl : undefined
}

/** densable `EU_` */
export function buildScheduleWakeupBasePrompt(): string {
  return `Schedule when to resume work in /loop dynamic mode — the user invoked /loop without an interval, asking you to self-pace iterations of a specific task.

Do NOT schedule a short-interval wakeup to poll for background work you started — when harness-tracked work finishes, you are re-invoked automatically, so polling is wasted. Instead schedule a long fallback (1200s+) so the loop survives if the work hangs or never notifies. The exception is external work the harness cannot track (a CI run, a deploy, a remote queue) — there, pick a delay matched to how fast that state actually changes.

Pass the same /loop prompt back via \`prompt\` each turn so the next firing repeats the task. For an autonomous /loop (no user prompt), pass the literal sentinel \`${AUTONOMOUS_LOOP_DYNAMIC_SENTINEL}\` as \`prompt\` instead — the runtime resolves it back to the autonomous-loop instructions at fire time. (There is a similar \`${AUTONOMOUS_LOOP_SENTINEL}\` sentinel for CronCreate-based autonomous loops; do not confuse the two — ${SCHEDULE_WAKEUP_TOOL_NAME} always uses the \`-dynamic\` variant.) To end the loop, call this tool with \`stop: true\` (omit every other field) — the loop ends immediately and no further wakeups fire.`
}

const NOOP_FOLD_SECTION = `Set \`noop: true\` if nothing changed — you checked and there's nothing to report ("no change", "still waiting", "quiet hold"). Set \`noop: false\` if something happened worth keeping — you edited a file, posted a message, advanced state, or surfaced a finding. Consecutive \`noop: true\` ticks are collapsed in the user's terminal view and tracked as a streak, so long quiet holds stay legible to the user without scrolling. Omit \`noop\` when stopping (\`stop: true\`).`

const DELAY_1H = `## Picking delaySeconds

This session's requests use a 1-hour Anthropic prompt-cache TTL, so effectively every allowed delay (the runtime clamps to [60, 3600]) wakes up with your conversation context still cached. There is no cache cliff inside that range to pace around, and scheduling extra wakeups just to keep the cache warm is pure waste — never do that. (If the session enters usage overage, later requests drop to the 5-minute TTL; don't try to track or preempt that — the guidance here stays the same.)

Match the delay to what you're actually waiting for:
- **Actively polling external state the harness can't notify you about** (a CI run, a deploy, a remote queue): pick the delay from how fast that state actually changes. A CI run that takes ~8 minutes deserves one ~480s check, not eight 60s ones.
- **The long fallback heartbeat** (something else — a Monitor, a task notification — is the primary wake signal): 1200s+, so quiet wakeups stay rare.
- **Idle ticks with no specific signal to watch**: default to **1200s–1800s** (20–30 min). The loop still checks back regularly, and the user can always interrupt if they need you sooner.

Don't think in cache windows — think about what you're actually waiting for.`

const DELAY_5M = `## Picking delaySeconds

This session's requests use the default 5-minute Anthropic prompt-cache TTL. Sleeping past 300 seconds means the next wake-up reads your full conversation context uncached — slower and more expensive. So the natural breakpoints:
- **Under 5 minutes (60s–270s)**: cache stays warm. Right for actively polling external state the harness can't notify you about — a CI run, a deploy, a remote queue.
- **5 minutes to 1 hour (300s–3600s)**: pay the cache miss. Right when there's no point checking sooner — waiting on something that takes minutes to change, genuinely idle, or as the long fallback heartbeat when something else is the primary wake signal.

**Don't pick 300s.** It's the worst-of-both: you pay the cache miss without amortizing it. If you're tempted to "wait 5 minutes," either drop to 270s (stay in cache) or commit to 1200s+ (one cache miss buys a much longer wait). Don't think in round-number minutes — think in cache windows.

For idle ticks with no specific signal to watch, default to **1200s–1800s** (20–30 min). The loop checks back, you don't burn cache 12× per hour for nothing, and the user can always interrupt if they need you sooner.

Think about what you're actually waiting for, not just "how long should I sleep." If you're polling a CI run that takes ~8 minutes, sleeping 60s burns the cache 8 times before it finishes — sleep ~270s twice instead.

The runtime clamps to [60, 3600], so you don't need to clamp yourself.`

const DELAY_GENERIC = `## Picking delaySeconds

The Anthropic prompt cache decides how expensive a wake-up is: waking inside the cache TTL re-reads your conversation context cached (fast, cheap); waking past it re-reads everything uncached. The TTL depends on how the session is billed: Claude subscriber sessions get a 1-hour TTL (dropping to 5 minutes during usage overage), while API-key, Bedrock, and Vertex sessions default to 5 minutes.

In either regime: never schedule extra wakeups just to keep the cache warm — they cost more than the cache miss they avoid. Match the delay to what you're actually waiting for: when actively polling external state the harness can't notify you about (a CI run, a deploy, a remote queue), pick the delay from how fast that state actually changes; for idle ticks with no specific signal to watch, default to **1200s–1800s** (20–30 min) — the user can always interrupt if they need you sooner.

On a 5-minute TTL only, two refinements: under 300s (60s–270s) the cache stays warm, so prefer 270s over 300s when actively polling (300s is the worst-of-both — you pay the miss without amortizing it); and commit to 1200s+ rather than repeated ~300s waits, so one cache miss buys a long wait.

The runtime clamps to [60, 3600], so you don't need to clamp yourself.`

const REASON_SECTION = `## The reason field

One short sentence on what you chose and why. Goes to telemetry and is shown back to the user. "watching CI run" beats "waiting." The user reads this to understand what you're doing without having to predict your cadence in advance — make it specific.`

/**
 * densable `FKu(e, t)` — full tool prompt.
 * @param includeNoopFold when Cfr() and schema includes noop
 * @param cache1h true=1h TTL guidance, false=5m, undefined=generic
 */
export function buildScheduleWakeupPrompt(
  includeNoopFold: boolean,
  cache1h: boolean | undefined,
): string {
  const delay =
    cache1h === true ? DELAY_1H : cache1h === false ? DELAY_5M : DELAY_GENERIC
  return `${buildScheduleWakeupBasePrompt()}${includeNoopFold ? `\n\n${NOOP_FOLD_SECTION}` : ''}\n\n${delay}\n\n${REASON_SECTION}`
}

export function buildScheduleWakeupSearchHint(): string {
  return `self-pace the dynamic /loop: pick a delay before the next tick, or stop/end/cancel the dynamic loop with stop:true (a fixed-interval /loop is a recurring cron — cancel it with ${CRON_DELETE_TOOL_NAME})`
}
