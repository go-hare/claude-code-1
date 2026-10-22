/**
 * densable Dn / Mt — agent.spawn rewrite recheck (2.1.289).
 * Dn compares the permission snapshot, not the raw hook event.
 * Mt is the per-toolUseId stamp for an auto-mode web-fetch dispatch
 * whose URLs were already allowed without classifier review.
 */
import { isDeepStrictEqual } from 'node:util'
import type { Tool, ToolPermissionContext, ToolUseContext } from 'src/Tool.js'
import type {
  PermissionDecision,
  PermissionResult,
  PermissionRule,
} from 'src/types/permissions.js'
import { matchWildcardPattern } from 'src/utils/permissions/shellRuleMatching.js'
import {
  createPermissionRequestMessage,
  getAskRuleForTool,
  getAskRules,
  getDenyRuleForTool,
  getDenyRules,
} from 'src/utils/permissions/permissions.js'
import { autoModeHasDenyRules } from 'src/utils/permissions/nhoGates.js'
import { WEB_FETCH_TOOL_NAME } from '../WebFetchTool/prompt.js'
import { shouldSkipTeammateSpawnForWebFetch } from './built-in/webFetchAgent.js'

export type SpawnPermissionSnap = {
  prompt: unknown
  description: unknown
  subagentType: unknown
  model: unknown
  background: unknown
  cwd: unknown
}

function contentField(tool: Pick<Tool, 'name'>): string | undefined {
  // densable WebFetch `ruleContentField` is `url` (Rwn). Agent has none,
  // so Agent(Explore) is not a $P content rule — the spawn path checks it.
  if (tool.name === WEB_FETCH_TOOL_NAME) return 'url'
  return undefined
}

function rulesFor(
  perms: ToolPermissionContext,
  behavior: 'deny' | 'ask',
): PermissionRule[] {
  return behavior === 'deny' ? getDenyRules(perms) : getAskRules(perms)
}

/**
 * densable wg — content rules shaped `field:pattern`, skipping the tool's
 * own ruleContentField. Values are matched with the wildcard scanner.
 */
function matchColonRule(
  perms: ToolPermissionContext,
  tool: Pick<Tool, 'name'>,
  input: Record<string, unknown>,
  behavior: 'deny' | 'ask',
): PermissionRule | null {
  const skip = contentField(tool)
  for (const rule of rulesFor(perms, behavior)) {
    if (rule.ruleValue.toolName !== tool.name) continue
    if (rule.ruleBehavior !== behavior) continue
    const content = rule.ruleValue.ruleContent
    if (content === undefined) continue
    const colon = content.indexOf(':')
    if (colon <= 0) continue
    const field = content.slice(0, colon).trim()
    const pattern = content.slice(colon + 1).trim()
    if (field === '' || pattern === '' || field === skip) continue
    if (!Object.hasOwn(input, field)) continue
    const raw = input[field]
    if (typeof raw !== 'string') continue
    if (matchWildcardPattern(pattern, raw.trim())) return rule
  }
  return null
}

function ruleDecision(
  behavior: 'deny' | 'ask',
  rule: PermissionRule,
  toolName: string,
): PermissionDecision {
  return {
    behavior,
    decisionReason: { type: 'rule', rule },
    message:
      behavior === 'deny'
        ? `Permission to use ${toolName} has been denied.`
        : createPermissionRequestMessage(toolName),
  }
}

function keepAsk(decision: PermissionDecision): boolean {
  const reason = decision.decisionReason
  if (reason?.type === 'rule' && reason.rule.ruleBehavior === 'ask') {
    return true
  }
  if (reason?.type === 'safetyCheck') return true
  if (reason?.type === 'sandboxOverride') return true
  return false
}

/**
 * densable $P — deny rules, checkPermissions, ask rules. Returns null when
 * the pipeline has no objection (passthrough and ordinary asks included).
 * Dn does not pass crashIsObjection, so a schema throw stays passthrough.
 */
export async function snapshotPermission(
  tool: Tool,
  input: Record<string, unknown>,
  context: ToolUseContext,
): Promise<PermissionDecision | null> {
  const perms = context.getAppState().toolPermissionContext
  const denied = getDenyRuleForTool(perms, tool)
  if (denied) return ruleDecision('deny', denied, tool.name)
  const contentDeny = matchColonRule(perms, tool, input, 'deny')
  if (contentDeny) return ruleDecision('deny', contentDeny, tool.name)
  const ask = getAskRuleForTool(perms, tool)
  if (ask) return ruleDecision('ask', ask, tool.name)
  let decided: PermissionResult = {
    behavior: 'passthrough',
    message: createPermissionRequestMessage(tool.name),
  }
  try {
    const parsed = tool.inputSchema.parse(input) as {
      [key: string]: unknown
    }
    decided = await tool.checkPermissions(parsed, context)
  } catch {
    // passthrough
  }
  if (decided.behavior === 'deny') return decided
  const contentAsk = matchColonRule(perms, tool, input, 'ask')
  if (contentAsk) {
    if (decided.behavior === 'ask') {
      return { ...decided, decisionReason: { type: 'rule', rule: contentAsk } }
    }
    return ruleDecision('ask', contentAsk, tool.name)
  }
  if (tool.requiresUserInteraction?.()) {
    if (decided.behavior === 'ask') return decided
    return {
      behavior: 'ask',
      message: createPermissionRequestMessage(tool.name),
      decisionReason: { type: 'other', reason: 'requiresUserInteraction' },
    }
  }
  if (decided.behavior === 'ask' && keepAsk(decided)) return decided
  return null
}

function sameRule(
  raised: PermissionDecision | null,
  rewritten: PermissionDecision,
): boolean {
  const left = raised?.decisionReason
  const right = rewritten.decisionReason
  if (left?.type !== 'rule' || right?.type !== 'rule') return false
  return (
    left.rule.source === right.rule.source &&
    left.rule.ruleBehavior === right.rule.ruleBehavior &&
    left.rule.ruleValue.toolName === right.rule.ruleValue.toolName &&
    left.rule.ruleValue.ruleContent === right.rule.ruleValue.ruleContent
  )
}

/** densable Rt — original tool input with the spawn fields overlaid. */
export function spawnPermissionInput(
  base: Record<string, unknown>,
  snap: SpawnPermissionSnap,
): Record<string, unknown> {
  return {
    ...base,
    prompt: snap.prompt,
    description: snap.description,
    subagent_type: snap.subagentType,
    model: snap.model,
    run_in_background: snap.background,
    cwd: snap.cwd,
  }
}

/**
 * densable Dn. Identical snapshots return null. A deny on the rewritten
 * spawn always returns. An ask returns only when its rule differs.
 */
export async function spawnRewriteRuling(
  tool: Tool,
  baseInput: Record<string, unknown>,
  raised: SpawnPermissionSnap,
  rewritten: SpawnPermissionSnap,
  context: ToolUseContext,
): Promise<{ behavior: 'deny' | 'ask'; message: string } | null> {
  if (isDeepStrictEqual(raised, rewritten)) return null
  const next = await snapshotPermission(
    tool,
    spawnPermissionInput(baseInput, rewritten),
    context,
  )
  if (next === null || next.behavior === 'deny') {
    return next === null
      ? null
      : { behavior: next.behavior, message: next.message }
  }
  if (next.behavior !== 'ask') return null
  const prev = await snapshotPermission(
    tool,
    spawnPermissionInput(baseInput, raised),
    context,
  )
  if (sameRule(prev, next)) return null
  return { behavior: 'ask', message: next.message }
}

const unreviewedWebFetch = new Set<string>()

/** densable Mt — true once, then the stamp is spent. */
export function consumeUnreviewedWebFetch(
  toolUseId: string | undefined,
): boolean {
  if (toolUseId === undefined || toolUseId === '') return false
  return unreviewedWebFetch.delete(toolUseId)
}

// densable Awt — stop the match at C0 controls and ellipsis.
const HTTP_URL_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: gold URL scanner excludes C0
  /https?:\/\/[^\s"'<>\\\u2026\x00-\x1f]+/g

function trimHttpUrl(raw: string): string {
  let url = raw
  while (url.length > 0 && '.,;:!?'.includes(url[url.length - 1] ?? '')) {
    url = url.slice(0, -1)
  }
  const closer: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  while (url.length > 0) {
    const last = url[url.length - 1] ?? ''
    const open = closer[last]
    if (open === undefined) break
    let opens = 0
    let closes = 0
    for (const ch of url) {
      if (ch === open) opens += 1
      else if (ch === last) closes += 1
    }
    if (closes <= opens) break
    url = url.slice(0, -1)
  }
  return url
}

/** densable Awt + AY — 1..8 http(s) URLs, trailing punctuation stripped. */
export function httpUrlsInPrompt(prompt: string): string[] {
  const out: string[] = []
  for (const match of prompt.matchAll(HTTP_URL_RE)) {
    const trimmed = trimHttpUrl(match[0] ?? '')
    if (trimmed !== '') out.push(trimmed)
    if (out.length > 8) return out
  }
  return out
}

/**
 * densable Eo / Oo — stamp only auto mode + web-fetch dispatch whose
 * 1–8 URLs are each pre-allowed (rule check null, WebFetch allow).
 */
export async function maybeStampUnreviewedWebFetch(input: {
  toolUseId: string | undefined
  prompt: string
  subagentType: string | undefined
  activeAgents: Array<{ agentType: string; source?: string }> | undefined
  context: ToolUseContext
}): Promise<void> {
  const id = input.toolUseId
  if (id !== undefined && id !== '') unreviewedWebFetch.delete(id)
  if (id === undefined || id === '') return
  if (input.context.getAppState().toolPermissionContext.mode !== 'auto') {
    return
  }
  if (
    !shouldSkipTeammateSpawnForWebFetch(input.subagentType, input.activeAgents)
  ) {
    return
  }
  // densable uut — classifier soft_deny / hard_deny lists block the stamp.
  // Wq() is false in 2.1.289, so it is not a gate here.
  if (autoModeHasDenyRules()) return
  const urls = httpUrlsInPrompt(input.prompt)
  if (urls.length < 1 || urls.length > 8) return
  try {
    const { WebFetchTool } = await import('../WebFetchTool/WebFetchTool.js')
    for (const url of urls) {
      const parsed = WebFetchTool.inputSchema.safeParse({
        url,
        prompt: '',
      })
      if (!parsed.success) return
      const ruled = await snapshotPermission(
        WebFetchTool,
        parsed.data,
        input.context,
      )
      if (ruled !== null) return
      const decision = await WebFetchTool.checkPermissions(
        parsed.data,
        input.context,
      )
      if (decision.behavior !== 'allow') return
    }
  } catch {
    return
  }
  unreviewedWebFetch.add(id)
}
