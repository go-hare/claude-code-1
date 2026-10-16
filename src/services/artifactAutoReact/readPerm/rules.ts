/**
 * densable 2.1.289 Artifact permission-rule matching.
 *
 * chunk-dycpdjev: `a_` / `Ow` / `mNe` with privates `Cat` / `P` / `oKe` /
 * `M1n` / `g` / `p` / `m` / `w` / `d`. qR chunk (@210624855): `qR` / `k` /
 * `Bte`. Inlined deps: `cn` / `zy` / `Um` / `Xx` / `bVt` / `wVt` / `Bt` /
 * `Jx` / `An` / `IVt` / `yWe` / `E` / `u$` / `lkn` (chunk-63av4j33),
 * `_r` / `Rwn` (chunk-n1p4hrrd), `E2t` / `Ms` / `zd` / `wg` / `Ff`
 * (chunk-anbj3g87), `zY` (chunk-0jyznke9), `JBt` (chunk-cn36n4mn), `sG` /
 * `U4e` (chunk-asck0zg4), `tP` (chunk-qrmhd8te), `yIe` / `fr`.
 * `dI` → getRuleByContentsForToolName, `yW` → canonicalizeArtifactUrlInput,
 * `Pn` → permissionRuleValueToString.
 * chunk-cx175mfd: `de` with privates `h` / `g` / `y` / `S` / `m`; the
 * layer walk reuses getToolPermissionContextFromLayers (local `bn`).
 */
import { SKILL_TOOL_NAME } from '@claude-code/builtin-tools/tools/SkillTool/constants.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../analytics/growthbook.js'
import { getToolPermissionContextFromLayers } from '../../../engine/permissionLayerReaders.js'
import {
  getAgentContext,
  isDelegatedObservation,
} from '../../../utils/agentContext.js'
import { Fee } from '../ownership.js'
import {
  type ArtifactRegistries,
  artifactRegistriesFromContext,
  isOutsideOrgPersonAsk,
  isRemoteCoworkContentHostDenied,
  jjt,
} from './provenance.js'
import type { ToolPermissionContext, ToolUseContext } from '../../../Tool.js'
import type {
  PermissionBehavior,
  PermissionDenyDecision,
  PermissionMode,
  PermissionRule,
  PermissionRuleSource,
  ToolPermissionRulesBySource,
} from '../../../types/permissions.js'
import {
  canonicalizeArtifactUrlInput,
  type ParsedArtifactUrl,
} from '../../../utils/artifactUrl.js'
import { permissionRuleValueToString } from '../../../utils/permissions/permissionRuleParser.js'
import {
  getAskRules,
  getDenyRules,
  getRuleByContentsForToolName,
} from '../../../utils/permissions/permissions.js'

/** densable cn */
export const ARTIFACT_TOOL_NAME = 'Artifact'
/** densable zy */
export const ARTIFACT_COMMENTS_TOOL_NAME = 'ArtifactComments'
/** densable Um */
export const ARTIFACT_DATA_TOOL_NAME = 'ArtifactData'
/** densable Xx */
export const ARTIFACT_CHECK_TOOL_NAME = 'ArtifactCheck'
/** densable _r */
export const WEB_FETCH_TOOL_NAME = 'WebFetch'
/** densable cn alias. */
export const cn = ARTIFACT_TOOL_NAME
/** densable _r alias. */
export const _r = WEB_FETCH_TOOL_NAME

/** densable bVt */
const ARTIFACT_RULE_CONTENT_FIELD = 'file_path'
/** densable Rwn */
const WEB_FETCH_RULE_CONTENT_FIELD = 'url'
/** densable wVt */
const DEFAULT_READ_PROMPT =
  'Describe what this page contains and reproduce its substantive text content, structure, and any data it presents.'
/** densable E2t */
const NARROWING_DENY_SOURCES: readonly PermissionRuleSource[] = [
  'toolsNarrowing',
  'command',
]
/** densable yIe */
const DEVICE_FIELD = 'device'
/** densable fr */
const HOST_FIELD = '_host'

type RuleTool = { name: string; ruleContentField?: string }

/** densable w */
const WEB_FETCH_RULE_TOOL: RuleTool = {
  name: WEB_FETCH_TOOL_NAME,
  ruleContentField: WEB_FETCH_RULE_CONTENT_FIELD,
}
/** densable d */
const ARTIFACT_RULE_TOOL: RuleTool = {
  name: ARTIFACT_TOOL_NAME,
  ruleContentField: ARTIFACT_RULE_CONTENT_FIELD,
}

type ArtifactRef = Pick<ParsedArtifactUrl, 'slug' | 'env'>
type RuleInput = Record<string, unknown>

export type ArtifactReadRuleOpts = { prompt?: string; page?: unknown }

export type ArtifactLinkRuleOpts = {
  action?: string
  read?: ArtifactReadRuleOpts
  copySource?: boolean
}

export type ArtifactActionRuleOpts = ArtifactLinkRuleOpts & {
  fields?: RuleInput
  wholeToolAskAnswered?: boolean
}

const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const BASE58 = 58n
const UUID_MAX = (1n << 128n) - 1n
const SHORT_ID_LENGTH = 22
const SHORT_ID = '[1-9A-HJ-NP-Za-km-z]{22}'
const SHORT_ID_RE = new RegExp(`^${SHORT_ID}$`)
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const UUID_RE = new RegExp(`^${UUID}$`)
const PROD_ORIGIN = 'https://(?:[a-z0-9-]+\\.)?claude\\.ai'
const VIEWER_PATH = `/(?:artifact|code/(?:artifact|frame))/(?:([A-Za-z0-9_-]*)-)?(${UUID}|${SHORT_ID})(?:[/?#]|$)`
const FRAME_HOST_RE = new RegExp(
  `^https://(${UUID})\\.frame\\.(staging\\.)?claudeusercontent\\.com(?:[/?#]|$)`,
)
const URL_ORIGIN_RE = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)(.*)$/

/** densable sG */
const ACTION_FAMILY: Readonly<Record<string, 'comments' | 'data' | 'check'>> = {
  comments: 'comments',
  reply: 'comments',
  resolve: 'comments',
  watch: 'comments',
  unwatch: 'comments',
  status: 'comments',
  resume_replies: 'comments',
  read_db: 'data',
  write_db: 'data',
  verify: 'check',
  preview: 'check',
}

/** densable k (chunk-dycpdjev) */
const FAMILY_TOOL_NAME = {
  comments: ARTIFACT_COMMENTS_TOOL_NAME,
  data: ARTIFACT_DATA_TOOL_NAME,
  check: ARTIFACT_CHECK_TOOL_NAME,
} as const

/** densable E */
function shortIdFor(slug: string): string | null {
  if (!UUID_RE.test(slug)) return null
  let n = BigInt(`0x${slug.replaceAll('-', '')}`)
  let out = ''
  for (let i = 0; i < SHORT_ID_LENGTH; i++) {
    out = BASE58_ALPHABET[Number(n % BASE58)] + out
    n /= BASE58
  }
  return out
}

/** densable u$ */
function slugForShortId(id: string): string | null {
  if (!SHORT_ID_RE.test(id)) return null
  let n = 0n
  for (const ch of id) n = n * BASE58 + BigInt(BASE58_ALPHABET.indexOf(ch))
  if (n > UUID_MAX) return null
  const hex = n.toString(16).padStart(32, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** densable h (Bt slug group, strict=false) */
function viewerSlug(id: string | undefined): string | null {
  if (id === undefined) return null
  if (id.length !== SHORT_ID_LENGTH) return id
  return slugForShortId(id)
}

/**
 * densable Bt — 289 `O()` is null and `vEe()` undefined, so only the
 * claude.ai viewer and frame-host arms exist.
 */
function parseArtifactRef(url: string): ArtifactRef | null {
  const viewer = url.match(new RegExp(`^${PROD_ORIGIN}${VIEWER_PATH}`))
  const slug = viewerSlug(viewer?.[2])
  if (slug !== null) return { slug, env: 'prod' }
  const frame = url.match(FRAME_HOST_RE)
  if (frame?.[1]) {
    return { slug: frame[1], env: frame[2] ? 'staging' : 'prod' }
  }
  return null
}

/** densable Jx */
function parseArtifactRefInput(url: unknown): ArtifactRef | null {
  return typeof url === 'string'
    ? parseArtifactRef(canonicalizeArtifactUrlInput(url))
    : null
}

/** densable lkn */
function isShortViewerPathEnabled(): boolean {
  return (
    getFeatureValue_CACHED_MAY_BE_STALE<boolean>(
      'tengu_cobalt_plinth_lovage',
      false,
    ) === true
  )
}

/** densable An — `b(env)` is always claude.ai in 289. */
function artifactViewerUrl(ref: ArtifactRef): string {
  if (isShortViewerPathEnabled()) {
    const shortId = shortIdFor(ref.slug)
    if (shortId !== null) return `https://claude.ai/artifact/${shortId}`
  }
  return `https://claude.ai/code/artifact/${ref.slug}`
}

/** densable IVt */
function artifactViewerUrls(ref: ArtifactRef): string[] {
  const shortId = shortIdFor(ref.slug)
  return [
    `https://claude.ai/code/artifact/${ref.slug}`,
    ...(shortId !== null ? [`https://claude.ai/artifact/${shortId}`] : []),
  ]
}

/** densable yWe */
function artifactFrameOrigin(ref: ArtifactRef): string {
  return `https://${ref.slug}.frame.${ref.env === 'staging' ? 'staging.' : ''}claudeusercontent.com`
}

/** densable zY */
function globMatches(pattern: string, value: string): boolean {
  return new RegExp(
    `^${pattern
      .split('*')
      .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
    's',
  ).test(value)
}

/** densable P */
function normalizeUrlPatternOrigin(pattern: string): string {
  const m = pattern.match(URL_ORIGIN_RE)
  if (!m) return pattern
  let scheme = m[1]!.toLowerCase()
  if (scheme === 'http') scheme = 'https'
  const host = m[2]!
    .toLowerCase()
    .replace(/:(?:443|80)$/, '')
    .replace(/\.(?=$|:\d+$)/, '')
  return `${scheme}://${host}${m[3] ?? ''}`
}

/** densable Cat */
function matchArtifactUrlRule(
  rules: Map<string, PermissionRule>,
  ref: ArtifactRef,
  url: unknown,
  field = 'url',
): PermissionRule | null {
  if (rules.size === 0) return null
  const frame = artifactFrameOrigin(ref)
  const candidates = new Set([...artifactViewerUrls(ref), frame, `${frame}/`])
  if (typeof url === 'string') {
    candidates.add(canonicalizeArtifactUrlInput(url).trim())
  }
  for (const [content, rule] of rules) {
    const sep = content.indexOf(':')
    if (sep <= 0) continue
    const key = content.slice(0, sep).trim()
    const pattern = content.slice(sep + 1).trim()
    if (key !== field || pattern === '') continue
    const target = parseArtifactRefInput(pattern.replace(/\*$/, ''))
    if (target?.slug === ref.slug && target.env === ref.env) return rule
    for (const p of new Set([pattern, normalizeUrlPatternOrigin(pattern)])) {
      for (const candidate of candidates) {
        if (globMatches(p, candidate)) return rule
      }
    }
  }
  return null
}

/** densable JBt `o` */
function normalizeDomainRule(content: string): string {
  if (!content.startsWith('domain:')) return content
  return `domain:${content
    .slice(7)
    .toLowerCase()
    .replace(/(?<=[^*.])\.+(?=(:\d+)?$)/, '')}`
}

/** densable JBt `c` */
function domainGlobSource(pattern: string): string {
  return pattern
    .split('*')
    .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^.:]*')
}

/** densable JBt `m` */
function domainWildcardMatches(pattern: string, value: string): boolean {
  if (!pattern.startsWith('domain:') || !value.startsWith('domain:')) {
    return false
  }
  if (pattern === 'domain:*') return true
  const source = pattern.startsWith('domain:*.')
    ? `^domain:(?:[^.:]+\\.)+${domainGlobSource(pattern.slice(9))}$`
    : `^domain:${domainGlobSource(pattern.slice(7))}$`
  return new RegExp(source, 'i').test(value)
}

/** densable JBt */
function findDomainRule(
  rules: Map<string, PermissionRule>,
  content: string,
): PermissionRule | undefined {
  const exact = rules.get(content)
  if (exact) return exact
  const wanted = normalizeDomainRule(content)
  let wildcard: PermissionRule | undefined
  for (const [key, rule] of rules) {
    const normalized = normalizeDomainRule(key)
    if (!normalized.includes('*')) {
      if (normalized === wanted) return rule
    } else if (
      wildcard === undefined &&
      domainWildcardMatches(normalized, wanted)
    ) {
      wildcard = rule
    }
  }
  return wildcard
}

/** densable Ff */
function ruleFieldValue(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object') return String(value)
  return null
}

/**
 * densable wg — `field:pattern` rule contents matched against input fields.
 * Tip ToolPermissionContext has no `toolAliases`, so the `pV` proxy arm is
 * empty; the Skill and familyParent arms never apply to these tools.
 */
function matchFieldRule(
  context: ToolPermissionContext,
  tool: RuleTool,
  input: RuleInput,
  behavior: PermissionBehavior,
): PermissionRule | null {
  for (const [content, rule] of getRuleByContentsForToolName(
    context,
    tool.name,
    behavior,
  )) {
    const sep = content.indexOf(':')
    if (sep <= 0) continue
    const key = content.slice(0, sep).trim()
    const pattern = content.slice(sep + 1).trim()
    if (key === '' || pattern === '') continue
    if (key === tool.ruleContentField) continue
    const field =
      key === DEVICE_FIELD &&
      !Object.hasOwn(input, key) &&
      Object.hasOwn(input, HOST_FIELD)
        ? HOST_FIELD
        : key
    if (!Object.hasOwn(input, field)) continue
    const value = ruleFieldValue(input[field])
    if (value === null) continue
    if (globMatches(pattern, value.trim())) return rule
  }
  return null
}

/** densable Bo / P2 (non-MCP, no alias proxy) */
function wholeToolRuleMatches(name: string, rule: PermissionRule): boolean {
  if (rule.ruleValue.ruleContent !== undefined) return false
  const ruleName = rule.ruleValue.toolName
  if (ruleName === name) return true
  return ruleName.includes('*') && globMatches(ruleName, name)
}

/** densable Ms */
function wholeToolDenyRule(
  context: ToolPermissionContext,
  tool: RuleTool,
): PermissionRule | null {
  return (
    getDenyRules(context).find(rule => wholeToolRuleMatches(tool.name, rule)) ??
    null
  )
}

/** densable zd */
function wholeToolAskRule(
  context: ToolPermissionContext,
  tool: RuleTool,
): PermissionRule | null {
  return (
    getAskRules(context).find(rule => wholeToolRuleMatches(tool.name, rule)) ??
    null
  )
}

/** densable c */
function asPlainObject(value: unknown): RuleInput | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RuleInput)
    : null
}

/** densable n */
function omitKey(input: RuleInput, key: string): RuleInput {
  const { [key]: _omitted, ...rest } = input
  return rest
}

/** densable U4e */
function familyRuleInput(
  family: 'comments' | 'data' | 'check',
  input: unknown,
): unknown {
  const obj = asPlainObject(input)
  if (obj === null) return input
  const action = obj.action
  if (family === 'comments') {
    switch (action) {
      case 'comments':
        return { ...obj, action: 'read' }
      case 'watch':
        return { ...obj, action: 'watch' }
      case 'unwatch':
        return { ...obj, action: 'watch', on: false }
      case 'status':
        return { ...omitKey(obj, 'url'), action: 'watch' }
      case 'resume_replies':
        return { ...obj, action: 'watch', replies: true }
      default:
        return input
    }
  }
  if (family === 'data') {
    if (
      (action === 'read_db' || action === 'write_db') &&
      typeof obj.db_op === 'string'
    ) {
      return { ...omitKey(obj, 'db_op'), action: obj.db_op }
    }
    return input
  }
  return input
}

/** densable oKe */
function familyRuleTarget(
  ruleContentField: string | undefined,
  input: { action?: unknown },
): { tool: RuleTool; input: RuleInput } | undefined {
  const action = input.action
  const family =
    typeof action === 'string' && Object.hasOwn(ACTION_FAMILY, action)
      ? ACTION_FAMILY[action]
      : undefined
  if (family === undefined) return undefined
  return {
    tool: { name: FAMILY_TOOL_NAME[family], ruleContentField },
    input: asPlainObject(familyRuleInput(family, input)) ?? {},
  }
}

/** densable m */
function readRuleInputs(
  url: unknown,
  prompt: string | undefined,
  page?: unknown,
): { webFetch: RuleInput; artifact: RuleInput } {
  const p = prompt ?? DEFAULT_READ_PROMPT
  return {
    webFetch: { url, prompt: p },
    artifact: {
      action: 'read',
      url,
      prompt: p,
      ...(page !== undefined && { page }),
    },
  }
}

/** densable M1n */
export function matchWebFetchRule(
  context: ToolPermissionContext,
  ref: ArtifactRef,
  url: unknown,
  behavior: PermissionBehavior,
  read: ArtifactReadRuleOpts | undefined,
): PermissionRule | null {
  const fieldRule =
    read === undefined
      ? null
      : matchFieldRule(
          context,
          WEB_FETCH_RULE_TOOL,
          readRuleInputs(url, read.prompt).webFetch,
          behavior,
        )
  if (fieldRule !== null) return fieldRule
  const rules = getRuleByContentsForToolName(
    context,
    WEB_FETCH_TOOL_NAME,
    behavior,
  )
  if (rules.size === 0) return null
  const hosts = new Set([
    new URL(artifactViewerUrl(ref)).hostname,
    new URL(artifactFrameOrigin(ref)).hostname,
  ])
  if (typeof url === 'string') {
    try {
      hosts.add(new URL(url).hostname)
    } catch {
      /* densable M1n — unparseable url adds no host */
    }
  }
  for (const host of hosts) {
    const rule = findDomainRule(rules, `domain:${host}`)
    if (rule !== undefined) return rule
  }
  return null
}

/**
 * densable a_ (`artifactReadRule`) — WebFetch rules (field or `domain:`)
 * first, then `url:` (and, for copies, `from_url:`) rule contents on Artifact
 * and on the action's family tool (ArtifactComments / ArtifactData /
 * ArtifactCheck).
 */
export function artifactReadRule(
  context: ToolPermissionContext,
  parsed: ArtifactRef,
  url: unknown,
  behavior: PermissionBehavior,
  opts: ArtifactLinkRuleOpts = {},
): PermissionRule | null {
  const familyTool = familyRuleTarget(undefined, { action: opts.action })?.tool
    .name
  const webFetchRule = matchWebFetchRule(
    context,
    parsed,
    url,
    behavior,
    opts.read,
  )
  if (webFetchRule !== null) return webFetchRule
  for (const toolName of [
    ARTIFACT_TOOL_NAME,
    ...(familyTool ? [familyTool] : []),
  ]) {
    const rules = getRuleByContentsForToolName(context, toolName, behavior)
    const rule =
      matchArtifactUrlRule(rules, parsed, url) ??
      (opts.copySource === true
        ? matchArtifactUrlRule(rules, parsed, url, 'from_url')
        : null)
    if (rule !== null) return rule
  }
  return null
}

/** densable g */
function withoutNarrowingDenyRules(
  context: ToolPermissionContext,
): ToolPermissionContext {
  const deny = context.alwaysDenyRules
  if (!NARROWING_DENY_SOURCES.some(source => (deny[source]?.length ?? 0) > 0)) {
    return context
  }
  const kept: ToolPermissionRulesBySource = {}
  for (const [source, rules] of Object.entries(deny) as [
    PermissionRuleSource,
    readonly string[] | undefined,
  ][]) {
    if (!NARROWING_DENY_SOURCES.includes(source) && rules !== undefined) {
      kept[source] = [...rules]
    }
  }
  return { ...context, alwaysDenyRules: kept }
}

/** densable p */
function matchActionFieldRule(
  context: ToolPermissionContext,
  tool: RuleTool,
  input: RuleInput,
  behavior: PermissionBehavior,
): PermissionRule | null {
  const { action, ...rest } = input
  return (
    (action === undefined
      ? null
      : matchFieldRule(
          withoutNarrowingDenyRules(context),
          tool,
          { action },
          behavior,
        )) ?? matchFieldRule(context, tool, rest, behavior)
  )
}

/** densable M1n alias. */
export const M1n = matchWebFetchRule

/**
 * densable SAr — Artifact whole-tool / `field:` / `url:` match for page `read`
 * (no WebFetch, no family tool). Gold runs this before the ownership probe.
 */
export function artifactPageReadRule(
  context: ToolPermissionContext,
  parsed: ArtifactRef,
  url: unknown,
  behavior: PermissionBehavior,
  read: ArtifactReadRuleOpts = {},
): PermissionRule | null {
  const stripped = withoutNarrowingDenyRules(context)
  const whole =
    behavior === 'deny'
      ? wholeToolDenyRule(stripped, ARTIFACT_RULE_TOOL)
      : wholeToolAskRule(stripped, ARTIFACT_RULE_TOOL)
  return (
    whole ??
    matchActionFieldRule(
      context,
      ARTIFACT_RULE_TOOL,
      readRuleInputs(url, read.prompt, read.page).artifact,
      behavior,
    ) ??
    matchArtifactUrlRule(
      getRuleByContentsForToolName(context, ARTIFACT_TOOL_NAME, behavior),
      parsed,
      url,
    )
  )
}

/** densable SAr alias. */
export const SAr = artifactPageReadRule

/** densable a_ alias. */
export const a_ = artifactReadRule

/**
 * densable Ow (`artifactCallReadRule`) — whole-tool Artifact rule, then
 * `field:` rules on Artifact, then the action's family tool, then
 * {@link artifactReadRule}. Narrowing-source deny rules (`toolsNarrowing` /
 * `command`) are ignored for whole-tool and `action:` matches.
 */
export function artifactCallReadRule(
  context: ToolPermissionContext,
  parsed: ArtifactRef,
  url: unknown,
  behavior: PermissionBehavior,
  opts: ArtifactActionRuleOpts,
): PermissionRule | null {
  const input: RuleInput = {
    ...opts.fields,
    ...(opts.read !== undefined
      ? readRuleInputs(url, opts.read.prompt, opts.read.page).artifact
      : {
          ...(typeof opts.action === 'string' && { action: opts.action }),
          url: artifactViewerUrl(parsed),
        }),
  }
  const family = familyRuleTarget(ARTIFACT_RULE_TOOL.ruleContentField, input)
  const stripped = withoutNarrowingDenyRules(context)
  const wholeTool = (tool: RuleTool): PermissionRule | null =>
    behavior === 'deny'
      ? wholeToolDenyRule(stripped, tool)
      : opts.wholeToolAskAnswered === true && tool.name === ARTIFACT_TOOL_NAME
        ? null
        : wholeToolAskRule(stripped, tool)
  return (
    wholeTool(ARTIFACT_RULE_TOOL) ??
    matchActionFieldRule(context, ARTIFACT_RULE_TOOL, input, behavior) ??
    (family === undefined
      ? null
      : (wholeTool(family.tool) ??
        matchActionFieldRule(context, family.tool, family.input, behavior))) ??
    artifactReadRule(context, parsed, url, behavior, opts)
  )
}

/** densable Ow alias. */
export const Ow = artifactCallReadRule

/** densable tP */
function ruleSourceLabel(source: PermissionRuleSource): string {
  switch (source) {
    case 'userSettings':
      return 'user settings'
    case 'projectSettings':
      return 'shared project settings'
    case 'localSettings':
      return 'project local settings'
    case 'flagSettings':
      return 'command line arguments'
    case 'policySettings':
      return 'enterprise managed settings'
    case 'cliArg':
      return 'CLI argument'
    case 'command':
      return 'command configuration'
    case 'session':
      return 'current session'
    case 'toolsNarrowing':
      return 'CLI tool narrowing'
    case 'mcpServerPolicy':
      return 'MCP server policy'
    case 'hostCredential':
      return 'cloud-session credential guard'
  }
}

/** densable mNe (`denyRulePhrase`) */
export function denyRulePhrase(rule: PermissionRule): string {
  return `the ${permissionRuleValueToString(rule.ruleValue)} deny rule from ${ruleSourceLabel(rule.source)}`
}

/** densable mNe alias. */
export const mNe = denyRulePhrase

/** densable k (qR chunk) */
export function artifactReadDeniedMessage(
  rule: PermissionRule,
  detail = '',
  copySource = false,
): string {
  const subject = copySource
    ? 'Copying from this artifact is'
    : rule.ruleValue.toolName === WEB_FETCH_TOOL_NAME
      ? 'Artifact reads are'
      : 'Reading this artifact is'
  const suffix = detail === '' ? '' : ` \u2014 ${detail}`
  return `${subject} blocked by ${denyRulePhrase(rule)}${suffix}`
}

/** densable qR — matched read rule → deny result citing it. */
export function artifactReadRuleDenial(
  rule: PermissionRule,
  detail = '',
  copySource = false,
): PermissionDenyDecision {
  return {
    behavior: 'deny',
    message: `${artifactReadDeniedMessage(rule, detail, copySource)}.`,
    decisionReason: { type: 'rule', rule },
  }
}

/** densable qR alias. */
export const qR = artifactReadRuleDenial

/** densable Bte */
export function artifactAskRuleSuffix(rule: PermissionRule): string {
  return rule.ruleValue.toolName === WEB_FETCH_TOOL_NAME
    ? ` (your ${WEB_FETCH_TOOL_NAME} ask rule covers artifact reads)`
    : ` (your ${rule.ruleValue.toolName} ask rule covers this url)`
}

/** densable Bte alias. */
export const Bte = artifactAskRuleSuffix

/**
 * densable read_file / read_asset ask note:
 * `Ae.ruleValue.toolName===_r ? "Your WebFetch ask rule covers artifact
 * reads." : "Your Artifact ask rule covers this link."`
 */
export function artifactAskRuleNote(rule: PermissionRule): string {
  return rule.ruleValue.toolName === WEB_FETCH_TOOL_NAME
    ? `Your ${WEB_FETCH_TOOL_NAME} ask rule covers artifact reads.`
    : `Your ${ARTIFACT_TOOL_NAME} ask rule covers this link.`
}

/** densable Tz */
const SKILL_RULE_PREFIX = 'skill__'

/**
 * Permission context as gold `de` returns it: `modeBeforeRewrite` records the
 * session mode when a request rewrite demoted it.
 */
export type ArtifactToolPermissionContext = ToolPermissionContext & {
  readonly modeBeforeRewrite?: PermissionMode
}

type PermissionContextSource = Pick<
  ToolUseContext,
  'getAppState' | 'permissionLayers' | 'forRemoteExecution'
>

/** densable g (chunk-cx175mfd) */
function isSkillAllowRule(rule: string): boolean {
  return (
    rule === SKILL_TOOL_NAME ||
    rule.startsWith(`${SKILL_TOOL_NAME}(`) ||
    rule.startsWith(SKILL_RULE_PREFIX)
  )
}

/** densable h (chunk-cx175mfd) — park Skill allow rules in strippedDangerousRules. */
function withoutSkillAllowRules(
  context: ToolPermissionContext,
): ToolPermissionContext {
  let changed = false
  const allow: ToolPermissionRulesBySource = {}
  const stripped: ToolPermissionRulesBySource = {}
  for (const [source, rules] of Object.entries(
    context.strippedDangerousRules ?? {},
  ) as [PermissionRuleSource, readonly string[] | undefined][]) {
    if (rules !== undefined) stripped[source] = [...rules]
  }
  for (const [source, rules] of Object.entries(context.alwaysAllowRules) as [
    PermissionRuleSource,
    readonly string[] | undefined,
  ][]) {
    if (rules === undefined) continue
    const kept = rules.filter(rule => !isSkillAllowRule(rule))
    if (kept.length !== rules.length) {
      changed = true
      for (const rule of rules) {
        if (!isSkillAllowRule(rule)) continue
        const parked = (stripped[source] ??= [])
        if (!parked.includes(rule)) parked.push(rule)
      }
    }
    allow[source] = kept
  }
  if (!changed) return context
  return {
    ...context,
    alwaysAllowRules: allow,
    strippedDangerousRules: stripped,
  }
}

/** densable m (chunk-cx175mfd) */
function withRewrittenMode(
  mode: PermissionMode,
  context: ArtifactToolPermissionContext,
): ArtifactToolPermissionContext {
  return {
    ...context,
    mode,
    modeBeforeRewrite: context.modeBeforeRewrite ?? context.mode,
  }
}

/** densable S (chunk-cx175mfd) */
function forRemoteExecutionRewrite(
  source: PermissionContextSource,
  context: ArtifactToolPermissionContext,
): ArtifactToolPermissionContext {
  if (source.forRemoteExecution !== true) return context
  const { blockReadsOutsideWorkingDirectories: _dropped, ...rest } = context
  return context.mode === 'acceptEdits' || context.mode === 'bypassPermissions'
    ? withRewrittenMode('default', rest)
    : rest
}

/**
 * densable de (`getToolPermissionContext`) — the tool-use context's effective
 * permission context: appState context, Skill allow rules withheld under
 * `pollEventDeliveryGuard` (whose `allowed_tools` layers are also skipped),
 * `permissionLayers` last-wins, then the remote-execution rewrite.
 *
 * Gold `y` also rewrites `auto` from `permissionModeAtRequest` (`b`) and for
 * `forPromptShellCommand` (`A`); tip ToolUseContext carries neither field, so
 * both take gold's absent path.
 */
export function getToolPermissionContext(
  source: PermissionContextSource,
): ArtifactToolPermissionContext {
  const appState = source.getAppState()
  let base = appState.toolPermissionContext
  const guarded =
    (base as { pollEventDeliveryGuard?: unknown }).pollEventDeliveryGuard ===
    true
  if (guarded) base = withoutSkillAllowRules(base)
  const layered = getToolPermissionContextFromLayers({
    getAppState: () => ({ ...appState, toolPermissionContext: base }),
    permissionLayers: guarded
      ? source.permissionLayers?.filter(layer => layer.kind !== 'allowed_tools')
      : source.permissionLayers,
  })
  return forRemoteExecutionRewrite(source, layered)
}

/** densable de alias. */
export const de = getToolPermissionContext

/**
 * densable C — page-read admit window: not plan, and not auto (current or
 * rewritten) unless remote-cowork egress is denied or outside-org person ask.
 */
export function C(
  context: PermissionContextSource,
  parsed: ArtifactRef,
): boolean {
  const { mode, modeBeforeRewrite } = getToolPermissionContext(context)
  return (
    mode !== 'plan' &&
    ((mode !== 'auto' && modeBeforeRewrite !== 'auto') ||
      isRemoteCoworkContentHostDenied(parsed) ||
      isOutsideOrgPersonAsk(parsed.slug))
  )
}

/**
 * densable Otn — C and not a Fee-notice delegated-off read, and no Ow deny/ask.
 */
export function Otn(
  context: PermissionContextSource &
    Pick<ToolUseContext, 'getAppState' | 'toolUseId' | 'permissionLayers'>,
  parsed: ArtifactRef,
  url: unknown,
  read: ArtifactReadRuleOpts = {},
): boolean {
  const perms = getToolPermissionContext(context)
  const opts = { action: 'read', read }
  const notice = Fee(parsed.slug) && !isDelegatedObservation(getAgentContext())
  return (
    C(context, parsed) &&
    !notice &&
    artifactCallReadRule(perms, parsed, url, 'deny', opts) === null &&
    artifactCallReadRule(perms, parsed, url, 'ask', opts) === null
  )
}

/**
 * densable Aat — jjt(artifactRegistries) && Otn. Gold `n.artifactRegistries`;
 * tip analog is AppState maps via artifactRegistriesFromContext.
 */
export function Aat(
  context: PermissionContextSource &
    Pick<ToolUseContext, 'getAppState' | 'toolUseId' | 'permissionLayers'> & {
      artifactRegistries?: ArtifactRegistries
    },
  parsed: ArtifactRef,
  url: unknown,
  read: ArtifactReadRuleOpts = {},
): boolean {
  return (
    jjt(artifactRegistriesFromContext(context), parsed.slug) &&
    Otn(context, parsed, url, read)
  )
}
