/**
 * densable mxm / dbr / hxm / zMw — remote MCP watch_url / unwatch_url (2.1.239).
 * Source: gold-mxm-239 / gold-dbr-unwatch-239 / gold-nxm-239 / gold-cxm-239.
 *
 * Dial path is injectable (densable axm → Qpe ensureConnectedClient).
 * Tip hosts wire `setWatchUrlDeps({ callTool })` when a webhook-triggers MCP
 * client is connected (CLAUDE_CODE_REMOTE durable subscribe).
 */
import { publishDurableRegistry } from './durable.js'
import { un } from './store.js'

/** densable dxm */
export const WATCH_URL_TOOL = 'watch_url'
/** densable unwatch via mxm */
export const UNWATCH_URL_TOOL = 'unwatch_url'

/** densable GMw + VMw */
export const WEBHOOK_TRIGGERS_PATH_PREFIX =
  '/integrations/v1/code/webhook-triggers/'
export const WEBHOOK_FIRE_SUFFIX = '/fire'

/** densable YMw */
export const TRIGGER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type WatchUrlToolResult = {
  isError: boolean
  text: string
}

export type WatchUrlMinted = {
  url: string
  triggerId: string
  sealedSecret: string
}

export type WatchUrlCallTool = (
  name: string,
  args: Record<string, unknown>,
) => Promise<WatchUrlToolResult | null>

export type WatchUrlDeps = {
  callTool?: WatchUrlCallTool
}

let watchUrlDeps: WatchUrlDeps = {}

export function setWatchUrlDeps(deps: WatchUrlDeps): void {
  watchUrlDeps = deps
}

export function resetWatchUrlDepsForTests(): void {
  watchUrlDeps = {}
}

/** densable HGi */
export function extractLabeledField(
  text: string,
  label: string,
): string | null {
  const m = new RegExp(`^${label}:\\s*(\\S+)`, 'm').exec(text)
  return m?.[1] ?? null
}

/** densable zMw */
export function parseWatchUrlMint(text: string): WatchUrlMinted | null {
  const url = extractLabeledField(text, 'url')
  const triggerId = extractLabeledField(text, 'trigger_id')
  const sealedSecret = extractLabeledField(text, 'sealed_secret')
  if (!url || !triggerId || !sealedSecret) return null
  return { url, triggerId, sealedSecret }
}

/** densable WMw */
export function extractTriggerId(text: string): string | null {
  return extractLabeledField(text, 'trigger_id')
}

/**
 * densable XMw — https webhook fire URL must match path + trigger id.
 */
export function isValidWebhookFireUrl(url: string, triggerId: string): boolean {
  if (!TRIGGER_ID_RE.test(triggerId)) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return (
    parsed.protocol === 'https:' &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.search === '' &&
    parsed.hash === '' &&
    parsed.pathname ===
      `${WEBHOOK_TRIGGERS_PATH_PREFIX}${triggerId}${WEBHOOK_FIRE_SUFFIX}`
  )
}

export function isTriggerLimitMessage(text: string): boolean {
  return (
    text.includes('trigger limit reached') ||
    text.includes('maximum number of webhook triggers')
  )
}

export function isNoOriginatorMessage(text: string): boolean {
  return text.includes('a session with an originator account')
}

export function classifyWatchUrlWithhold(
  text: string,
): 'tool_not_offered' | 'org_not_enabled' | null {
  if (text.includes('tool is not available to this session')) {
    return 'tool_not_offered'
  }
  if (
    text.includes('tool is not enabled for this organization') ||
    text.includes('Session webhooks are not enabled for this organization')
  ) {
    return 'org_not_enabled'
  }
  return null
}

/** densable mxm — call watch_url / unwatch_url via injected dialer. */
export async function callWatchUrlTool(
  name: string,
  args: Record<string, unknown>,
): Promise<WatchUrlToolResult | null> {
  const call = watchUrlDeps.callTool
  if (!call) return null
  try {
    return await call(name, args)
  } catch {
    return null
  }
}

/** densable: mxm(s, dxm, {}) */
export async function mintWatchUrl(): Promise<WatchUrlToolResult | null> {
  return callWatchUrlTool(WATCH_URL_TOOL, {})
}

/** densable dbr */
export async function unwatchUrl(triggerId: string): Promise<boolean> {
  const r = await callWatchUrlTool(UNWATCH_URL_TOOL, { trigger_id: triggerId })
  return r !== null && !r.isError
}

/**
 * densable hxm — release durable orphanTriggers via unwatch_url.
 */
export async function releaseOrphanTriggers(): Promise<number> {
  const { durable } = un()
  const orphans = [...durable.orphanTriggers]
  if (orphans.length === 0) return 0
  const results = await Promise.all(orphans.map(id => unwatchUrl(id)))
  let failed = 0
  orphans.forEach((id, i) => {
    if (results[i]) durable.orphanTriggers.delete(id)
    else failed++
  })
  publishDurableRegistry()
  return failed
}

/**
 * Helper: text from MCP CallToolResult-like content.
 */
export function mcpResultToText(result: {
  content?: unknown
  isError?: boolean
}): string {
  const c = result.content
  if (typeof c === 'string') return c
  if (!Array.isArray(c)) return ''
  return c
    .map(part => {
      if (typeof part === 'string') return part
      if (
        part &&
        typeof part === 'object' &&
        'type' in part &&
        (part as { type?: string }).type === 'text' &&
        'text' in part
      ) {
        return String((part as { text: unknown }).text ?? '')
      }
      return ''
    })
    .join('\n')
}
