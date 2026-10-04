/**
 * densable `pp`/`Tl`/`mp`/`gp` — Artifact publish ids in the child
 * stream-json trace, then URLs on matching non-error tool_results.
 */
import {
  OFFICIAL_ARTIFACT_TOOL_NAME,
  parseArtifactUrl,
} from '../../artifactUrl.js'

/** densable `XTe`. */
export const EVAL_STUB_ARTIFACT_URL_PREFIX = 'eval-stub://artifact/'

/** densable `Bn` — stub payload directory names. */
export const EVAL_STUB_SLUG_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const STUB_URL_RE = new RegExp(
  `^${EVAL_STUB_ARTIFACT_URL_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(${EVAL_STUB_SLUG_RE.source.slice(1, -1)})(?:[/?#]|$)`,
)

export type EvalArtifactPublish = {
  url: string
  slug: string
  env: string
}

function messageContent(event: unknown): unknown[] {
  if (!event || typeof event !== 'object') return []
  const rec = event as Record<string, unknown>
  const message = rec.message
  if (!message || typeof message !== 'object') return []
  const content = (message as Record<string, unknown>).content
  return Array.isArray(content) ? content : []
}

function isPublishToolUse(block: unknown): block is {
  type: 'tool_use'
  id: string
  name: string
  input?: { action?: string }
} {
  if (!block || typeof block !== 'object') return false
  const rec = block as Record<string, unknown>
  if (rec.type !== 'tool_use') return false
  if (typeof rec.id !== 'string') return false
  if (rec.name !== OFFICIAL_ARTIFACT_TOOL_NAME) return false
  if (rec.input === undefined) return true
  if (rec.input === null || typeof rec.input !== 'object') return false
  const action = (rec.input as Record<string, unknown>).action
  return action === undefined || action === 'publish'
}

function isOkToolResult(
  block: unknown,
): block is { type: 'tool_result'; tool_use_id: string; is_error?: boolean } {
  if (!block || typeof block !== 'object') return false
  const rec = block as Record<string, unknown>
  if (rec.type !== 'tool_result') return false
  if (typeof rec.tool_use_id !== 'string') return false
  return rec.is_error !== true
}

function toolResultUrl(event: unknown): string | undefined {
  if (!event || typeof event !== 'object') return undefined
  const rec = event as Record<string, unknown>
  const result = rec.tool_use_result
  if (!result || typeof result !== 'object') return undefined
  const url = (result as Record<string, unknown>).url
  return typeof url === 'string' ? url : undefined
}

/** densable `_$e` — stub slug from `eval-stub://artifact/<uuid>`. */
export function parseEvalStubArtifactUrl(url: string): { slug: string } | null {
  const match = url.match(STUB_URL_RE)
  const slug = match?.[1]
  return slug ? { slug } : null
}

/** densable `pp`. */
export function artifactPublishToolUseIds(events: unknown[]): Set<string> {
  const ids = new Set<string>()
  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    if ((event as Record<string, unknown>).type !== 'assistant') continue
    for (const block of messageContent(event)) {
      if (isPublishToolUse(block)) ids.add(block.id)
    }
  }
  return ids
}

function* corroboratedPublishResults(
  events: unknown[],
): Generator<{ event: unknown }> {
  const ids = artifactPublishToolUseIds(events)
  if (ids.size === 0) return
  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    if ((event as Record<string, unknown>).type !== 'user') continue
    for (const block of messageContent(event)) {
      if (!isOkToolResult(block) || !ids.has(block.tool_use_id)) continue
      yield { event }
    }
  }
}

/**
 * densable `mp` — unique Artifact publish URLs from matching tool_results.
 */
export function collectEvalArtifactPublishes(
  events: unknown[],
): EvalArtifactPublish[] {
  const seen = new Set<string>()
  const out: EvalArtifactPublish[] = []
  for (const { event } of corroboratedPublishResults(events)) {
    const url = toolResultUrl(event)
    if (url === undefined) continue
    const parsed = parseArtifactUrl(url)
    if (!parsed || seen.has(parsed.slug)) continue
    seen.add(parsed.slug)
    out.push({ url, slug: parsed.slug, env: parsed.env })
  }
  return out
}

/**
 * densable `gp` — stub slugs among corroborated publish URLs.
 */
export function corroboratedStubSlugs(events: unknown[]): Set<string> {
  const slugs = new Set<string>()
  for (const { event } of corroboratedPublishResults(events)) {
    const url = toolResultUrl(event)
    if (url === undefined) continue
    const stub = parseEvalStubArtifactUrl(url)
    if (stub) slugs.add(stub.slug)
  }
  return slugs
}
