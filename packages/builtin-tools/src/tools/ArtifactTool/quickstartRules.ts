/**
 * densable 2.1.289 Artifact quickstart `ra` / `bit` analog.
 * Semantic names only — do not export minify ra/bit/Ms/zd/wg/wo.
 */
import { ARTIFACT_TOOL_NAME } from './prompt.js'

const DESIGN_SYSTEM_TYPE = 'Design System'

type ToolPermissionBags = {
  alwaysDenyRules?: Record<string, unknown>
  alwaysAskRules?: Record<string, unknown>
}

type PermissionRuleContext = {
  getAppState?: () => {
    toolPermissionContext?: ToolPermissionBags
  }
}

type SessionPreToolUseMatcher = {
  matcher?: string
  hooks?: Array<{ type?: unknown; internal?: unknown }>
}

type SessionHooksStore = {
  hooks?: {
    PreToolUse?: SessionPreToolUseMatcher[]
  }
}

export type PreToolUseHookContext = {
  getAppState?: () => {
    sessionHooks?: Map<string, SessionHooksStore>
  }
  agentId?: string
  sessionId?: string
}

export function formatTypesRuledNote(rule: string): string {
  return `the permission rule ${rule} governs listing the Artifact types — make that call yourself and the rule decides`
}

export function formatDesignSystemsRuledNote(rule: string): string {
  return `the permission rule ${rule} governs listing the design systems — make that call yourself and the rule decides`
}

function bagStrings(bag: Record<string, unknown> | undefined): string[] {
  if (!bag) return []
  const out: string[] = []
  for (const rules of Object.values(bag)) {
    if (!Array.isArray(rules)) continue
    for (const rule of rules) {
      if (typeof rule === 'string') out.push(rule)
    }
  }
  return out
}

function parseArtifactRule(
  rule: string,
): { content: string | undefined } | null {
  const trimmed = rule.trim()
  const open = trimmed
    .toLowerCase()
    .startsWith(ARTIFACT_TOOL_NAME.toLowerCase())
    ? ARTIFACT_TOOL_NAME.length
    : -1
  if (open === -1) return null
  const rest = trimmed.slice(open)
  if (rest === '') return { content: undefined }
  if (rest[0] !== '(' || !rest.endsWith(')')) return null
  const content = rest.slice(1, -1)
  return { content: content === '' ? undefined : content }
}

function splitObjectishFields(inner: string): string[] {
  const fields: string[] = []
  let buf = ''
  let quote: '"' | "'" | null = null
  for (const ch of inner) {
    if (quote) {
      buf += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      buf += ch
      continue
    }
    if (ch === ',') {
      if (buf.trim()) fields.push(buf.trim())
      buf = ''
      continue
    }
    buf += ch
  }
  if (buf.trim()) fields.push(buf.trim())
  return fields
}

function parseObjectish(content: string): Record<string, string> | undefined {
  const trimmed = content.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return undefined
  }
  const out: Record<string, string> = {}
  for (const field of splitObjectishFields(trimmed.slice(1, -1))) {
    const colon = field.indexOf(':')
    if (colon === -1) continue
    const key = field
      .slice(0, colon)
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .toLowerCase()
    const value = field
      .slice(colon + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '')
    if (key) out[key] = value
  }
  return out
}

function normalizeTypeTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function objectishMatches(
  fields: Record<string, string>,
  shape: Record<string, string | undefined>,
): boolean {
  for (const [key, wanted] of Object.entries(shape)) {
    const got = fields[key.toLowerCase()]
    if (wanted === undefined) {
      if (got === undefined) return false
      continue
    }
    if (got === undefined) return false
    if (key.toLowerCase() === 'type') {
      if (normalizeTypeTitle(got) !== normalizeTypeTitle(wanted)) {
        return false
      }
      continue
    }
    if (got.toLowerCase() !== wanted.toLowerCase()) return false
  }
  return true
}

function matchesListTypesContent(content: string): boolean {
  const lower = content.toLowerCase()
  if (content.trim().toLowerCase() === 'list_types') return true
  const fields = parseObjectish(content)
  if (fields) {
    if (objectishMatches(fields, { action: 'list_types' })) return true
    if (objectishMatches(fields, { action: 'list', scope: 'types' })) {
      return true
    }
  }
  // HAVE string-includes so Artifact(list_types) and object form both hit.
  return lower.includes('list') && lower.includes('types')
}

function matchesDesignSystemContent(
  content: string,
  typeUrl: string | undefined,
): boolean {
  const fields = parseObjectish(content)
  if (!fields) return false
  if (
    objectishMatches(fields, {
      action: 'list',
      type: DESIGN_SYSTEM_TYPE,
      scope: 'all',
    })
  ) {
    return true
  }
  if (typeUrl) {
    return objectishMatches(fields, {
      action: 'list',
      type_url: typeUrl,
      scope: 'all',
    })
  }
  return objectishMatches(fields, {
    action: 'list',
    type_url: undefined,
    scope: 'all',
  })
}

/** Gold `ra` analog: Ms deny tool-wide; zd ask tool-wide only when !pipelineRan. */
function matchingArtifactPermissionRule(
  context: PermissionRuleContext | undefined,
  pipelineRan: boolean,
  matchesContent: (content: string) => boolean,
): string | undefined {
  const bags = context?.getAppState?.().toolPermissionContext
  if (!bags) return undefined
  const denyRules = bagStrings(bags.alwaysDenyRules)
  const askRules = bagStrings(bags.alwaysAskRules)
  const parsedDeny = denyRules.map(rule => ({
    rule,
    parsed: parseArtifactRule(rule),
  }))
  const parsedAsk = askRules.map(rule => ({
    rule,
    parsed: parseArtifactRule(rule),
  }))

  for (const row of parsedDeny) {
    if (row.parsed && row.parsed.content === undefined) return row.rule
  }
  if (!pipelineRan) {
    for (const row of parsedAsk) {
      if (row.parsed && row.parsed.content === undefined) return row.rule
    }
  }

  for (const group of [parsedDeny, parsedAsk]) {
    for (const row of group) {
      const content = row.parsed?.content
      if (content === undefined) continue
      if (matchesContent(content)) return row.rule
    }
  }
  return undefined
}

/** Gold `ra` analog for list_types shapes. pipelineRan default true. */
export function typesListPermissionRule(
  context: PermissionRuleContext | undefined,
  pipelineRan = true,
): string | undefined {
  return matchingArtifactPermissionRule(
    context,
    pipelineRan,
    matchesListTypesContent,
  )
}

/** Gold `ra` analog for design-system list shapes. */
export function designSystemsListPermissionRule(
  context: PermissionRuleContext | undefined,
  typeUrl: string | undefined,
  pipelineRan = true,
): string | undefined {
  return matchingArtifactPermissionRule(context, pipelineRan, content =>
    matchesDesignSystemContent(content, typeUrl),
  )
}

function matcherCoversArtifact(matcher: string | undefined): boolean {
  if (
    matcher === undefined ||
    matcher.trim() === '' ||
    matcher.trim() === '*'
  ) {
    return true
  }
  return /artifact/i.test(matcher)
}

function hooksAreUserPreToolUse(
  hooks: SessionPreToolUseMatcher['hooks'],
): boolean {
  if (!Array.isArray(hooks) || hooks.length === 0) return true
  return hooks.some(
    hook => !(hook.type === 'callback' && hook.internal === true),
  )
}

function storeHasArtifactPreToolUse(
  store: SessionHooksStore | undefined,
): boolean {
  const matchers = store?.hooks?.PreToolUse
  if (!Array.isArray(matchers) || matchers.length === 0) return false
  return matchers.some(entry => matcherCoversArtifact(entry.matcher))
}

function registeredPreToolUseCoversArtifact(): boolean {
  const { getRegisteredHooks } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('src/bootstrap/state.js') as typeof import('src/bootstrap/state.js')
  const matchers = getRegisteredHooks()?.PreToolUse
  if (!Array.isArray(matchers) || matchers.length === 0) return false
  return matchers.some(entry => {
    const matcher = (entry as { matcher?: string }).matcher
    if (!matcherCoversArtifact(matcher)) return false
    const hooks = (entry as { hooks?: SessionPreToolUseMatcher['hooks'] }).hooks
    return hooksAreUserPreToolUse(hooks)
  })
}

/** Gold `bit` analog. catch → true. */
export function hasPreToolUseHook(context?: PreToolUseHookContext): boolean {
  try {
    const sessionHooks = context?.getAppState?.()?.sessionHooks
    if (sessionHooks instanceof Map) {
      const key = context?.agentId ?? context?.sessionId
      if (key && storeHasArtifactPreToolUse(sessionHooks.get(key))) {
        return true
      }
    }
    return registeredPreToolUseCoversArtifact()
  } catch {
    return true
  }
}
