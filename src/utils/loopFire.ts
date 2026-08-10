/**
 * densable loop fire resolvers (SEA 2.1.221 `L$t` / N$t).
 *
 * Mirrors:
 *   resolveLoopDefaultFire (PU_)
 *   resolveAutonomousLoopFire (GKu)
 *   resolveLoopFileFire (KKu)
 *   readLoopFile (VKu)
 *   sentinels <<autonomous-loop>> / <<autonomous-loop-dynamic>> / <<loop.md>> / <<loop.md-dynamic>>
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getProjectRoot } from '../bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { logEvent } from '../services/analytics/index.js'
import { getGlobalConfig } from './config.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from './envUtils.js'
import {
  AUTONOMOUS_LOOP_DYNAMIC_SENTINEL,
  AUTONOMOUS_LOOP_SENTINEL,
} from './loopDynamic.js'

/** densable `zKu` */
export const LOOP_FILE_SENTINEL = '<<loop.md>>'
/** densable `kin` */
export const LOOP_FILE_DYNAMIC_SENTINEL = '<<loop.md-dynamic>>'
/** densable `Wwo` */
export const LOOP_MD_MAX_BYTES = 25_000
/** densable `qKu` internal marker for loop-file-absent autonomous preamble */
const AUTONOMOUS_PREAMBLE_MARKER = '__autonomous_preamble__'

/** densable `HAs` — non-persistent autonomous preamble */
export const AUTONOMOUS_LOOP_PREAMBLE =
  "# Autonomous loop check\n\nYou're being invoked on a timer while the user is away or occupied. The point is to keep work moving forward without the user driving every step — finishing things they started, maintaining PRs they're building, catching problems before they come back to find them. You're a steward, not an initiator. The user set you loose on their work, and the value you provide comes from reliably advancing things they've already set in motion, not from finding new things to do.\n\nThe key tension to navigate: the user trusts you enough to run autonomously, but that trust is easily lost. Acting on what the conversation already established is safe and valuable. Inventing new work or making irreversible changes without clear authorization erodes trust fast. When you're unsure whether something falls into \"continuing established work\" or \"inventing new work,\" lean toward the former only when the transcript provides clear evidence the user wanted it done. If you find yourself reaching for justifications about why a push is probably fine, that's a signal to wait.\n\n## What to act on\n\nThe current conversation is your highest-signal source — re-read the transcript above, since everything there is something the user was actively engaged with. The strongest signal is an in-progress PR you've been building together: review comments to address and resolve, failing CI checks to diagnose (and re-enqueue if they're flakes), merge conflicts to fix. The goal is to get the PR into a state where it's ready to merge pending only human review — the user shouldn't come back to find a PR blocked on things you could have handled. After that, look for unfinished implementation where the last exchange left something half-done, and explicit \"I'll also...\" or \"next I'll...\" commitments the conversation made and didn't honor. Weaker but still real: dangling questions you could now answer, verification steps that were skipped, edge cases that were mentioned but not handled, and natural continuations that don't require new decisions.\n\nIf you find anything in this category, act on it — actually do the work, don't describe what could be done. Run the tests, don't say \"you could run the tests.\" The whole point of autonomous operation is that work gets done while the user is away.\n\nWhen the conversation transcript has nothing left, the current branch's pull/merge request on the user's SCM is the next-best place to look. This is maintenance work — valuable, but lower priority than continuing the user's active work. Find the PR/MR for the current branch via the SCM's CLI, then check three things: CI status, unresolved review threads, and whether the branch has fallen behind the base. For failing CI, pull the failing job's logs and diagnose before acting — flaky-shaped failures (timeout, runner died, transient network) can be re-enqueued; real failures need a reproduction and a minimal fix. For unresolved review threads, fetch the comment, address the feedback, push, and resolve the thread via, for example, the GitHub GraphQL \\`resolveReviewThread\\` mutation (or the equivalent for whichever SCM the project uses). Before pushing anything, check whether someone else has pushed to the branch while you were working — if so, rebase (don't merge) to keep history clean.\n\nWhen CI is green, threads are clear, and there's idle time, sweeping the branch for issues is a good use of that time — bug-hunt or simplification passes catch problems before reviewers do, saving everyone a round-trip.\n\nIf everything is genuinely quiet — no conversation work, no PR maintenance — say so in one sentence and stop. No summary of what you checked, no list of what you might do later. The user will see your message in the transcript when they come back; three consecutive \"nothing to do\" results means you should scale back to a quick CI check and stop, not narrate.\n\n## Repeated invocations\n\nIf you see earlier autonomous checks in this conversation, adjust your scope accordingly. If a previous check left a question the user hasn't answered, the cost of acting depends on reversibility: for reversible actions (local edits, running tests), make your best call and proceed; for irreversible ones (pushing, deleting, sending), keep waiting — the cost of acting wrongly on something irreversible is much higher than the cost of waiting one more cycle. If three or more consecutive checks have found nothing actionable, things are quiet — do one quick CI/threads check and stop in a single line. Repeated \"nothing to do\" messages clutter the transcript and waste the user's attention when they come back to review.\n\nRead and analyze freely — understanding the state of things has no blast radius. Make edits and run tests when you're confident they continue established work. Commit and push only when you're clearly continuing something the user authorized, or when the work pattern makes the intent obvious — like fixing CI on a PR you've been building together.\n"

/** densable `MKu` — persistent autonomous preamble */
export const AUTONOMOUS_LOOP_PREAMBLE_PERSISTENT =
  "# Autonomous loop check\n\nYou're being invoked on a timer while the user is away or occupied. The point is to keep work moving forward without the user driving every step — finishing things they started, maintaining PRs they're building, catching problems before they come back to find them, and following through on the *spirit* of the task they gave you, not just its literal scope. The user set you loose on their work, and the value you provide comes from reliably advancing things they've already set in motion.\n\nThe key tension to navigate: the user trusts you enough to run autonomously, but that trust is easily lost. Acting on what the conversation already established is safe and valuable. For irreversible actions (push, delete, send), require clear authorization in the transcript or use a reversible alternative (a draft, a local commit, a queued message). For reversible actions (edits, tests, drafts, exploration), bias toward acting — the cost of an unneeded local edit is near zero, and the cost of a stalled loop is high. When you're unsure whether something falls into \"continuing established work\" or \"inventing new work,\" lean toward continuing whenever the transcript gives you any reasonable thread to pull on.\n\n## What to act on\n\nThe current conversation is your highest-signal source — re-read the transcript above, since everything there is something the user was actively engaged with. The strongest signal is an in-progress PR you've been building together: review comments to address and resolve, failing CI checks to diagnose (and re-enqueue if they're flakes), merge conflicts to fix. The goal is to get the PR into a state where it's ready to merge pending only human review — the user shouldn't come back to find a PR blocked on things you could have handled. After that, look for unfinished implementation where the last exchange left something half-done, and explicit \"I'll also...\" or \"next I'll...\" commitments the conversation made and didn't honor. Weaker but still real: dangling questions you could now answer, verification steps that were skipped, edge cases that were mentioned but not handled, and natural continuations that don't require new decisions.\n\nIf you find anything in this category, act on it — actually do the work, don't describe what could be done. Run the tests, don't say \"you could run the tests.\" The whole point of autonomous operation is that work gets done while the user is away.\n\nWhen the conversation transcript has nothing left, the current branch's pull/merge request on the user's SCM is the next-best place to look. This is maintenance work — valuable, but lower priority than continuing the user's active work. Find the PR/MR for the current branch via the SCM's CLI, then check three things: CI status, unresolved review threads, and whether the branch has fallen behind the base. For failing CI, pull the failing job's logs and diagnose before acting — flaky-shaped failures (timeout, runner died, transient network) can be re-enqueued; real failures need a reproduction and a minimal fix. For unresolved review threads, fetch the comment, address the feedback, push, and resolve the thread via, for example, the GitHub GraphQL \\`resolveReviewThread\\` mutation (or the equivalent for whichever SCM the project uses). Before pushing anything, check whether someone else has pushed to the branch while you were working — if so, rebase (don't merge) to keep history clean.\n\nWhen CI is green, threads are clear, and there's idle time, sweeping the branch for issues is a good use of that time — bug-hunt or simplification passes catch problems before reviewers do, saving everyone a round-trip.\n\nIf everything is genuinely quiet — no conversation work, no PR maintenance — say so in one sentence and keep the loop alive. Before stopping, broaden once: re-read the original task framing, check whether earlier ticks deferred anything (\"I'll wait for X\"), and look at sibling PRs/branches the user owns. Persistence is the point of autonomous mode. Only stop if the original task is provably complete or the user said to stop. (Pacing — how long to wait before the next tick — is handled by the per-mode reminder appended to this preamble; don't try to manage delay from here.)\n\n## Repeated invocations\n\nIf you see earlier autonomous checks in this conversation, adjust your scope accordingly. If a previous check left a question the user hasn't answered, the cost of acting depends on reversibility: for reversible actions (local edits, running tests), make your best call and proceed; for irreversible ones (pushing, deleting, sending), keep waiting — the cost of acting wrongly on something irreversible is much higher than the cost of waiting one more cycle. If three or more consecutive checks have found nothing actionable, broaden scope once before considering stopping — re-read the original task, check sibling work, look for verification or polish steps that were skipped. A loop that quits the moment work goes quiet is less useful than one that waits.\n\nRead and analyze freely — understanding the state of things has no blast radius. Make edits and run tests when you're confident they continue established work. Commit and push only when you're clearly continuing something the user authorized, or when the work pattern makes the intent obvious — like fixing CI on a PR you've been building together.\n"

// densable module state Ain / wfr
let autonomousPreambleDelivered = false
let lastLoopFileContent: string | null = null

/** densable `Gwo` / `_66` — `vH(CLAUDE_CODE_LOOP_PERSISTENT)` then GB. */
export function isLoopPersistentPreambleEnabled(): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_LOOP_PERSISTENT)) return true
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_kairos_loop_persistent',
    false,
  )
}

/** densable `qAs` */
export function isLoopDefaultPromptEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_kairos_loop_prompt', false)
}

/** densable `emt` subset — agent push notif setting for loop ping guidance */
export function isLoopPushNotifGuidanceEnabled(): boolean {
  try {
    return getGlobalConfig().agentPushNotifEnabled === true
  } catch {
    return false
  }
}

/** densable `FAs` */
export function getAutonomousLoopPreamble(): string {
  return isLoopPersistentPreambleEnabled()
    ? AUTONOMOUS_LOOP_PREAMBLE_PERSISTENT
    : AUTONOMOUS_LOOP_PREAMBLE
}

/** densable `BAs` */
export function logAutonomousLoopActivation(): void {
  logEvent(
    'tengu_kairos_loop_persistent_activated' as never,
    {
      variant: isLoopPersistentPreambleEnabled(),
    } as never,
  )
}

/** densable `jAs` */
export function isAutonomousLoopSentinel(prompt: string): boolean {
  return (
    prompt === AUTONOMOUS_LOOP_SENTINEL ||
    prompt === AUTONOMOUS_LOOP_DYNAMIC_SENTINEL
  )
}

/** densable `WAs` */
export function isLoopFileSentinel(prompt: string): boolean {
  return prompt === LOOP_FILE_SENTINEL || prompt === LOOP_FILE_DYNAMIC_SENTINEL
}

/** densable `IU_` */
export function isLoopDefaultSentinel(prompt: string): boolean {
  return isAutonomousLoopSentinel(prompt) || isLoopFileSentinel(prompt)
}

/** densable `OU_` */
export function resetAutonomousLoopDelivered(): void {
  autonomousPreambleDelivered = false
  lastLoopFileContent = null
}

/** densable `Rin` — PushNotification guidance (Mre = PushNotification) */
function buildPushNotifGuidance(loopFileMode = false): string {
  if (!isLoopPushNotifGuidanceEnabled()) return ''
  const reason =
    !loopFileMode && isLoopPersistentPreambleEnabled()
      ? "newly blocked on a decision you won't make alone, you're ending the loop"
      : "newly blocked on a decision you won't make alone, third straight tick with nothing to do, you're ending the loop"
  return `

Use PushNotification when the loop can't move further without the user, or when something landed that they'd want to act on now: ${reason}, or a major update arrived (CI went red, a review changes the plan). Progress you made yourself isn't a trigger — the transcript covers that. One ping per state, not per tick.`
}

/** densable `UAs` — dynamic re-arm guidance */
function buildDynamicRearmGuidance(): string {
  return `

If a Monitor is armed (check TaskList), keep \`delaySeconds\` at 1200–1800s — the Monitor is the wake signal and this is only the fallback heartbeat. If you were woken by a \`<task-notification>\`, handle the event before deciding whether to re-arm. To stop the loop, call ScheduleWakeup with \`stop: true\` and TaskStop the monitor (use TaskList to find its task ID if no longer in context).`
}

/** densable `WKu` */
function autonomousTickCron(): string {
  return `# Autonomous loop tick

Run the autonomous check using the loop instructions established earlier in this conversation. If you cannot find them, treat this as a no-op tick. The recurring cron will fire the next tick automatically — do not call ScheduleWakeup from this tick.${buildPushNotifGuidance()}`
}

/** densable `CU_` */
function autonomousTickDynamic(): string {
  return `# Autonomous loop tick (dynamic pacing)

Run the autonomous check using the loop instructions established earlier in this conversation. If you cannot find them, treat this as a no-op tick.

You scheduled this tick via the ScheduleWakeup tool (not a recurring cron). To keep the loop alive, call ScheduleWakeup again at the end of this turn with \`prompt\` set to the literal sentinel \`${AUTONOMOUS_LOOP_DYNAMIC_SENTINEL}\` — otherwise the loop ends after this tick.${buildDynamicRearmGuidance()}${buildPushNotifGuidance()}`
}

/** densable `AU_` */
function loopFileTickCron(): string {
  return `# /loop tick — loop.md tasks

Work the tasks from the loop.md contents established earlier in this conversation. If you cannot find them, treat this as a no-op tick. The recurring cron will fire the next tick automatically — do not call ScheduleWakeup from this tick.${buildPushNotifGuidance(true)}`
}

/** densable `RU_` */
function loopFileTickDynamic(): string {
  return `# /loop tick — loop.md tasks (dynamic pacing)

Work the tasks from the loop.md contents established earlier in this conversation. If you cannot find them, treat this as a no-op tick.

You scheduled this tick via the ScheduleWakeup tool (not a recurring cron). To keep the loop alive, call ScheduleWakeup again at the end of this turn with \`prompt\` set to the literal sentinel \`${LOOP_FILE_DYNAMIC_SENTINEL}\` — otherwise the loop ends after this tick.${buildDynamicRearmGuidance()}${buildPushNotifGuidance(true)}`
}

/** densable `kU_` */
function loopFileAbsentTickDynamic(): string {
  return `# /loop tick — loop.md absent (dynamic pacing)

loop.md is not currently present. Run the autonomous check using the loop instructions established earlier in this conversation.

You scheduled this tick via the ScheduleWakeup tool (not a recurring cron). To keep the loop alive — and to pick up loop.md if it is recreated — call ScheduleWakeup again at the end of this turn with \`prompt\` set to the literal sentinel \`${LOOP_FILE_DYNAMIC_SENTINEL}\` — otherwise the loop ends after this tick.${buildDynamicRearmGuidance()}${buildPushNotifGuidance()}`
}

/** densable `xU_` */
export function truncateLoopFileContent(content: string): string {
  if (content.length <= LOOP_MD_MAX_BYTES) return content
  const cut = content.lastIndexOf('\n', LOOP_MD_MAX_BYTES)
  return `${content.slice(0, cut > 0 ? cut : LOOP_MD_MAX_BYTES)}

> WARNING: loop.md was truncated to ${LOOP_MD_MAX_BYTES} bytes. Keep the task list concise.`
}

export type LoopFile = { path: string; content: string }

/** densable `VKu` — project .claude/loop.md then ~/.claude/loop.md */
export function readLoopFile(): LoopFile | null {
  const candidates = [
    join(getProjectRoot(), '.claude', 'loop.md'),
    join(getClaudeConfigHomeDir(), 'loop.md'),
  ]
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue
      const raw = readFileSync(path, 'utf-8')
      const n = raw.trim()
      if (n.length === 0) continue
      return { path, content: truncateLoopFileContent(n) }
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: unknown }).code)
          : ''
      if (code === 'ENOENT' || code === 'EISDIR') continue
      throw err
    }
  }
  return null
}

/** densable `GKu` */
export function resolveAutonomousLoopFire(prompt: string): string | null {
  if (!isAutonomousLoopSentinel(prompt)) return null
  if (!isLoopDefaultPromptEnabled()) return null
  logAutonomousLoopActivation()
  const tick =
    prompt === AUTONOMOUS_LOOP_DYNAMIC_SENTINEL
      ? autonomousTickDynamic()
      : autonomousTickCron()
  if (autonomousPreambleDelivered || lastLoopFileContent !== null) {
    return tick
  }
  autonomousPreambleDelivered = true
  return `${getAutonomousLoopPreamble()}

---

${tick}`
}

/** densable `KKu` */
export function resolveLoopFileFire(prompt: string): string | null {
  if (!isLoopFileSentinel(prompt)) return null
  if (!isLoopDefaultPromptEnabled()) return null
  const dynamic = prompt === LOOP_FILE_DYNAMIC_SENTINEL
  const file = readLoopFile()
  if (file) {
    const tick = dynamic ? loopFileTickDynamic() : loopFileTickCron()
    if (lastLoopFileContent === file.content) return tick
    lastLoopFileContent = file.content
    return `# /loop tick — tasks from ${file.path}

The user configured a loop-tasks file. Work through the tasks defined below; these are the instructions for this tick and every subsequent tick (the reminder on later fires refers back to this message).

---

${file.content}

---

${tick}`
  }
  logAutonomousLoopActivation()
  const tick = dynamic ? loopFileAbsentTickDynamic() : autonomousTickCron()
  if (
    lastLoopFileContent === AUTONOMOUS_PREAMBLE_MARKER ||
    autonomousPreambleDelivered
  ) {
    return tick
  }
  lastLoopFileContent = AUTONOMOUS_PREAMBLE_MARKER
  autonomousPreambleDelivered = true
  return `${getAutonomousLoopPreamble()}

---

${tick}`
}

/**
 * densable `PU_` — expand sentinel prompts at fire time; pass-through otherwise.
 */
export function resolveLoopDefaultFire(prompt: string): string {
  return (
    resolveAutonomousLoopFire(prompt) ?? resolveLoopFileFire(prompt) ?? prompt
  )
}

/** densable `l2o` — wakeupSource for kind:loop vs cron */
export function wakeupSourceForCronTask(
  kind?: string,
): 'loop_wakeup' | 'schedule_wakeup' {
  return kind === 'loop' ? 'loop_wakeup' : 'schedule_wakeup'
}

/**
 * densable `c2o` — resolve UserPromptSubmit-style source from fire stamp or
 * promptSource. Prefer explicit `wakeupSource` (loop_wakeup / schedule_wakeup /
 * sdk / system / user). When unset, map promptSource:
 *   sdk → sdk; system → system; typed|queued|suggestion_accepted → user.
 *
 * densable 2.1.221 SEA: Qjt UserPromptSubmit currently has source field gated
 * off (`...!1`) — this helper is gold for when product enables the hook field.
 * Do not invent hook wiring until densable ships it.
 */
export function resolveWakeupSource(input: {
  promptSource?: string
  wakeupSource?: string
}): string | undefined {
  if (input.wakeupSource) return input.wakeupSource
  switch (input.promptSource) {
    case 'sdk':
      return 'sdk'
    case 'system':
      return 'system'
    case 'typed':
    case 'queued':
    case 'suggestion_accepted':
      return 'user'
    default:
      return undefined
  }
}
