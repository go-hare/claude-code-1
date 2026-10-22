/**
 * densable 2.1.289 Artifact quickstart (`iy` / `Ace` / `tl`) analog.
 * Semantic names only — do not export minify iy/Qps/yjn/Ace/tl.
 */
import { mkdir, writeFile } from 'fs/promises'
import { join, resolve, sep } from 'path'
import type { ToolUseContext } from 'src/Tool.js'
import { logEvent } from 'src/services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { DL } from 'src/services/artifactAutoReact/frameDl.js'
import { isOfficialClaudeAiConnector } from 'src/services/mcp/officialClaudeAiConnector.js'
import type { MCPServerConnection } from 'src/services/mcp/types.js'
import {
  fetchTypeCatalog,
  isArtifactMultiFileOn,
  isArtifactQuickstartOn,
  type QuickstartTypeRow,
} from './quickstartCatalog.js'
import {
  designSystemsListPermissionRule,
  formatDesignSystemsRuledNote,
  formatTypesRuledNote,
  hasPreToolUseHook,
  type PreToolUseHookContext,
  typesListPermissionRule,
} from './quickstartRules.js'
import {
  extrasFromStartKit,
  isQuickstartNone,
  recordQuickstartRan,
  setQuickstartGuidanceToolUseId,
} from './quickstartSession.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import {
  getScratchpadDir,
  isScratchpadEnabled,
} from 'src/utils/permissions/filesystem.js'

type QuickstartToolData = {
  id: string
  url: string
  expiresAt: string
  error?: string
  quickstart?: unknown
}

export const QUICKSTART_OTHER_TYPE_CAP = 50
const DOCS_CONNECTOR_SERVER_NAMES = new Set(['claudedocs', 'claudepages'])
const INTENT_TITLES: Record<
  'slides' | 'design' | 'document',
  readonly string[]
> = {
  slides: ['Slides'],
  design: ['Design'],
  document: ['Docs'],
}
const DASHBOARD_TITLES = ['Dashboard'] as const
const DESIGN_SYSTEM_TITLES = ['Design System'] as const
export type QuickstartIntent = 'document' | 'slides' | 'design' | 'other'

export type QuickstartInput = {
  action: 'quickstart'
  intent: QuickstartIntent
  design_systems?: boolean
}

export const QUICKSTART_UNAVAILABLE =
  'quickstart is not available in this session — list the Artifact types with their own call instead'

/** Gold `$u.call` 4th arg `r=!0` — iy pipelineRan. */
const QUICKSTART_PIPELINE_RAN = true

/**
 * Gold `$u.call` `throw new Pe(_u,"quickstart_unavailable")` analog.
 * Semantic name only — do not export minify Pe.
 */
export class ArtifactQuickstartUnavailableError extends Error {
  readonly reasonCode = 'quickstart_unavailable'
  constructor() {
    super(QUICKSTART_UNAVAILABLE)
    this.name = 'ArtifactInputError'
  }
}

/** Gold `sy` analog. */
const QUICKSTART_INPUT_KEYS = new Set(['action', 'intent', 'design_systems'])

const INTENT_LABEL: Record<QuickstartIntent, string> = {
  slides: 'a slide deck',
  design: 'a design',
  document: 'a document',
  other: 'a page',
}

const FONT_SKIP =
  /fonts\.googleapis\.com|fonts\.gstatic\.com|\.(?:woff2?|ttf|otf|eot)$/i

function wantsDesignSystems(input: { design_systems?: boolean }): boolean {
  return input.design_systems !== false
}

/** Gold `ty` analog. */
export function catalogReasonIsUnavailable(
  reason: string | undefined,
  intent: QuickstartIntent,
): boolean {
  return (
    reason === 'forbidden' ||
    reason === 'ccr_credential_refused' ||
    (reason === 'denied' && intent === 'document')
  )
}

/** Gold `$u.validateInput` analog. */
export function validateQuickstartInput(input: {
  action?: unknown
  intent?: unknown
  design_systems?: unknown
  [key: string]: unknown
}): { result: true } | { result: false; message: string; errorCode: number } {
  if (input.action !== 'quickstart') {
    return { result: true }
  }
  if (!isArtifactQuickstartOn()) {
    return { result: false, message: QUICKSTART_UNAVAILABLE, errorCode: 8 }
  }
  const extra = Object.keys(input).filter(
    key => !QUICKSTART_INPUT_KEYS.has(key) && input[key] !== undefined,
  )
  if (extra.length > 0) {
    return {
      result: false,
      message: `action "quickstart" takes only \`intent\` and \`design_systems\` — remove ${extra.join(', ')}.`,
      errorCode: 8,
    }
  }
  if (
    input.intent !== 'document' &&
    input.intent !== 'slides' &&
    input.intent !== 'design' &&
    input.intent !== 'other'
  ) {
    return {
      result: false,
      message:
        'action "quickstart" requires `intent`: one of "document", "slides", "design", "other".',
      errorCode: 7,
    }
  }
  if (
    input.design_systems !== undefined &&
    typeof input.design_systems !== 'boolean'
  ) {
    return {
      result: false,
      message: '`design_systems` is true or false — omit it for true.',
      errorCode: 8,
    }
  }
  return { result: true }
}

/** Gold `ry` / `$u.toAutoClassifierInput` analog. */
export function classifyQuickstartInput(input: {
  intent?: unknown
  design_systems?: boolean
}): string {
  const intent =
    input.intent === 'document' ||
    input.intent === 'slides' ||
    input.intent === 'design' ||
    input.intent === 'other'
      ? input.intent
      : 'unrecognized'
  if (intent === 'document') {
    return 'quickstart (read-only, intent: document): lists the published Artifact types — titles and descriptions their publishers wrote'
  }
  const startKit = isArtifactStartKitOn()
  if (!wantsDesignSystems(input)) {
    const kit =
      startKit && (intent === 'slides' || intent === 'design')
        ? "; where they can be, the matched type's published files are saved to the session's scratchpad and listed, skipped where reading them would need approval"
        : ''
    return `quickstart (read-only, intent: ${intent}, design systems left out): lists the published Artifact types — titles and descriptions their publishers wrote${kit}`
  }
  const readme =
    intent === 'slides' || intent === 'design'
      ? ` — and reads the README of the account's default design system, if there is one, skipped where that read would need approval${
          startKit
            ? "; where that system's published files, and the matched type's, can be saved to the session's scratchpad, they are listed instead of the README, each skipped where reading it would need approval"
            : ''
        }`
      : ''
  return `quickstart (read-only, intent: ${intent}): lists the published Artifact types and the design systems this user can open — titles and descriptions other people in the organization wrote${readme}`
}

/** Gold `$u.description` analog. */
export function describeQuickstartLookup(input: {
  intent?: unknown
  design_systems?: boolean
}): string {
  const intent =
    input.intent === 'document' ||
    input.intent === 'slides' ||
    input.intent === 'design' ||
    input.intent === 'other'
      ? input.intent
      : undefined
  if (intent === 'document') {
    return 'Look up what is needed before making a document: the published Artifact types — titles and descriptions their publishers wrote will be read into the conversation (read-only).'
  }
  const noun = intent === undefined ? 'a new artifact' : INTENT_LABEL[intent]
  const startKit = isArtifactStartKitOn()
  if (!wantsDesignSystems(input)) {
    const kit =
      startKit && (intent === 'slides' || intent === 'design')
        ? " If possible, the type's published files are also saved to this session's scratchpad and listed."
        : ''
    return `Look up what is needed before making ${noun}: the published Artifact types — titles and descriptions their publishers wrote will be read into the conversation (read-only; design systems left out).${kit}`
  }
  const readme = intent === 'other' ? '' : ", and the default one's README"
  const titles =
    intent === 'other' ? ' and descriptions' : ', descriptions and README text'
  const kit =
    intent === 'other' || !startKit
      ? ''
      : " If possible, the default design system's files and the type's are saved to this session's scratchpad and listed instead of that README."
  return `Look up what is needed before making ${noun}: the published Artifact types and the design systems the user can open${readme} — titles${titles} other people in the organization wrote will be read into the conversation (read-only).${kit}`
}

/** Gold `$u.getToolUseSummary` analog. */
export function summarizeQuickstartUse(input: {
  intent?: unknown
  design_systems?: boolean
}): string {
  const intent =
    input.intent === 'document' ||
    input.intent === 'slides' ||
    input.intent === 'design' ||
    input.intent === 'other'
      ? input.intent
      : 'unrecognized'
  const leftOut =
    intent === 'document' || wantsDesignSystems(input)
      ? ''
      : ', design systems left out'
  return `quickstart (read-only, intent: ${intent}${leftOut})`
}

function oauthOriginAndToken(): { origin: string; token?: string } {
  let origin = 'https://claude.ai'
  try {
    const { getOauthConfig } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('src/constants/oauth.js') as typeof import('src/constants/oauth.js')
    origin = getOauthConfig().CLAUDE_AI_ORIGIN ?? origin
  } catch {
    /* keep default */
  }
  let token: string | undefined
  try {
    const { getClaudeAIOAuthTokens } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('src/utils/auth.js') as typeof import('src/utils/auth.js')
    token = getClaudeAIOAuthTokens()?.accessToken
  } catch {
    token = undefined
  }
  return { origin, token }
}

function normalizeTypeTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{Z}\p{Cc}\p{Cf}\p{Pd}_−]+/gu, ' ')
    .trim()
}

function typeUrlForSlug(slug: string, origin: string): string {
  return new URL(
    `/code/artifact/${slug}`,
    `${origin.replace(/\/$/, '')}/`,
  ).toString()
}

function matchIntentRows(
  rows: QuickstartTypeRow[],
  titles: readonly string[],
): { titled: QuickstartTypeRow[]; one?: QuickstartTypeRow } {
  const wanted = titles.map(normalizeTypeTitle)
  const titled = rows.filter(
    row => !row.untitled && wanted.includes(normalizeTypeTitle(row.title)),
  )
  const core = titled.filter(row => row.tier === 'core')
  const one =
    titled.length === 1 ? titled[0] : core.length === 1 ? core[0] : undefined
  return { titled, one }
}

function mapQuickstartRow(row: QuickstartTypeRow) {
  return {
    title: row.title,
    type_url: row.typeUrl,
    ...(row.description !== undefined ? { description: row.description } : {}),
    ...(row.tier !== undefined ? { tier: row.tier } : {}),
  }
}

function isCoreDocsType(row: QuickstartTypeRow): boolean {
  return (
    row.tier === 'core' &&
    INTENT_TITLES.document.some(
      t => normalizeTypeTitle(row.title) === normalizeTypeTitle(t),
    )
  )
}

/** Gold `cjn` / `JOt` analog — first-party Claude Docs connector attached. */
export function isDocsConnectorAttached(
  clients: readonly MCPServerConnection[] | undefined,
): boolean {
  if (!clients?.length) return false
  return clients.some(client => {
    if (client.type !== 'connected' && client.type !== 'pending') {
      return false
    }
    const serverName = (
      (client.type === 'connected' ? client.serverInfo?.name : undefined) ??
      client.name ??
      ''
    ).toLowerCase()
    const named = DOCS_CONNECTOR_SERVER_NAMES.has(serverName)
    if (client.config.type === 'claudeai-proxy') {
      return isOfficialClaudeAiConnector(client.config) && named
    }
    if (client.config.type === 'sdk') {
      return named
    }
    if (
      isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) &&
      client.config.type === 'http' &&
      client.config.scope === 'dynamic'
    ) {
      return named
    }
    return false
  })
}

/** Gold `_it` analog. */
export function isArtifactStartKitOn(): boolean {
  const env = process.env.CLAUDE_CODE_ARTIFACT_START_KIT
  if (env !== undefined && env !== '') {
    return isEnvTruthy(env)
  }
  return (
    getFeatureValue_CACHED_MAY_BE_STALE<boolean>(
      'tengu_concurrent_candle',
      false,
    ) === true
  )
}

const TYPE_FILE_MAX_CHARS = 20_000
const TYPE_INSTRUCTIONS_FILE = 'SKILL.md'

export { hasPreToolUseHook } from './quickstartRules.js'

async function loadDesignGuidanceText(): Promise<string | undefined> {
  try {
    const { getUseArtifactsSkillBody } = await import(
      'src/skills/bundled/useArtifacts.js'
    )
    const body = getUseArtifactsSkillBody().trim()
    return body || undefined
  } catch {
    return undefined
  }
}

function slugFromArtifactUrl(url: string): string | undefined {
  try {
    const path = new URL(url).pathname
    const m =
      /\/(?:artifact|code\/(?:artifact|frame))\/(?:[A-Za-z0-9_-]*-)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
        path,
      )
    if (m?.[1]) return m[1].toLowerCase()
    const tail = path.split('/').filter(Boolean).at(-1)
    return tail || undefined
  } catch {
    return undefined
  }
}

async function fetchJson(
  url: string,
  token: string | undefined,
  signal: AbortSignal | undefined,
): Promise<{ ok: boolean; status: number; data: unknown; text: string }> {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json, text/plain;q=0.9',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal,
  })
  const text = await res.text()
  let data: unknown = text
  try {
    data = JSON.parse(text) as unknown
  } catch {
    /* keep text */
  }
  return { ok: res.ok, status: res.status, data, text }
}

async function fetchTypeFile(opts: {
  slug: string
  path: string
  origin: string
  token?: string
  signal?: AbortSignal
}): Promise<
  | { kind: 'read'; text: string; clipped: boolean }
  | { kind: 'none' }
  | { kind: 'unavailable'; why: string }
> {
  const encoded = opts.path
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/')
  const url = `${opts.origin}/api/frame/types/${encodeURIComponent(opts.slug)}/files/${encoded}`
  try {
    const res = await fetchJson(url, opts.token, opts.signal)
    if (res.status === 404) return { kind: 'none' }
    if (!res.ok) {
      return {
        kind: 'unavailable',
        why: `the type file could not be read (HTTP ${res.status})`,
      }
    }
    let raw = ''
    if (typeof res.data === 'object' && res.data !== null) {
      const rec = res.data as {
        text?: unknown
        content?: unknown
        path?: unknown
      }
      if (typeof rec.text === 'string') raw = rec.text
      else if (typeof rec.content === 'string') raw = rec.content
    } else if (typeof res.text === 'string') {
      raw = res.text
    }
    if (!raw.trim()) return { kind: 'none' }
    const clipped = raw.length > TYPE_FILE_MAX_CHARS
    const text = clipped ? raw.slice(0, TYPE_FILE_MAX_CHARS) : raw
    return { kind: 'read', text, clipped }
  } catch (error) {
    if (opts.signal?.aborted) throw error
    return {
      kind: 'unavailable',
      why: 'the type file could not be read (network error)',
    }
  }
}

async function fetchTypeFileList(opts: {
  slug: string
  origin: string
  token?: string
  signal?: AbortSignal
}): Promise<string[]> {
  const url = `${opts.origin}/api/frame/types/${encodeURIComponent(opts.slug)}`
  try {
    const res = await fetchJson(url, opts.token, opts.signal)
    if (!res.ok || res.data === null || typeof res.data !== 'object') return []
    const files = (res.data as { files?: unknown }).files
    if (!Array.isArray(files)) return []
    return files
      .map(f =>
        typeof f === 'string'
          ? f
          : f !== null &&
              typeof f === 'object' &&
              typeof (f as { path?: unknown }).path === 'string'
            ? (f as { path: string }).path
            : '',
      )
      .filter(Boolean)
  } catch {
    return []
  }
}

const FILES_README = 'README.md'
const PROJECT_README = 'project/README.md'
/** Gold `ue` — store get, not a files GET. */
const STORE_DB_AGENT = '/api/frame/db/agent'
/** Gold `dAe` deny unique English. */
const README_RULED =
  'a permission rule governs reading it — read it with its own call and that rule decides'
/** Gold `dAe` ask unique English (store). */
const STORE_ASK = 'its store needs approval to read here'
const STORE_OLDER =
  'so this is its published README, which may be older than the one in its store'
const STORE_RULED_OLDER = `a permission rule governs reading its store, ${STORE_OLDER}`
const STORE_ASK_OLDER = `${STORE_ASK}, ${STORE_OLDER}`

function permissionBagStrings(
  bag: Record<string, unknown> | undefined,
): string[] {
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

/** Gold `dAe` files: `read_file` / `read` README.md. Not `read_db`. */
function artifactRuleCoversFilesReadme(rule: string): boolean {
  const lower = rule.toLowerCase()
  if (!lower.includes('artifact')) return false
  if (lower.includes('read_db')) return false
  if (/artifact\(\s*read(?:_file)?\s*\)/i.test(rule)) return true
  const hasRead = lower.includes('read_file') || lower.includes('read')
  const hasTarget = lower.includes('readme.md') || lower.includes('files')
  return hasRead && hasTarget
}

/** Gold `dAe` store: `read_db` collection files / README.md. */
function artifactRuleCoversStoreReadme(rule: string): boolean {
  const lower = rule.toLowerCase()
  if (!lower.includes('artifact')) return false
  if (/artifact\(\s*read_db\s*\)/i.test(rule)) return true
  if (/artifact\(\s*read\s*\)/i.test(rule)) return true
  if (!lower.includes('read_db')) return false
  return lower.includes('readme.md') || lower.includes('files')
}

type ReadmeReadSkip = 'deny' | 'ask'

function readmePermissionSkip(
  context: Partial<ToolUseContext> | undefined,
  covers: (rule: string) => boolean,
): ReadmeReadSkip | undefined {
  const bags = context?.getAppState?.().toolPermissionContext as
    | {
        alwaysDenyRules?: Record<string, unknown>
        alwaysAskRules?: Record<string, unknown>
      }
    | undefined
  if (!bags) return undefined
  if (permissionBagStrings(bags.alwaysDenyRules).some(covers)) return 'deny'
  if (permissionBagStrings(bags.alwaysAskRules).some(covers)) return 'ask'
  return undefined
}

function logQuickstartBag(bag: Record<string, unknown>): void {
  const designSystem =
    bag.design_system !== null && typeof bag.design_system === 'object'
      ? (bag.design_system as { docs?: unknown })
      : undefined
  const systems =
    bag.design_systems !== null && typeof bag.design_systems === 'object'
      ? (bag.design_systems as { instances?: unknown })
      : undefined
  logEvent('artifact_quickstart', {
    has_match: bag.match !== undefined,
    types_ruled: bag.types_ruled === true,
    hooked: bag.types_hooked === true,
    guidance: bag.design_guidance === true,
    start_kit: bag.start_kit !== undefined,
    readme: Array.isArray(designSystem?.docs),
    design_systems: Array.isArray(systems?.instances)
      ? systems.instances.length
      : 0,
    docs_connector:
      typeof bag.docs_connector === 'boolean'
        ? bag.docs_connector
          ? 1
          : 0
        : undefined,
  } as never)
}

function finishQuickstartBag(bag: Record<string, unknown>): {
  data: QuickstartToolData
} {
  logQuickstartBag(bag)
  return { data: { id: '', url: '', expiresAt: '', quickstart: bag } }
}

function nestedStoreString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value === null || typeof value !== 'object') return undefined
  const inner = (value as { data?: unknown }).data
  return typeof inner === 'string' ? inner : undefined
}

/** Gold `ae` analog — store README is files/README.md `data.data`. */
function parseStoreReadmeText(data: unknown): {
  text?: string
  empty?: boolean
  missing?: boolean
} {
  if (data === null || typeof data !== 'object') return { missing: true }
  const rec = data as {
    exists?: unknown
    data?: unknown
    docs?: unknown
  }
  if (rec.exists === false) return { missing: true }
  let raw: string | undefined
  if (Array.isArray(rec.docs) && rec.docs[0] !== null) {
    raw = nestedStoreString(
      rec.docs[0] !== null && typeof rec.docs[0] === 'object'
        ? (rec.docs[0] as { data?: unknown }).data
        : undefined,
    )
  }
  raw ??= nestedStoreString(rec.data)
  if (raw === undefined) return { missing: rec.exists !== true }
  if (raw.trim() === '') return { empty: true }
  return { text: raw }
}

/**
 * Gold `se` store README: `B(e,"files",h)` + `B(e, L.collection, L.doc_id)`
 * via unique POST `/api/frame/db/agent` (`Ed.postRelayBound` → DL.post).
 */
function storeDocMoved(data: unknown): boolean {
  if (data === null || typeof data !== 'object') return false
  const rec = data as { data?: unknown; docs?: unknown }
  const payload =
    rec.data !== undefined
      ? rec.data
      : Array.isArray(rec.docs) &&
          rec.docs[0] !== null &&
          typeof rec.docs[0] === 'object'
        ? (rec.docs[0] as { data?: unknown }).data
        : undefined
  if (payload === null || typeof payload !== 'object') return false
  const movedTo = (payload as { movedTo?: unknown }).movedTo
  if (movedTo === null || typeof movedTo !== 'object') return false
  const dest = movedTo as { path?: unknown; at?: unknown }
  return typeof dest.path === 'string' && typeof dest.at === 'string'
}

async function postStoreGet(opts: {
  slug: string
  path: string
  signal?: AbortSignal
}): Promise<{
  ok: boolean
  status?: number
  data: unknown
  missing?: boolean
}> {
  const framePost = DL.postRelayBound ?? DL.post
  const res = await framePost(
    STORE_DB_AGENT,
    {
      slug: opts.slug,
      verb: 'get',
      args: { path: opts.path },
    },
    { signal: opts.signal, timeoutMs: 15_000 },
  )
  const status = res.status
  if (!res.ok || status === undefined || status < 200 || status >= 300) {
    return {
      ok: false,
      status,
      data: undefined,
      missing: status === 404,
    }
  }
  return { ok: true, status, data: res.data }
}

async function fetchStoreReadmeDoc(opts: {
  slug: string
  origin: string
  token?: string
  signal?: AbortSignal
  context?: Partial<ToolUseContext>
}): Promise<{
  doc?: { path: string; text: string }
  empty?: boolean
  moved?: boolean
  why?: string
}> {
  const skip = readmePermissionSkip(opts.context, artifactRuleCoversStoreReadme)
  if (skip === 'deny') {
    return { why: STORE_RULED_OLDER }
  }
  if (skip === 'ask') {
    return { why: STORE_ASK_OLDER }
  }
  try {
    const [meta, files] = await Promise.all([
      postStoreGet({ slug: opts.slug, path: 'ds/meta', signal: opts.signal }),
      postStoreGet({
        slug: opts.slug,
        path: `${'files'}/${FILES_README}`,
        signal: opts.signal,
      }),
    ])
    if (meta.ok && storeDocMoved(meta.data)) {
      return {
        moved: true,
        why: 'it moved to its own files, which this session does not serve',
      }
    }
    if (!files.ok) {
      if (files.missing) return {}
      if (files.status !== undefined && files.status !== 404) {
        return {
          why: `its store could not be read (HTTP ${files.status}) — read it with its own call, which may ask the user`,
        }
      }
      return {}
    }
    const parsed = parseStoreReadmeText(files.data)
    if (parsed.text !== undefined) {
      return { doc: { path: FILES_README, text: parsed.text } }
    }
    if (parsed.empty === true) {
      return { empty: true, why: 'its README.md in the store is empty' }
    }
    return {}
  } catch (error) {
    if (opts.signal?.aborted) throw error
    return {}
  }
}

const GUIDE_READ_OWN = 'read it with its own call, which may ask the user'
const GUIDE_HOST_REFUSED = 'the content host refused or failed'
/** Gold `K` — published guide HTML cap. */
const GUIDE_HTML_MAX = 12_000
const NEEDS_APPROVAL = `reading it here first needs the user's approval, which this call does not ask for — ${GUIDE_READ_OWN}`

type GuideFileRead = {
  doc?: { path: string; text: string }
  why?: string
  failed?: string
}

const GUIDE_EMPTY: GuideFileRead = {}

/**
 * Gold `W` / `I4e` — one published path on the content host.
 * 404 is absence (`missingFile`), not a failure. Other misses record `failed`.
 */
async function readGuidePublishedFile(opts: {
  slug: string
  path: string
  signal?: AbortSignal
}): Promise<GuideFileRead> {
  const { fetchArtifactFileBytes } = await import(
    'src/services/artifactAutoReact/restApis.js'
  )
  const read = await fetchArtifactFileBytes({
    slug: opts.slug,
    path: opts.path,
    signal: opts.signal,
    admitPublicRead: () => true,
  })
  if (read.kind === 'ok') {
    const html = read.bytes.toString('utf8')
    if (html.trim() === '') return GUIDE_EMPTY
    const text =
      html.length > GUIDE_HTML_MAX ? html.slice(0, GUIDE_HTML_MAX) : html
    return { doc: { path: opts.path, text } }
  }
  if (read.reason === 'http_404') return GUIDE_EMPTY
  return {
    why: `its ${opts.path} could not be fetched (${GUIDE_HOST_REFUSED}) — ${GUIDE_READ_OWN}`,
    failed: GUIDE_HOST_REFUSED,
  }
}

/** Gold `ne` — README.md and project/README.md together. */
async function readGuidePublishedPair(opts: {
  slug: string
  signal?: AbortSignal
}): Promise<{ root: GuideFileRead; project: GuideFileRead }> {
  const [root, project] = await Promise.all([
    readGuidePublishedFile({
      slug: opts.slug,
      path: FILES_README,
      signal: opts.signal,
    }),
    readGuidePublishedFile({
      slug: opts.slug,
      path: PROJECT_README,
      signal: opts.signal,
    }),
  ])
  return { root, project }
}

/** Gold `oe` — project doc wins, else root; both failures combine. */
function pickGuidePublished(pair: {
  root: GuideFileRead
  project: GuideFileRead
}): GuideFileRead {
  const project = pair.project
  const root = pair.root
  if (project.doc !== undefined || root.doc !== undefined) {
    return project.doc !== undefined ? project : root
  }
  if (project.failed !== undefined && root.failed !== undefined) {
    const why =
      project.failed === root.failed
        ? `its ${PROJECT_README} and ${FILES_README} could not be fetched (${root.failed}) — read the design system with its own call, which may ask the user`
        : `its ${PROJECT_README} (${project.failed}) and ${FILES_README} (${root.failed}) could not be fetched — read the design system with its own call, which may ask the user`
    return { why }
  }
  return project.why !== undefined ? project : root
}

async function attachDefaultReadme(opts: {
  url: string
  origin: string
  token?: string
  signal?: AbortSignal
  context?: Partial<ToolUseContext>
}): Promise<{
  docs?: Array<{ path: string; text: string }>
  unavailable?: string
  store?: true
}> {
  const filesOn = isArtifactMultiFileOn()
  const filesSkip = filesOn
    ? readmePermissionSkip(opts.context, artifactRuleCoversFilesReadme)
    : undefined
  const storeSkip = readmePermissionSkip(
    opts.context,
    artifactRuleCoversStoreReadme,
  )
  const slug = slugFromArtifactUrl(opts.url)
  if (!slug) return { unavailable: 'it is not an Artifact URL of this session' }
  // Gold filesOk / storeOk: a ruled or ask channel is not read.
  const filesOk = filesOn && filesSkip === undefined
  const storeOk = storeSkip === undefined
  if (!filesOk && !storeOk) {
    const ask = filesSkip === 'ask' || storeSkip === 'ask'
    return { unavailable: ask ? NEEDS_APPROVAL : README_RULED }
  }
  const storePromise: ReturnType<typeof fetchStoreReadmeDoc> = storeOk
    ? fetchStoreReadmeDoc({
        slug,
        origin: opts.origin,
        token: opts.token,
        signal: opts.signal,
        context: opts.context,
      })
    : Promise.resolve({})
  const filesPromise = filesOk
    ? readGuidePublishedPair({ slug, signal: opts.signal })
    : Promise.resolve({
        root: GUIDE_EMPTY,
        project: GUIDE_EMPTY,
      })
  const [pair, store] = await Promise.all([filesPromise, storePromise])
  const files = pickGuidePublished(pair)
  // Gold kyo: v = files path is project/README.md; F = !v && store doc.
  const filesIsProject = files.doc?.path === PROJECT_README
  const storeWins = !filesIsProject && store.doc !== undefined
  const picked = filesIsProject ? files.doc : (store.doc ?? files.doc)
  if (picked === undefined) {
    return {
      unavailable: store.why ?? files.why ?? 'it has no README to read',
    }
  }
  // Gold j: project path or a store doc suppresses the store-ruled note.
  const storeRuled = storeSkip === 'deny'
  const storeAsk = storeSkip === 'ask'
  const storeNote =
    storeWins || filesIsProject
      ? undefined
      : storeRuled
        ? STORE_RULED_OLDER
        : storeAsk
          ? STORE_ASK_OLDER
          : undefined
  return {
    docs: [picked],
    ...(storeWins ? { store: true as const } : {}),
    ...(storeNote !== undefined ? { unavailable: storeNote } : {}),
  }
}

/** Confine a published relative path under kitDir. Gold yj/zt analog. */
function resolveKitPath(kitDir: string, rel: string): string | undefined {
  if (
    !rel ||
    rel.includes('\0') ||
    rel.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(rel)
  ) {
    return undefined
  }
  const parts = rel.split(/[/\\]/).filter(Boolean)
  if (parts.length === 0 || parts.length > 5) return undefined
  if (parts.some(p => p === '.' || p === '..')) return undefined
  const abs = resolve(kitDir, ...parts)
  const root = resolve(kitDir)
  const prefix = root.endsWith(sep) ? root : root + sep
  if (abs !== root && !abs.startsWith(prefix)) return undefined
  return abs
}

async function saveTypeHalfAnalog(opts: {
  slug: string
  origin: string
  token?: string
  signal?: AbortSignal
  firstParty?: boolean
}): Promise<
  | { dir: string; files: Array<{ path: string }>; skill_in_result: boolean }
  | { not_saved: string }
> {
  let skill:
    | { kind: 'read'; text: string; clipped: boolean }
    | { kind: 'none' }
    | { kind: 'unavailable'; why: string }
  try {
    skill = await fetchTypeFile({
      ...opts,
      path: TYPE_INSTRUCTIONS_FILE,
    })
  } catch (error) {
    if (opts.signal?.aborted) {
      return {
        not_saved: 'interrupted before the instructions could be read',
      }
    }
    throw error
  }
  if (skill.kind === 'none') {
    return { not_saved: 'it lists no SKILL.md' }
  }
  if (skill.kind !== 'read') {
    return { not_saved: skill.why }
  }
  if (opts.firstParty === false) {
    return { not_saved: 'the admission no longer stands after the read' }
  }
  const listed = await fetchTypeFileList(opts)
  const pages = listed
    .filter(
      path =>
        path.startsWith('artifact-type/reference/') && !isSkippedFontPath(path),
    )
    .slice(0, 16)
  const dir = await ensureStartKitDir(opts.slug)
  if (dir === null) {
    return { not_saved: 'its files did not land' }
  }
  const files: Array<{ path: string }> = [{ path: TYPE_INSTRUCTIONS_FILE }]
  const skillAbs = resolveKitPath(dir, TYPE_INSTRUCTIONS_FILE)
  if (!skillAbs) {
    return { not_saved: 'the type lists no SKILL.md or it could not be read' }
  }
  await mkdir(join(dir, 'artifact-type', 'reference'), { recursive: true })
  await writeFile(skillAbs, skill.text, 'utf8')
  for (const path of pages) {
    const abs = resolveKitPath(dir, path)
    if (!abs) continue
    const page = await fetchTypeFile({ ...opts, path })
    if (page.kind !== 'read') continue
    await mkdir(join(abs, '..'), { recursive: true })
    await writeFile(abs, page.text, 'utf8')
    files.push({ path })
  }
  return { dir, files, skill_in_result: !skill.clipped }
}

/**
 * densable joe + b5 — start kits land in the session scratchpad (`QE`, created
 * 0o700) under `artifact-files/<slug>`; null when the session has no scratchpad.
 */
async function ensureStartKitDir(slug: string): Promise<string | null> {
  if (!isScratchpadEnabled()) return null
  const scratchpad = getScratchpadDir()
  await mkdir(scratchpad, { recursive: true, mode: 0o700 })
  const dir = join(scratchpad, 'artifact-files', slug)
  await mkdir(dir, { recursive: true })
  return dir
}

function isReservedSystemPath(path: string): boolean {
  return (
    path === 'index.html' ||
    path === TYPE_INSTRUCTIONS_FILE ||
    path.startsWith('artifact-type/')
  )
}

/** Gold start-kit font skip — fonts.googleapis.com / fonts.gstatic.com. */
function isSkippedFontPath(path: string): boolean {
  return FONT_SKIP.test(path)
}

function isFirstPartyTypeRow(row: { tier?: string } | undefined): boolean {
  return row?.tier === 'core'
}

/** Gold `pt` / `saveSystemHalf` analog — own files of the default design system. */
async function saveSystemHalfAnalog(opts: {
  url: string
  origin: string
  token?: string
  signal?: AbortSignal
}): Promise<
  | {
      dir: string
      files: Array<{ path: string }>
      skipped: Array<{ path: string }>
    }
  | { not_saved: string }
> {
  const slug = slugFromArtifactUrl(opts.url)
  if (!slug) {
    return {
      not_saved:
        'the design system link is not an Artifact URL of this session',
    }
  }
  const { listArtifactFiles } = await import(
    'src/services/artifactAutoReact/restApis.js'
  )
  // KEEP bare list — saveSystemHalfAnalog has no ToolUseContext; do not
  // invent admitPublicRead: true / fake probeToolUseId.
  const listed = await listArtifactFiles({ slug, signal: opts.signal })
  if (listed.kind === 'error') {
    return { not_saved: listed.message }
  }
  const own = listed.files.filter(
    f => !isReservedSystemPath(f.path) && !isSkippedFontPath(f.path),
  )
  if (own.length === 0) {
    return { not_saved: 'it publishes no files of its own' }
  }
  const dir = await ensureStartKitDir(slug)
  if (dir === null) {
    return { not_saved: 'none of its files could be saved' }
  }
  const files: Array<{ path: string }> = []
  const skipped: Array<{ path: string }> = []
  for (const row of own) {
    const page = await fetchTypeFile({
      slug,
      path: row.path,
      origin: opts.origin,
      token: opts.token,
      signal: opts.signal,
    })
    if (page.kind !== 'read') {
      try {
        const url = `${opts.origin}/api/frame/files/${encodeURIComponent(slug)}/${row.path
          .split('/')
          .map(s => encodeURIComponent(s))
          .join('/')}`
        const res = await fetchJson(url, opts.token, opts.signal)
        if (!res.ok) {
          skipped.push({ path: row.path })
          continue
        }
        let raw = res.text
        if (typeof res.data === 'object' && res.data !== null) {
          const rec = res.data as { text?: unknown; content?: unknown }
          if (typeof rec.text === 'string') raw = rec.text
          else if (typeof rec.content === 'string') raw = rec.content
        }
        if (!raw.trim()) {
          skipped.push({ path: row.path })
          continue
        }
        const abs = resolveKitPath(dir, row.path)
        if (!abs) {
          skipped.push({ path: row.path })
          continue
        }
        await mkdir(join(abs, '..'), { recursive: true })
        await writeFile(abs, raw, 'utf8')
        files.push({ path: row.path })
      } catch {
        skipped.push({ path: row.path })
      }
      continue
    }
    const abs = resolveKitPath(dir, row.path)
    if (!abs) {
      skipped.push({ path: row.path })
      continue
    }
    await mkdir(join(abs, '..'), { recursive: true })
    await writeFile(abs, page.text, 'utf8')
    files.push({ path: row.path })
  }
  if (files.length === 0) {
    return { not_saved: 'none of its files could be saved' }
  }
  return { dir, files, skipped }
}

type DesignSystemInstance = {
  title: string
  url: string
  description?: string
  created_at?: string
  rel: string
  audience?: string
  default?: string
}

async function fetchDesignSystemInstances(opts: {
  slug: string
  origin: string
  token?: string
  signal?: AbortSignal
}): Promise<{
  err: string | null
  rows: DesignSystemInstance[]
  overflow: boolean
  unavailable: boolean
}> {
  const url = `${opts.origin}/api/frame/types/${encodeURIComponent(opts.slug)}/instances?limit=200`
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      signal: opts.signal,
    })
    if (!res.ok) {
      return {
        err: `the Artifacts made from this type could not be listed (HTTP ${res.status})`,
        rows: [],
        overflow: false,
        unavailable: res.status === 404,
      }
    }
    const body = (await res.json()) as {
      instances?: unknown
      next_page_token?: unknown
    }
    const raw = Array.isArray(body.instances) ? body.instances : []
    const rows: DesignSystemInstance[] = []
    for (const item of raw) {
      if (item === null || typeof item !== 'object') continue
      const rec = item as Record<string, unknown>
      const slug = typeof rec.slug === 'string' ? rec.slug : ''
      if (!slug) continue
      const rel =
        rec.rel === 'mine' || rec.rel === 'shared' ? rec.rel : undefined
      if (!rel) continue
      const title =
        typeof rec.title === 'string' && rec.title.trim()
          ? rec.title
          : 'Untitled'
      const row: DesignSystemInstance = {
        title,
        url: typeUrlForSlug(slug, opts.origin),
        rel,
      }
      if (typeof rec.description === 'string' && rec.description) {
        row.description = rec.description
      }
      if (typeof rec.created_at === 'string') row.created_at = rec.created_at
      if (rel === 'shared' && typeof rec.audience === 'string') {
        row.audience = rec.audience
      }
      if (rec.default === 'user' || rec.default === 'org') {
        row.default = rec.default
      }
      rows.push(row)
    }
    const overflow =
      typeof body.next_page_token === 'string' && body.next_page_token !== ''
    return { err: null, rows, overflow, unavailable: false }
  } catch (error) {
    if (opts.signal?.aborted) throw error
    return {
      err: 'the Artifacts made from this type could not be listed (network error)',
      rows: [],
      overflow: false,
      unavailable: false,
    }
  }
}

function pickDefaultDesignSystem(
  rows: DesignSystemInstance[],
  overflow: boolean,
):
  | { url: string; source: { default: string; title: string } }
  | { url: undefined; why: string } {
  const marked = rows.find(r => r.default !== undefined)
  if (marked?.default === undefined || marked.url === undefined) {
    if (rows.length === 0) {
      return {
        url: undefined,
        why: 'the account lists no design systems — build without one unless the user names one',
      }
    }
    return {
      url: undefined,
      why: `no default is set among the ${rows.length}${overflow ? ' or more' : ''} design systems the account lists — name the listed systems to the user and ask which to use before creating, then read their pick with its own call; with nobody to ask, build without one`,
    }
  }
  return {
    url: marked.url,
    source: { default: marked.default, title: marked.title },
  }
}

async function listDesignSystems(opts: {
  firstPartyRows: QuickstartTypeRow[]
  typesPartial: boolean
  origin: string
  token?: string
  signal?: AbortSignal
  hooked?: boolean
  context?: Partial<ToolUseContext>
  pipelineRan?: boolean
}): Promise<Record<string, unknown>> {
  const bag: Record<string, unknown> = {}
  if (opts.hooked) {
    bag.design_systems_note =
      'a PreToolUse hook may cover Artifact calls — list the design systems and read the one you use with their own calls, so the hook sees them'
    return bag
  }
  const { titled, one } = matchIntentRows(
    opts.firstPartyRows,
    DESIGN_SYSTEM_TITLES,
  )
  const slug = one?.slug
  const dsRule = designSystemsListPermissionRule(
    opts.context,
    one?.typeUrl,
    opts.pipelineRan ?? true,
  )
  if (dsRule) {
    bag.design_systems_note = formatDesignSystemsRuledNote(dsRule)
    return bag
  }
  if (!one || !slug) {
    bag.design_systems_note =
      titled.length > 1 || opts.typesPartial
        ? 'the Design System type could not be told apart in the type listing — list the design systems with their own call'
        : 'this account lists no Design System type, so there are none to choose from'
    return bag
  }
  const listed = await fetchDesignSystemInstances({
    slug,
    origin: opts.origin,
    token: opts.token,
    signal: opts.signal,
  })
  if (listed.err !== null) {
    bag.design_systems_note = `${listed.err} — list them with their own call`
    return bag
  }
  const instances = listed.rows.slice(0, 200).map(row => ({
    title: row.title,
    url: row.url,
    ...(row.description !== undefined ? { description: row.description } : {}),
    ...(row.created_at !== undefined ? { created_at: row.created_at } : {}),
    rel: row.rel,
    ...(row.audience !== undefined ? { audience: row.audience } : {}),
    ...(row.default !== undefined ? { default: row.default } : {}),
  }))
  bag.design_systems = {
    type: one.title,
    type_url: one.typeUrl,
    scope: 'all',
    instances,
    ...(instances.length < listed.rows.length ? { more: true } : {}),
    ...(listed.overflow ? { overflow: true } : {}),
    ...(listed.unavailable ? { unavailable: true } : {}),
  }
  if (listed.unavailable) return bag
  const picked = pickDefaultDesignSystem(listed.rows, listed.overflow)
  if (picked.url === undefined) {
    bag.design_system = { unavailable: picked.why }
    return bag
  }
  bag.design_system = {
    url: picked.url,
    default: picked.source.default,
    title: picked.source.title,
  }
  const readme = await attachDefaultReadme({
    url: picked.url,
    origin: opts.origin,
    token: opts.token,
    signal: opts.signal,
    context: opts.context,
  })
  if (readme.docs) {
    ;(bag.design_system as Record<string, unknown>).docs = readme.docs
  }
  if (readme.unavailable) {
    ;(bag.design_system as Record<string, unknown>).unavailable =
      readme.unavailable
  }
  if (readme.store === true) {
    ;(bag.design_system as Record<string, unknown>).store = true
  }
  return bag
}

function emptyErr(error: string): { data: QuickstartToolData } {
  return { data: { id: '', url: '', expiresAt: '', error } }
}

/** leftover has no `$n.capabilitiesSkillInPool` / `replToolInPool`; do not invent uSo. */
function leftoverStartKitBag<T extends Record<string, unknown>>(
  kit: T,
): T & { capabilities_skill: false; repl_tool: false } {
  return {
    ...kit,
    capabilities_skill: false,
    repl_tool: false,
  }
}

/**
 * Gold `iy(e, n, s, r)` analog. `n` (tool) unused locally.
 */
export async function callQuickstart(
  input: QuickstartInput,
  context?: Partial<ToolUseContext>,
): Promise<{ data: QuickstartToolData }> {
  if (!isArtifactQuickstartOn()) {
    throw new ArtifactQuickstartUnavailableError()
  }
  const intent = input.intent
  const designSystems = input.design_systems !== false
  const docsConnector = isDocsConnectorAttached(context?.options?.mcpClients)
  const { origin, token } = oauthOriginAndToken()
  const signal = context?.abortController?.signal
  const bag: Record<string, unknown> = { intent }

  if (intent === 'document' && !docsConnector) {
    bag.docs_connector = false
    return finishQuickstartBag(bag)
  }

  const pipelineRan = QUICKSTART_PIPELINE_RAN
  const typeListRule = typesListPermissionRule(context, pipelineRan)
  if (typeListRule) {
    bag.types_note = formatTypesRuledNote(typeListRule)
    bag.types_ruled = true
    if (intent === 'other') {
      bag.design_guidance = true
      const guidance = await loadDesignGuidanceText()
      if (guidance) bag.design_guidance_text = guidance
      if (typeof context?.toolUseId === 'string') {
        setQuickstartGuidanceToolUseId(context.toolUseId)
      }
    }
    return finishQuickstartBag(bag)
  }

  const hooked = hasPreToolUseHook(
    context as unknown as PreToolUseHookContext | undefined,
  )
  if (hooked && intent === 'other') {
    bag.types_note =
      'a PreToolUse hook may cover Artifact calls — list the types and the design systems with their own calls, so the hook sees them'
    bag.types_hooked = true
    bag.design_guidance = true
    const guidance = await loadDesignGuidanceText()
    if (guidance) bag.design_guidance_text = guidance
    if (typeof context?.toolUseId === 'string') {
      setQuickstartGuidanceToolUseId(context.toolUseId)
    }
    return finishQuickstartBag(bag)
  }

  try {
    const catalogOpts = {
      signal,
      credentials: context?.credentials,
    }
    const [firstPartyRaw, openRaw] = await Promise.all([
      fetchTypeCatalog({ ...catalogOpts, firstParty: true }),
      intent === 'other'
        ? fetchTypeCatalog({ ...catalogOpts, firstParty: false })
        : Promise.resolve(undefined),
    ])
    const applyCatalog = (
      result: typeof firstPartyRaw,
    ): typeof firstPartyRaw | { fail: string } => {
      if (result.err === null) return result
      const reason =
        'reason' in result && typeof result.reason === 'string'
          ? result.reason
          : undefined
      if (catalogReasonIsUnavailable(reason, intent)) {
        return {
          err: null,
          rows: [],
          dropped: 0,
          more: false,
          unavailable: true,
        }
      }
      return {
        fail: `quickstart types listing unavailable. ${result.err}. If no type titled for this intent is listed, say so plainly.`,
      }
    }
    const firstParty = applyCatalog(firstPartyRaw)
    if ('fail' in firstParty) return emptyErr(firstParty.fail)
    const open = openRaw === undefined ? undefined : applyCatalog(openRaw)
    if (open && 'fail' in open) return emptyErr(open.fail)
    if (firstParty.unavailable) bag.types_unavailable = true
    const firstRows = firstParty.rows
    const typesPartial =
      firstParty.more ||
      firstParty.dropped > 0 ||
      firstRows.some(r => r.untitled)

    if (intent === 'other') {
      if (open) {
        const filtered = docsConnector
          ? open.rows
          : open.rows.filter(row => !isCoreDocsType(row))
        if (filtered.length < open.rows.length) bag.docs_connector = false
        bag.types = filtered
          .slice(0, QUICKSTART_OTHER_TYPE_CAP)
          .map(mapQuickstartRow)
        if (open.more || filtered.length > QUICKSTART_OTHER_TYPE_CAP) {
          bag.types_more = true
        }
      }
      const dash = matchIntentRows(firstRows, DASHBOARD_TITLES).one
      if (dash) bag.dashboard_type = mapQuickstartRow(dash)
    } else {
      const { titled, one } = matchIntentRows(firstRows, INTENT_TITLES[intent])
      if (one) {
        bag.match = mapQuickstartRow(one)
        if (titled.length > 1) bag.match_of = titled.length
      } else if (titled.length > 1) {
        bag.types = titled.map(mapQuickstartRow)
        bag.types_ambiguous = true
      } else if (typesPartial) {
        bag.types_partial = true
      }
    }

    const wantsStartKit =
      isArtifactStartKitOn() && bag.match !== undefined && intent !== 'document'
    const matchRow = bag.match as
      | { type_url?: unknown; tier?: unknown }
      | undefined
    const kitAbort = new AbortController()
    const abortKit = () => kitAbort.abort()
    if (signal) {
      if (signal.aborted) kitAbort.abort()
      else signal.addEventListener('abort', abortKit, { once: true })
    }
    const kitSignal = kitAbort.signal
    let typeHalfPromise: ReturnType<typeof saveTypeHalfAnalog> | undefined
    if (wantsStartKit && matchRow) {
      if (!isFirstPartyTypeRow({ tier: matchRow.tier as string | undefined })) {
        bag.start_kit = leftoverStartKitBag({
          not_saved: 'not listed first-party',
        })
      } else {
        const matchUrl =
          typeof matchRow.type_url === 'string' ? matchRow.type_url : ''
        const slug = slugFromArtifactUrl(matchUrl)
        if (slug) {
          typeHalfPromise = saveTypeHalfAnalog({
            slug,
            origin,
            token,
            signal: kitSignal,
            firstParty: isFirstPartyTypeRow({
              tier: matchRow.tier as string | undefined,
            }),
          }).catch(error => {
            if (kitSignal.aborted) {
              return {
                not_saved: 'interrupted before the instructions could be read',
              }
            }
            throw error
          })
        } else {
          bag.start_kit = leftoverStartKitBag({
            not_saved: 'the type link is not an Artifact URL of this session',
          })
        }
      }
    }

    try {
      const wantsSystems =
        intent === 'other' ||
        ((intent === 'slides' || intent === 'design') &&
          bag.match !== undefined)
      if (wantsSystems && !designSystems) {
        bag.design_systems_off = true
      } else if (wantsSystems) {
        Object.assign(
          bag,
          await listDesignSystems({
            firstPartyRows: firstRows,
            typesPartial,
            origin,
            token,
            signal,
            hooked,
            context,
            pipelineRan,
          }),
        )
      }
    } catch (error) {
      abortKit()
      signal?.removeEventListener('abort', abortKit)
      throw error
    }

    if (typeHalfPromise) {
      const typeHalf = await typeHalfPromise
      signal?.removeEventListener('abort', abortKit)
      const systemUrl =
        bag.design_system !== null &&
        typeof bag.design_system === 'object' &&
        typeof (bag.design_system as { url?: unknown }).url === 'string'
          ? (bag.design_system as { url: string }).url
          : undefined
      const systemHalf =
        systemUrl !== undefined
          ? await saveSystemHalfAnalog({
              url: systemUrl,
              origin,
              token,
              signal,
            })
          : undefined
      bag.start_kit = leftoverStartKitBag({
        ...('dir' in typeHalf
          ? { type: typeHalf, skill_in_result: typeHalf.skill_in_result }
          : { not_saved: typeHalf.not_saved }),
        ...(systemHalf && 'dir' in systemHalf
          ? { system: systemHalf, system_url: systemUrl }
          : systemHalf && 'not_saved' in systemHalf
            ? { system_not_saved: systemHalf.not_saved }
            : {}),
      })
    } else {
      signal?.removeEventListener('abort', abortKit)
    }

    if (
      intent === 'other' ||
      ((intent === 'slides' || intent === 'design') &&
        bag.match === undefined &&
        bag.types_ambiguous !== true &&
        bag.types_partial !== true)
    ) {
      bag.design_guidance = true
      const guidance = await loadDesignGuidanceText()
      if (guidance) bag.design_guidance_text = guidance
      if (typeof context?.toolUseId === 'string') {
        setQuickstartGuidanceToolUseId(context.toolUseId)
      }
    }

    const matchUrl =
      bag.match !== null &&
      typeof bag.match === 'object' &&
      typeof (bag.match as { type_url?: unknown }).type_url === 'string'
        ? (bag.match as { type_url: string }).type_url
        : ''
    const ranSlug = slugFromArtifactUrl(matchUrl)
    if (ranSlug !== undefined && intent !== 'document') {
      const ds =
        bag.design_system !== null && typeof bag.design_system === 'object'
          ? (bag.design_system as { url?: unknown; docs?: unknown })
          : undefined
      recordQuickstartRan(ranSlug, {
        ...(typeof context?.toolUseId === 'string'
          ? { toolUseId: context.toolUseId }
          : {}),
        listed: bag.design_systems !== undefined,
        ...(typeof ds?.url === 'string' && Array.isArray(ds.docs)
          ? { designSystem: ds.url }
          : {}),
        none: isQuickstartNone(bag),
        ...extrasFromStartKit(bag, intent),
      })
    }

    return finishQuickstartBag(bag)
  } catch (error) {
    if (signal?.aborted) throw error
    return emptyErr(
      'quickstart types listing could not be fetched. Say so plainly, then offer to make it another way.',
    )
  }
}

export { formatQuickstartResult } from './quickstartResult.js'
