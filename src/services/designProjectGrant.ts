/**
 * densable 2.1.289 tokenless Design writes: tHt / Nxr / $Zt / Ee / ETo / nwo.
 * The durable-grant card is stamped `__projectGrantAskShown`.
 */
import { randomBytes } from 'crypto'
import axios from 'axios'
import { getOauthConfig } from '../constants/oauth.js'
import { getSessionId } from '../bootstrap/state.js'
import type { AppState } from '../state/AppState.js'
import { getAgentContext } from '../utils/agentContext.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { hasHookForEvent } from '../utils/hooks.js'
import { hasMatchingFunctionHook } from '../utils/plugins/functionHooksModules.js'
import { ToolStateSlots } from '../utils/toolState.js'
import {
  DESIGN_CONSENT_BIT,
  designAuthHeaders,
  designRequestAuth,
} from './designConsent.js'
import { getAnthropicClientPlatform } from '../utils/teleport/api.js'

const PATH_MAX_IN_DIALOG = 80
const DIALOG_BUDGET = 2000
const TARGET_CAP = 20
const PLAN_PATH_CAP = 256

const REJECTED_PATH =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: densable path reject C0/C1
  /[\x00-\x1f\x7f-\x9f#?,:[\]\u00AD\u061C\u200B-\u200F\u2026\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF\uFF0C\uFF1A\uFF3B\uFF3D]/

const NAME_REJECTED =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: densable name reject C0/C1
  // biome-ignore lint/suspicious/noMisleadingCharacterClass: densable variation selectors
  /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u2026\u2800\u3164\uFE00-\uFE0E\uFEFF\uFFF9-\uFFFB\uFFA0]/

const QUOTE =
  /["\u201C\u201D\u201E\u201F\uFF02\u2033\u2036\u02BA\u02DD\u02EE\u05F4\u3003\u301D-\u301F\u275D\u275E\u2014\u2015]/

const SPOOF_TAG = /\uDB40[\uDC20-\uDC7F\uDD00-\uDDEF]|\uD834[\uDD73-\uDD7A]/

const URL_SPOOF =
  // biome-ignore lint/suspicious/noMisleadingCharacterClass: densable variation selectors
  /[\u200C\u200D\uFE0F]/

/** Gold `y` — approved-plan TTL when the server omits expires_at. */
const APPROVED_PLAN_TTL_MS = 900_000

const PLAN_GATED = new Set(['write_files', 'delete_files', 'create_support_js'])

const SHARING: Record<string, string> = {
  invited: 'private: invited members only',
  org: 'visible to your whole organization',
  public: 'PUBLIC',
}

type Targets = { targets: string[]; set: 'writes' | 'deletes' }

export type DesignGrantContext = {
  agentContext?: { agentType?: string; agentId?: string }
  /** ToolUseContext.agentId. Main-thread contexts leave this unset. */
  agentId?: string
  options?: { isNonInteractiveSession?: boolean }
  abortController?: { signal: AbortSignal }
  /** densable toolUseContext.toolState (`wN`). */
  toolState?: ToolStateSlots
  credentials?: unknown
  getAppState?: () => {
    toolPermissionContext?: {
      mode?: string
      isBypassPermissionsModeAvailable?: boolean
    }
    sessionHooks?: AppState['sessionHooks']
  }
}

export type DesignGrantDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; message: string; reason: string }
  | { kind: 'ask-grant'; message: string; projectId: string }
  | { kind: 'ask-reserved' }
  | { kind: 'fallthrough' }

type ApprovedPlan = {
  projectId: string
  writes: Set<string>
  deletes: Set<string>
  expiresAt: number
}

/** Gold `v()` plan shape stored by `gTo`. */
export type StoredDesignPlan = {
  projectId: string
  writes: string[]
  deletes: string[]
  localDir?: string
}

/**
 * densable `oH` — the design slot inside `toolState`.
 * Grants, recard marks, ineligible projects, approved plans, and the
 * in-flight grants GET all live here, not on the process.
 */
export class DesignSessionState {
  verifiedProjectGrants = new Set<string>()
  recardAllProjects = false
  recardProjects = new Set<string>()
  grantIneligibleProjects = new Set<string>()
  approvedPlans = new Map<string, ApprovedPlan>()
  /** Gold `oH.planStore`. */
  planStore = new Map<string, StoredDesignPlan>()
  /** Gold `oH.consentCache`. `null` means not fetched. */
  consentCache: Record<string, boolean> | null = null
  consentFetch: Promise<Record<string, boolean>> | null = null
  consentCacheGeneration = 0
  grantsFetch: Promise<Set<string> | null> | null = null
}

/** densable `toolState.get(oH)`. */
export function designSessionState(context: {
  toolState?: ToolStateSlots
}): DesignSessionState {
  if (context.toolState === undefined) {
    context.toolState = new ToolStateSlots()
  }
  return context.toolState.get(DesignSessionState)
}

let probeOverride: Set<string> | null | undefined
let cardOverride:
  | 'fetch'
  | null
  | { name: string; sharingLabel: string; url: string } = 'fetch'

export function resetDesignProjectGrantForTests(): void {
  probeOverride = undefined
  cardOverride = 'fetch'
}

/** Test seam. `null` is gold's unavailable probe. */
export function seedDesignGrantProbe(
  value: 'fetch' | 'unavailable' | readonly string[],
): void {
  probeOverride =
    value === 'fetch'
      ? undefined
      : value === 'unavailable'
        ? null
        : new Set(value)
}

export function seedDesignProjectCard(
  value: 'fetch' | null | { name: string; sharingLabel: string; url: string },
): void {
  cardOverride = value
}

/** Gold Ike(state, projectId). */
export function rememberDesignProjectGrant(
  state: DesignSessionState,
  projectId: string,
): void {
  if (projectId.length > 0) state.verifiedProjectGrants.add(projectId)
}

/** Gold STo(state, projectId). */
export function markDesignGrantIneligible(
  state: DesignSessionState,
  projectId: string,
): void {
  if (projectId.length > 0) {
    state.grantIneligibleProjects.add(normalizeProjectId(projectId))
  }
}

function normalizeProjectId(projectId: string): string {
  return projectId
    .toLowerCase()
    .replace(/^urn:uuid:/, '')
    .replace(/[{}-]/g, '')
}

/** Gold `HP` — slash-normalize a design project path. */
export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter(part => part !== '' && part !== '.')
    .join('/')
}

function reservedPath(path: string): string | null {
  if (REJECTED_PATH.test(path)) return `rejected character in path: ${path}`
  const normalized = normalizePath(path)
  const lower = normalized.toLowerCase()
  if (
    lower === 'claude.md' ||
    lower.startsWith('claude.md/') ||
    lower === '.claude' ||
    lower.startsWith('.claude/')
  ) {
    return `reserved path: ${path}`
  }
  if (
    lower.split('/').some(segment => {
      const trimmed = segment.replace(/[\s.]+$/, '').replace(/^\s+/, '')
      return (
        trimmed === 'claude.md' || trimmed === '.claude' || /~\d/.test(trimmed)
      )
    })
  ) {
    return `reserved segment: ${path}`
  }
  if (
    !normalized ||
    normalized.split('/').some(segment => /^\s*\.\.[\s.]*$/.test(segment)) ||
    normalized.includes('\0')
  ) {
    return `path does not normalize: ${path}`
  }
  return null
}

function enumerateTargets(
  operation: string,
  args: Record<string, unknown> | undefined,
): Targets | null | undefined {
  if (args === undefined) return undefined
  if (operation === 'write_files') {
    const files = args.files
    if (!Array.isArray(files)) return null
    const targets: string[] = []
    for (const file of files) {
      const path =
        file !== null && typeof file === 'object'
          ? Reflect.get(file, 'path')
          : undefined
      if (typeof path !== 'string') return null
      targets.push(path)
    }
    return { targets, set: 'writes' }
  }
  if (operation === 'create_support_js') {
    const path = args.path
    if (path === undefined || path === '') {
      return { targets: ['support.js'], set: 'writes' }
    }
    if (typeof path !== 'string') return null
    return { targets: [path], set: 'writes' }
  }
  if (operation === 'delete_files') {
    if (args.paths !== undefined && args.files !== undefined) return null
    if (Array.isArray(args.paths)) {
      const targets: string[] = []
      for (const path of args.paths) {
        if (typeof path !== 'string') return null
        targets.push(path)
      }
      return { targets, set: 'deletes' }
    }
    if (Array.isArray(args.files)) {
      const targets: string[] = []
      for (const file of args.files) {
        const path =
          file !== null && typeof file === 'object'
            ? Reflect.get(file, 'path')
            : undefined
        if (typeof path !== 'string') return null
        targets.push(path)
      }
      return { targets, set: 'deletes' }
    }
    return null
  }
  return undefined
}

function classifyTargets(
  operation: string,
  args: Record<string, unknown> | undefined,
):
  | { outcome: 'pass'; targets: string[]; set: 'writes' | 'deletes' }
  | { outcome: 'ask'; reason: string; targets?: string[] } {
  const enumerated = enumerateTargets(operation, args)
  if (enumerated === undefined) {
    return { outcome: 'ask', reason: 'not a plan-gated operation' }
  }
  if (enumerated === null) {
    return { outcome: 'ask', reason: 'target paths unenumerable' }
  }
  if (enumerated.targets.length === 0) {
    return { outcome: 'ask', reason: 'no target paths', targets: [] }
  }
  if (enumerated.targets.length > PLAN_PATH_CAP) {
    return {
      outcome: 'ask',
      reason: `more than ${PLAN_PATH_CAP} target paths`,
      targets: enumerated.targets,
    }
  }
  for (const path of enumerated.targets) {
    const reserved = reservedPath(path)
    if (reserved !== null) {
      return { outcome: 'ask', reason: reserved, targets: enumerated.targets }
    }
  }
  return {
    outcome: 'pass',
    targets: enumerated.targets,
    set: enumerated.set,
  }
}

/** densable Nxr — the approval dialog can show every path. */
function targetsFitDialog(targets: string[] | undefined): boolean {
  if (
    targets === undefined ||
    targets.length === 0 ||
    targets.length > TARGET_CAP
  ) {
    return false
  }
  for (const path of targets) {
    if (path.length > PATH_MAX_IN_DIALOG || REJECTED_PATH.test(path)) {
      return false
    }
  }
  const per =
    44 +
    (() => {
      const width = Math.max(
        0,
        Math.min(200, Math.floor(1800 / targets.length) - 95),
      )
      return width > 0 ? width + 3 : 0
    })()
  const used =
    272 +
    targets.reduce((sum, path) => sum + path.length + per, 0) +
    2 * Math.max(0, targets.length - 1)
  return used <= DIALOG_BUDGET
}

function op(operation: string): string {
  return `ClaudeDesign ${operation}`
}

/**
 * densable checkPermissions `if (_)` — before the consent prompt, a
 * tokenless write that cannot be shown is denied.
 */
export function designConsentBlockedWrite(
  operation: string,
  args: Record<string, unknown> | undefined,
): { message: string; reason: string } | null {
  if (operation !== 'write_files' && operation !== 'create_support_js') {
    return null
  }
  const token = args?.plan_token
  if (typeof token === 'string' && token.length > 0) return null
  const classified = classifyTargets(operation, args)
  if (classified.outcome === 'pass' && targetsFitDialog(classified.targets)) {
    return null
  }
  const empty =
    classified.outcome === 'ask' &&
    classified.targets !== undefined &&
    classified.targets.length === 0
  const tooBig = classified.outcome === 'pass'
  if (empty) {
    return {
      message: `${op(operation)}: this call names no target paths — list the files to write, or use finalize_plan with writes (and deletes if needed), then pass the returned plan_token.`,
      reason: 'a write batch naming no target paths — malformed call',
    }
  }
  if (tooBig) {
    return {
      message: `${op(operation)}: this batch is too large to display fully for approval — split it into smaller batches, or use finalize_plan with writes (and deletes if needed), then pass the returned plan_token.`,
      reason:
        'the batch cannot be rendered fully in the approval dialog — split it or use per-batch plans',
    }
  }
  return {
    message: `${op(operation)}: this batch includes paths that always require per-batch approval — use finalize_plan with writes/deletes and pass the returned plan_token.`,
    reason:
      'reserved or unenumerable target paths always require per-batch approval',
  }
}

function permissionMode(context: DesignGrantContext): string | undefined {
  try {
    return context.getAppState?.().toolPermissionContext?.mode
  } catch {
    return undefined
  }
}

/**
 * densable q. Explicit agentType must be "main". A set ALS subagent or
 * teammate is not main. A tool context with getAppState and no ALS is the
 * main thread (this tree never stamps agentType "main").
 * Hook lookup is `dx`: `hasHookForEvent` plus `hasMatchingFunctionHook`
 * (`eee` / `classic.PermissionRequest`). The session id is the agent id
 * when one is set, otherwise `getSessionId()` — the same agent-aware key
 * `executePreToolHooks` already uses. Session hooks live on
 * `appState.sessionHooks`, which is this tree's registry.
 */
export function designGrantAskReachesUser(
  context: DesignGrantContext,
): boolean {
  const stamped = context.agentContext?.agentType
  const isMain =
    stamped !== undefined
      ? stamped === 'main'
      : getAgentContext() === undefined && context.getAppState !== undefined
  if (!isMain) return false
  return !permissionRequestHookPresent(context)
}

function permissionRequestHookPresent(context: DesignGrantContext): boolean {
  let snapshot: ReturnType<NonNullable<DesignGrantContext['getAppState']>>
  try {
    snapshot = context.getAppState?.() ?? {
      toolPermissionContext: undefined,
      sessionHooks: undefined,
    }
  } catch {
    return true
  }
  const sessionId =
    context.agentContext?.agentId ?? context.agentId ?? getSessionId()
  const appState =
    snapshot?.sessionHooks === undefined ? undefined : (snapshot as AppState)
  try {
    return (
      hasHookForEvent('PermissionRequest', appState, sessionId) ||
      hasMatchingFunctionHook('PermissionRequest')
    )
  } catch {
    return true
  }
}

function hasPlanToken(args: Record<string, unknown> | undefined): boolean {
  const token = args?.plan_token
  return typeof token === 'string' && token.length > 0
}

async function requestDesignGrants(credentials?: unknown): Promise<{
  status: number
  grants: unknown
} | null> {
  try {
    const response = await axios.get(
      `${getOauthConfig().BASE_API_URL}/v1/design/grants`,
      {
        ...(await designRequestAuth(credentials)),
        timeout: 15000,
        validateStatus: status => status < 500,
      },
    )
    const grants = (response.data as { grants?: unknown } | null)?.grants
    return { status: response.status, grants }
  } catch {
    return null
  }
}

async function fetchGrantIds(
  credentials?: unknown,
): Promise<Set<string> | null> {
  const response = await requestDesignGrants(credentials)
  if (response === null || response.status !== 200) return null
  if (!Array.isArray(response.grants)) return null
  const ids = new Set<string>()
  for (const row of response.grants) {
    const id =
      row !== null && typeof row === 'object'
        ? Reflect.get(row, 'project_id')
        : undefined
    if (typeof id === 'string' && id.length > 0) ids.add(id)
  }
  return ids
}

/** densable $Zt — one in-flight GET on this session, cleared when it settles. */
async function probeGrants(
  state: DesignSessionState,
  credentials?: unknown,
): Promise<Set<string> | null> {
  if (probeOverride !== undefined) return probeOverride
  const flight = (state.grantsFetch ??= fetchGrantIds(credentials))
  try {
    return await flight
  } finally {
    if (state.grantsFetch === flight) state.grantsFetch = null
  }
}

function clipName(name: string): string {
  return name.length <= 60 ? name : `${name.slice(0, 60).trimEnd()}…`
}

async function projectCard(
  projectId: string,
  signal: AbortSignal | undefined,
  credentials?: unknown,
): Promise<{ name: string; sharingLabel: string; url: string } | null> {
  if (cardOverride !== 'fetch') return cardOverride
  try {
    const headers = await designAuthHeaders(credentials)
    const response = await axios.post(
      `${getOauthConfig().BASE_API_URL}/v1/design/mcp`,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'get_project',
          arguments: { project_id: projectId },
        },
      },
      {
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'anthropic-version': '2023-06-01',
          'anthropic-client-platform': getAnthropicClientPlatform(),
          'X-Anthropic-Client': 'claude-cli-design-tool',
        },
        timeout: 15000,
        validateStatus: () => true,
        signal,
      },
    )
    const content = (
      response.data as {
        result?: { isError?: boolean; content?: unknown[] }
      }
    ).result
    if (response.status !== 200 || content?.isError === true) return null
    if (!Array.isArray(content?.content)) return null
    for (const block of content.content) {
      if (
        block === null ||
        typeof block !== 'object' ||
        Reflect.get(block, 'type') !== 'text'
      ) {
        continue
      }
      const text = Reflect.get(block, 'text')
      if (typeof text !== 'string') return null
      return parseProjectCard(text, projectId)
    }
    return null
  } catch (error) {
    if (signal?.aborted) throw error
    return null
  }
}

/** Gold Te — variation selectors and ZWJ used as name spoof marks. */
function nameHasSpoofMarks(value: string): boolean {
  return (
    // biome-ignore lint/suspicious/noMisleadingCharacterClass: densable variation selectors
    /(?:^|\s)[\u200C\u200D\uFE0F]/.test(value) ||
    /[\u200C\u200D](?=\s|$)/.test(value) ||
    /[\u200C\u200D][\u200C\u200D]/.test(value) ||
    /(?:^|[^\p{Emoji}])\uFE0F/u.test(value)
  )
}

export function parseProjectCard(
  text: string,
  projectId: string,
): { name: string; sharingLabel: string; url: string } | null {
  let body: Record<string, unknown>
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed === null || typeof parsed !== 'object') return null
    body = parsed as Record<string, unknown>
  } catch {
    return null
  }
  const rawName = body.name
  if (typeof rawName !== 'string') return null
  const name = rawName.replace(/\s+/g, ' ').trim()
  if (
    name.length === 0 ||
    NAME_REJECTED.test(name) ||
    SPOOF_TAG.test(name) ||
    nameHasSpoofMarks(name) ||
    name.includes('://') ||
    QUOTE.test(name)
  ) {
    return null
  }
  const sharing = body.sharing
  const scope =
    sharing !== null && typeof sharing === 'object'
      ? Reflect.get(sharing, 'scope')
      : undefined
  if (typeof scope !== 'string' || SHARING[scope] === undefined) return null
  const url = body.url
  if (typeof url !== 'string') return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (
    parsed.protocol !== 'https:' ||
    !parsed.pathname.endsWith(`/p/${projectId}`) ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    url.length > 200 ||
    /\s/.test(url) ||
    QUOTE.test(url) ||
    NAME_REJECTED.test(url) ||
    SPOOF_TAG.test(url) ||
    URL_SPOOF.test(url)
  ) {
    return null
  }
  return {
    name: clipName(name),
    sharingLabel: SHARING[scope] ?? scope,
    url,
  }
}

const NONINTERACTIVE =
  'writing without a plan_token requires a one-time interactive project approval, which is not available in non-interactive sessions — use finalize_plan with writes (and deletes if needed), then pass the returned plan_token.'

/**
 * densable checkPermissions after consent is already granted, for a
 * tokenless write_files / create_support_js.
 */
export async function decideTokenlessProjectWrite(
  operation: string,
  args: Record<string, unknown> | undefined,
  context: DesignGrantContext,
): Promise<DesignGrantDecision> {
  const state = designSessionState(context)
  if (
    (operation !== 'write_files' && operation !== 'create_support_js') ||
    hasPlanToken(args)
  ) {
    return { kind: 'fallthrough' }
  }
  const mode = permissionMode(context)
  const direct = designGrantAskReachesUser(context)
  const projectId = args?.project_id
  const classified = classifyTargets(operation, args)
  if (context.options?.isNonInteractiveSession === true) {
    const deny = {
      kind: 'deny' as const,
      message: `${op(operation)}: ${NONINTERACTIVE}`,
      reason:
        'a durable project write grant requires an interactive approval with a server-verified project identity',
    }
    if (typeof projectId !== 'string' || projectId.length === 0 || !direct) {
      return deny
    }
    if (classified.outcome !== 'pass' || mode === 'plan') return deny
    if (state.verifiedProjectGrants.has(projectId)) return { kind: 'allow' }
    const probe = await probeGrants(state, context.credentials)
    if (probe?.has(projectId)) {
      rememberDesignProjectGrant(state, projectId)
      if (mode !== 'plan') return { kind: 'allow' }
    }
    return deny
  }
  if (!direct) {
    return {
      kind: 'deny',
      message: `${op(operation)}: writing without a plan_token requires a one-time project approval, which is not available in subagent or PermissionRequest-hook sessions — use finalize_plan with writes (and deletes if needed), then pass the returned plan_token.`,
      reason:
        'a durable project write grant requires a context where the approval card reaches the user directly',
    }
  }
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return { kind: 'fallthrough' }
  }
  if (state.grantIneligibleProjects.has(normalizeProjectId(projectId))) {
    return {
      kind: 'deny',
      message: `${op(operation)}: this project cannot hold a durable write grant for this account (it may be shared from another organization) — use finalize_plan with writes (and deletes if needed), then pass the returned plan_token.`,
      reason:
        'the server refused to mint a durable grant for this project — per-batch plans only',
    }
  }
  if (classified.outcome === 'pass' && mode === 'plan') {
    if (!state.verifiedProjectGrants.has(projectId)) {
      const probe = await probeGrants(state, context.credentials)
      if (!probe?.has(projectId)) {
        return {
          kind: 'deny',
          message: `${op(operation)}: writing without a plan_token requires a one-time project approval, which is not shown in plan mode — use finalize_plan with writes (and deletes if needed), then pass the returned plan_token.`,
          reason:
            'a durable project write grant cannot be minted from plan mode — per-batch plans only',
        }
      }
    }
    rememberDesignProjectGrant(state, projectId)
    return { kind: 'fallthrough' }
  }
  if (classified.outcome === 'pass') {
    if (state.verifiedProjectGrants.has(projectId)) return { kind: 'allow' }
    const probe = await probeGrants(state, context.credentials)
    if (probe?.has(projectId)) {
      rememberDesignProjectGrant(state, projectId)
      if (mode !== 'plan') return { kind: 'allow' }
    } else if (probe === null) {
      return {
        kind: 'deny',
        message: `${op(operation)}: could not check for a project write grant (this server may not support durable grants) — use finalize_plan with writes (and deletes if needed), then pass the returned plan_token.`,
        reason:
          'the grant state could not be verified — fail toward the per-batch plan flow',
      }
    } else {
      if (mode === 'plan') {
        return {
          kind: 'deny',
          message: `${op(operation)}: writing without a plan_token requires a one-time project approval, which is not shown in plan mode — use finalize_plan with writes (and deletes if needed), then pass the returned plan_token.`,
          reason:
            'a durable project write grant cannot be minted from plan mode — per-batch plans only',
        }
      }
      let askCanReach = false
      try {
        const perms = context.getAppState?.().toolPermissionContext
        const current = perms?.mode
        askCanReach =
          context.getAppState !== undefined &&
          current !== 'bypassPermissions' &&
          !(
            current === 'plan' &&
            perms?.isBypassPermissionsModeAvailable === true
          )
      } catch {
        askCanReach = false
      }
      if (!askCanReach) {
        return {
          kind: 'deny',
          message: `${op(operation)}: writing without a plan_token to a project without a write grant requires a one-time interactive approval, which cannot be shown in this permission mode — use finalize_plan with writes (and deletes if needed), then pass the returned plan_token.`,
          reason:
            'a durable project write grant requires an interactive approval with a server-verified project identity',
        }
      }
      const card = await projectCard(
        projectId,
        context.abortController?.signal,
        context.credentials,
      )
      if (card === null) {
        return {
          kind: 'deny',
          message: `${op(operation)}: a durable project write grant is only offered when the approval dialog can name its target, and the project identity (name, sharing, URL) could not be verified or rendered faithfully. If this is a fresh connection, read the project first (e.g. get_project — approve the Claude Design connection if prompted) and retry once; otherwise use finalize_plan with writes/deletes and pass the returned plan_token (the per-batch flow), which is always supported.`,
          reason:
            'a durable project write grant requires a server-verified project identity in the approval card',
        }
      }
      return {
        kind: 'ask-grant',
        projectId,
        message: `Approving writes the listed files now, and lets Claude write to ANY file in the project "${card.name}" (${card.sharingLabel}) — ${card.url} — without asking again. This approval is remembered for this project until you revoke it in settings at claude.ai/design (future writes and file contents are not shown for approval). Deletes and CLAUDE.md/.claude paths still ask every time.`,
      }
    }
  }
  const targets = classified.outcome === 'ask' ? classified.targets : undefined
  const empty = targets !== undefined && targets.length === 0
  const probe = state.verifiedProjectGrants.has(projectId)
    ? null
    : await probeGrants(state, context.credentials)
  const granted =
    state.verifiedProjectGrants.has(projectId) || probe?.has(projectId) === true
  if (targetsFitDialog(targets) && granted) {
    rememberDesignProjectGrant(state, projectId)
    return { kind: 'ask-reserved' }
  }
  if (empty) {
    return {
      kind: 'deny',
      message: `${op(operation)}: this call names no target paths — list the files to write, or use finalize_plan with writes (and deletes if needed), then pass the returned plan_token.`,
      reason: 'a write batch naming no target paths — malformed call',
    }
  }
  return {
    kind: 'deny',
    message: `${op(operation)}: this batch includes paths that always require per-batch approval — use finalize_plan with writes/deletes and pass the returned plan_token.`,
    reason:
      'reserved or unenumerable target paths always require per-batch approval',
  }
}

const MEMBERSHIP_OPS = new Set([
  'update_sharing',
  'add_member',
  'update_member_role',
])

/** Gold Pke — drop every approved plan for this project id. */
export function dropApprovedDesignPlansForProject(
  state: DesignSessionState,
  projectId: string,
): void {
  const normalized = normalizeProjectId(projectId)
  for (const [token, plan] of state.approvedPlans) {
    if (normalizeProjectId(plan.projectId) === normalized) {
      state.approvedPlans.delete(token)
    }
  }
}

/** Gold ZNe. */
function dropVerifiedGrant(state: DesignSessionState, projectId: string): void {
  const normalized = normalizeProjectId(projectId)
  for (const id of state.verifiedProjectGrants) {
    if (normalizeProjectId(id) === normalized) {
      state.verifiedProjectGrants.delete(id)
    }
  }
}

/**
 * Gold call() xke — Pke, XKe, ZNe, JKe.
 */
export function noteDesignProjectMembershipChange(
  state: DesignSessionState,
  operation: string,
  projectId: unknown,
): void {
  if (!MEMBERSHIP_OPS.has(operation)) return
  if (typeof projectId !== 'string' || projectId.length === 0) return
  dropApprovedDesignPlansForProject(state, projectId)
  dropStoredPlansForProject(state, projectId)
  dropVerifiedGrant(state, projectId)
  state.recardProjects.add(normalizeProjectId(projectId))
}

/** Gold yTo. */
function clearApprovedDesignPlans(state: DesignSessionState): void {
  state.approvedPlans.clear()
}

/**
 * Gold ene(bit, false) clears — yTo, _To, and hTo.
 */
export function forgetDesignStateForClearedConsent(
  state: DesignSessionState,
): void {
  clearApprovedDesignPlans(state)
  state.verifiedProjectGrants.clear()
  state.recardAllProjects = true
  state.planStore.clear()
}

/**
 * densable `ene`. A false `agent_design_projects` bit clears plans, grants,
 * and planStore, then writes the bit onto this state's consent cache.
 */
export function writeDesignConsentBit(
  state: DesignSessionState,
  bit: string,
  value: boolean,
): void {
  if (bit === DESIGN_CONSENT_BIT && value === false) {
    forgetDesignStateForClearedConsent(state)
  }
  state.consentCache = { ...(state.consentCache ?? {}), [bit]: value }
}

const PLAN_ID = /^plan_[a-z0-9]{1,16}_[a-f0-9]{12}$/
const GLOB_WILDCARDS = 3

function newPlanId(projectId: string): string {
  const slug =
    projectId
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 16) || 'anon'
  return `plan_${slug}_${randomBytes(6).toString('hex')}`
}

/** Gold `m` — throws when a plan glob is too wide. */
function compileDesignGlob(pattern: string): void {
  let out = ''
  let index = 0
  let stars = 0
  const bump = () => {
    stars += 1
    if (stars > GLOB_WILDCARDS) {
      throw new Error(
        `glob "${pattern}" exceeds ${GLOB_WILDCARDS} '*'/'**' wildcards`,
      )
    }
  }
  while (index < pattern.length) {
    const ch = pattern.charAt(index)
    if (ch === '*' && pattern.charAt(index + 1) === '*') {
      bump()
      if (pattern.charAt(index + 2) === '/') {
        out += '(?:.*/)?'
        index += 3
      } else {
        out += '.*'
        index += 2
      }
    } else if (ch === '*') {
      bump()
      out += '[^/]*'
      index += 1
    } else if (ch === '?') {
      out += '[^/]'
      index += 1
    } else if (/[.+^$|()[\]{}\\]/.test(ch)) {
      out += `\\${ch}`
      index += 1
    } else {
      out += ch
      index += 1
    }
  }
  void new RegExp(`^${out}$`)
}

function storedPlanShape(plan: StoredDesignPlan): boolean {
  return (
    typeof plan.projectId === 'string' &&
    plan.writes.every(path => typeof path === 'string') &&
    plan.deletes.every(path => typeof path === 'string') &&
    (plan.localDir === undefined || typeof plan.localDir === 'string')
  )
}

/** Gold `gTo` — register a plan and return its id. */
export function registerDesignPlan(
  state: DesignSessionState,
  plan: {
    projectId: string
    writes: string[]
    deletes: string[]
    localDir?: string
  },
): string {
  const normalized: StoredDesignPlan = {
    projectId: plan.projectId,
    writes: plan.writes.map(normalizePath),
    deletes: plan.deletes.map(normalizePath),
    ...(plan.localDir !== undefined ? { localDir: plan.localDir } : {}),
  }
  if (!storedPlanShape(normalized)) {
    throw new Error('registerPlan: plan failed shape validation')
  }
  for (const path of [...normalized.writes, ...normalized.deletes]) {
    if (/[*?]/.test(path)) compileDesignGlob(path)
  }
  const id = newPlanId(plan.projectId)
  state.planStore.set(id, normalized)
  return id
}

/** Gold `Xon`. */
export function readDesignPlan(
  state: DesignSessionState,
  planId: string,
): StoredDesignPlan | null {
  if (!PLAN_ID.test(planId)) return null
  return state.planStore.get(planId) ?? null
}

/** Gold `XKe` — drop stored plans for this project id. */
function dropStoredPlansForProject(
  state: DesignSessionState,
  projectId: string,
): void {
  const normalized = normalizeProjectId(projectId)
  for (const [id, plan] of state.planStore) {
    if (normalizeProjectId(plan.projectId) === normalized) {
      state.planStore.delete(id)
    }
  }
}

/** Gold wce. */
function projectNeedsRecard(
  state: DesignSessionState,
  projectId: string,
): boolean {
  return (
    state.recardAllProjects ||
    state.recardProjects.has(normalizeProjectId(projectId))
  )
}

/** Gold F — S is JSON.stringify from the shared chunk. */
function projectIdFitsCard(projectId: string): boolean {
  return (
    projectId.length > 0 &&
    JSON.stringify(projectId).length <= PATH_MAX_IN_DIALOG &&
    !REJECTED_PATH.test(projectId)
  )
}

/** Gold k — both sides must fit the plan card. */
function pathsFitPlanCard(writes: string[], deletes: string[]): boolean {
  if (writes.length > TARGET_CAP || deletes.length > TARGET_CAP) return false
  for (const path of [...writes, ...deletes]) {
    if (path.length > PATH_MAX_IN_DIALOG || REJECTED_PATH.test(path)) {
      return false
    }
  }
  const row = (paths: string[]) =>
    paths.length === 0
      ? 0
      : 32 +
        paths.reduce((sum, path) => sum + path.length, 0) +
        2 * Math.max(0, paths.length - 1)
  return 240 + row(writes) + row(deletes) <= DIALOG_BUDGET
}

/**
 * Gold wTo. Pke runs before the shape check. Returns false when the token
 * is empty, the id/paths do not fit, or the server expiry is already due.
 */
export function recordFinalizedDesignPlan(
  state: DesignSessionState,
  token: string,
  plan: {
    projectId: string
    writes: string[]
    deletes: string[]
    serverExpiresAtMs?: number
  },
  now = Date.now(),
): boolean {
  if (token.length === 0) return false
  dropApprovedDesignPlansForProject(state, plan.projectId)
  if (
    !projectIdFitsCard(plan.projectId) ||
    !pathsFitPlanCard(plan.writes, plan.deletes)
  ) {
    return false
  }
  const server = plan.serverExpiresAtMs
  if (typeof server === 'number' && !Number.isFinite(server)) return false
  if (typeof server === 'number' && Number.isFinite(server) && server <= now) {
    return false
  }
  const expiresAt =
    typeof server === 'number' && Number.isFinite(server)
      ? Math.min(server, now + APPROVED_PLAN_TTL_MS)
      : now + APPROVED_PLAN_TTL_MS
  state.approvedPlans.set(token, {
    projectId: plan.projectId,
    writes: new Set(plan.writes.map(normalizePath)),
    deletes: new Set(plan.deletes.map(normalizePath)),
    expiresAt,
  })
  return true
}

/** Gold ETo. Deletes the plan when now is at or past expiresAt. */
function approvedPlanOutcome(
  state: DesignSessionState,
  operation: string,
  args: Record<string, unknown> | undefined,
  now: number,
): { outcome: 'allow' } | { outcome: 'ask'; reason: string } {
  if (!PLAN_GATED.has(operation) || args === undefined) {
    return { outcome: 'ask', reason: 'not a plan-gated operation' }
  }
  const token = args.plan_token
  const projectId = args.project_id
  if (typeof token !== 'string' || typeof projectId !== 'string') {
    return {
      outcome: 'ask',
      reason: 'missing plan_token or project_id',
    }
  }
  const plan = state.approvedPlans.get(token)
  if (plan === undefined) {
    return {
      outcome: 'ask',
      reason: 'plan_token not approved in this process',
    }
  }
  if (now >= plan.expiresAt) {
    state.approvedPlans.delete(token)
    return { outcome: 'ask', reason: 'approved plan expired' }
  }
  if (plan.projectId !== projectId) {
    return { outcome: 'ask', reason: 'plan_token is for a different project' }
  }
  const classified = classifyTargets(operation, args)
  if (classified.outcome !== 'pass') {
    return { outcome: 'ask', reason: classified.reason }
  }
  const allowed = classified.set === 'writes' ? plan.writes : plan.deletes
  for (const target of classified.targets) {
    if (!allowed.has(normalizePath(target))) {
      return {
        outcome: 'ask',
        reason: `path not in approved plan: ${target}`,
      }
    }
  }
  return { outcome: 'allow' }
}

/**
 * Gold checkPermissions: not plan mode, q, and ETo allow — before the
 * tokenless durable-grant machine.
 */
export function allowApprovedDesignPlan(
  operation: string,
  args: Record<string, unknown> | undefined,
  context: DesignGrantContext,
  now = Date.now(),
): boolean {
  if (permissionMode(context) === 'plan') return false
  if (!designGrantAskReachesUser(context)) return false
  return (
    approvedPlanOutcome(designSessionState(context), operation, args, now)
      .outcome === 'allow'
  )
}

type GrantObservation =
  | { present: false }
  | { present: true; createdAtMs: number }

/**
 * Gold `c(credentials)` for the watcher GET. `F()` is the hover-rest pin.
 * No token still returns a request with no Authorization header.
 */
async function watchGrantRequestConfig(credentials: unknown): Promise<{
  headers?: { Authorization: string }
}> {
  return designRequestAuth(credentials)
}

/** Inner nwo fetch. null means the baseline must not move. */
async function observeDesignGrant(
  projectId: string,
  credentials: unknown,
): Promise<GrantObservation | null> {
  let grants: unknown
  try {
    const response = await axios.get(
      `${getOauthConfig().BASE_API_URL}/v1/design/grants`,
      {
        ...(await watchGrantRequestConfig(credentials)),
        timeout: 15000,
        validateStatus: status => status < 500,
      },
    )
    const ok = response.status >= 200 && response.status < 300
    if (!ok || response.status !== 200) return null
    grants = (response.data as { grants?: unknown } | null)?.grants
  } catch (error) {
    logForDebugging(
      `Server-approval watcher poll failed (${errorMessage(error)}); will poll again.`,
    )
    return null
  }
  if (!Array.isArray(grants)) return null
  for (const row of grants) {
    if (row === null || typeof row !== 'object') continue
    if (Reflect.get(row, 'project_id') !== projectId) continue
    const created = Reflect.get(row, 'created_at')
    const createdAtMs =
      typeof created === 'string' ? Date.parse(created) : Number.NaN
    if (Number.isNaN(createdAtMs)) return null
    return { present: true, createdAtMs }
  }
  return { present: false }
}

/**
 * Gold nwo(toolState.get(oH), projectId, credentials).
 * First successful poll records a baseline and returns false.
 * A later poll returns true only when this project is present with a newer
 * created_at (or the baseline had none) and wce is false.
 */
export function createDesignProjectGrantWatcher(
  state: DesignSessionState,
  projectId: string,
  credentials?: unknown,
): { poll: () => Promise<boolean> } {
  let baseline: { createdAtMs: number | null } | null = null
  return {
    async poll() {
      const observed = await observeDesignGrant(projectId, credentials)
      if (observed === null) return false
      if (baseline === null) {
        baseline = {
          createdAtMs: observed.present ? observed.createdAtMs : null,
        }
        return false
      }
      if (!observed.present) return false
      const newer =
        baseline.createdAtMs === null ||
        observed.createdAtMs > baseline.createdAtMs
      if (!newer) return false
      if (projectNeedsRecard(state, projectId)) return false
      rememberDesignProjectGrant(state, projectId)
      return true
    },
  }
}
