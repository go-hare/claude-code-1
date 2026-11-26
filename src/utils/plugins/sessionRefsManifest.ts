/**
 * leftover 2.1.239 Uln / dCh / CFE / uCh / AFE — CCR session-refs skill
 * manifest store.
 *
 * Gold: gs.get("/worker/skill-manifest", {host:"ccr-session",
 * auth:"session-jwt", timeout:TFE=30s, validateStatus:()=>true}).
 * CFE retries once after kFE=500ms unless ok / no_auth / gated.
 * Local gs analog: session-ingress JWT + knr session gateway base
 * (`--sdk-url` else SESSION_INGRESS_URL chain). Do not invent a second
 * teleport host.
 */

import axios from 'axios'
import { z } from 'zod'
import { logEvent } from '../../services/analytics/index.js'
import { resolveSessionGatewayBaseUrl } from '../../services/artifactAutoReact/frameRelay.js'
import { logForDebugging } from '../debug.js'
import { classifyAxiosError } from '../errors.js'
import { getBootstrapSessionHost, HostSlot } from '../sessionHost.js'
import {
  getSessionIngressAuthHeaders,
  getSessionIngressAuthToken,
} from '../sessionIngressAuth.js'
import { sleep } from '../sleep.js'

/** leftover 239 uCh path */
export const SESSION_REFS_SKILL_MANIFEST_PATH = '/worker/skill-manifest'
/** leftover 239 TFE */
export const SESSION_REFS_MANIFEST_TIMEOUT_MS = 30_000
/** leftover 239 kFE */
export const SESSION_REFS_MANIFEST_RETRY_MS = 500

export type SessionRefsKind = 'plugins' | 'skills'

export type SessionRefsEntry = {
  id: string
  name: string
  description: string
  version: string
  directory: string
  marketplaceName?: string
  isOfficial?: boolean
}

export type SkillManifestFailReason =
  | 'no_auth'
  | 'gated'
  | 'unavailable'
  | 'http_error'
  | 'malformed'
  | 'transport'

export type SkillManifestFetch =
  | { ok: true; skills: SessionRefsEntry[]; plugins: SessionRefsEntry[] }
  | { ok: false; reason: SkillManifestFailReason }

export type SkillManifestGsResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; reason: string }

export type SkillManifestGsGet = () => Promise<SkillManifestGsResult>

const sessionRefsEntrySchema = z
  .object({
    id: z
      .string()
      .nullish()
      .transform(v => v ?? ''),
    name: z
      .string()
      .nullish()
      .transform(v => v ?? ''),
    description: z
      .string()
      .nullish()
      .transform(v => v ?? ''),
    version: z
      .string()
      .nullish()
      .transform(v => v ?? ''),
    directory: z
      .string()
      .nullish()
      .transform(v => v ?? ''),
    marketplace_name: z.string().nullish().catch(undefined),
    is_official: z.boolean().nullish().catch(undefined),
  })
  .transform(({ marketplace_name, is_official, ...rest }) => ({
    ...rest,
    ...(marketplace_name ? { marketplaceName: marketplace_name } : {}),
    ...(is_official === true ? { isOfficial: true } : {}),
  }))

const sessionRefsKindArraySchema = z
  .array(sessionRefsEntrySchema)
  .nullish()
  .transform(v => v ?? [])

/** leftover 239 AFE */
export const sessionRefsManifestSchema = z
  .object({
    skills: sessionRefsKindArraySchema,
    plugins: sessionRefsKindArraySchema,
  })
  .strict()

export type ListSessionRefsEntriesResult =
  | { success: true; entries: SessionRefsEntry[] }
  | { success: false; error: string; kind?: 'manifest' }

async function defaultSkillManifestGsGet(): Promise<SkillManifestGsResult> {
  if (!getSessionIngressAuthToken()) {
    return { ok: false, reason: 'no-auth' }
  }
  const base = resolveSessionGatewayBaseUrl()
  if (!base) {
    return { ok: false, reason: 'no_ingress' }
  }
  const res = await axios.get<unknown>(
    `${base.replace(/\/+$/, '')}${SESSION_REFS_SKILL_MANIFEST_PATH}`,
    {
      headers: {
        ...getSessionIngressAuthHeaders(),
        'anthropic-version': '2023-06-01',
      },
      timeout: SESSION_REFS_MANIFEST_TIMEOUT_MS,
      validateStatus: () => true,
    },
  )
  return { ok: true, status: res.status, data: res.data }
}

const skillManifestGsGetHostSlot = new HostSlot<{
  skillManifestGsGet: SkillManifestGsGet
}>(() => ({
  skillManifestGsGet: defaultSkillManifestGsGet,
}))

export function setSkillManifestGsGetForTests(
  fn: SkillManifestGsGet | null,
): void {
  skillManifestGsGetHostSlot.of(getBootstrapSessionHost()).skillManifestGsGet =
    fn ?? defaultSkillManifestGsGet
}

/** leftover 239 uCh */
export async function fetchSkillManifestOnce(): Promise<SkillManifestFetch> {
  try {
    const res = await skillManifestGsGetHostSlot
      .of(getBootstrapSessionHost())
      .skillManifestGsGet()
    if (!res.ok) {
      if (res.reason === 'no-auth') {
        logForDebugging('session_refs_manifest_no_auth', { level: 'warn' })
        return { ok: false, reason: 'no_auth' }
      }
      logForDebugging('session_refs_manifest_gated', { level: 'warn' })
      return { ok: false, reason: 'gated' }
    }
    if (res.status === 503) {
      logForDebugging('session_refs_manifest_unavailable', { level: 'warn' })
      return { ok: false, reason: 'unavailable' }
    }
    if (res.status >= 300) {
      logForDebugging('session_refs_manifest_http_error', { level: 'warn' })
      return { ok: false, reason: 'http_error' }
    }
    const parsed = sessionRefsManifestSchema.safeParse(res.data)
    if (!parsed.success) {
      logForDebugging('session_refs_manifest_malformed', { level: 'warn' })
      return { ok: false, reason: 'malformed' }
    }
    return {
      ok: true,
      skills: parsed.data.skills.filter(row => row.id),
      plugins: parsed.data.plugins.filter(row => row.id),
    }
  } catch (err) {
    const { kind } = classifyAxiosError(err)
    logForDebugging(`session_refs_manifest_exception kind=${kind}`, {
      level: 'warn',
    })
    return { ok: false, reason: 'transport' }
  }
}

/** leftover 239 CFE */
export async function fetchSkillManifestWithRetry(): Promise<SkillManifestFetch> {
  const first = await fetchSkillManifestOnce()
  if (first.ok || first.reason === 'no_auth' || first.reason === 'gated') {
    return first
  }
  await sleep(SESSION_REFS_MANIFEST_RETRY_MS)
  return fetchSkillManifestOnce()
}

/** leftover 239 dCh + official 325 nn (#1369 startupResponse pinning) */
export class SessionRefsStore {
  inflight: Promise<SkillManifestFetch> | null = null
  featureEventReported = new Set<SessionRefsKind>()
  startupResponse: Promise<SkillManifestFetch> | null = null
  /** Official 2.1.325 #1369 — tracks whether the pinned plugin manifest list failed. */
  isPinnedPluginListFailed = false
  /** Official 2.1.325 #1369 — pinned pluginId → name map from last successful list. */
  pinnedPluginNames: Map<string, string> | undefined = undefined

  fetch(): Promise<SkillManifestFetch> {
    if (!this.inflight) {
      const pending = fetchSkillManifestWithRetry().finally(() => {
        if (this.inflight === pending) this.inflight = null
      })
      this.inflight = pending
    }
    return this.inflight
  }

  discardInflight(): void {
    this.inflight = null
    this.startupResponse = null
  }

  async listEntries(
    kind: SessionRefsKind,
    options?: { startup?: boolean },
  ): Promise<ListSessionRefsEntriesResult> {
    const feature =
      kind === 'skills'
        ? 'sync_session_refs_skills'
        : 'sync_session_refs_plugins'
    const first = !this.featureEventReported.has(kind)
    this.featureEventReported.add(kind)
    const result = await (options?.startup
      ? (this.startupResponse ??= this.fetch())
      : this.fetch())
    if (!result.ok) {
      if (kind === 'plugins') {
        this.isPinnedPluginListFailed = true
      }
      logEvent(
        kind === 'skills'
          ? 'tengu_skills_sync_manifest_failed'
          : 'tengu_plugins_sync_manifest_failed',
        { unavailable: result.reason === 'unavailable' },
      )
      if (first) {
        logForDebugging(`${feature} ${result.reason}`, { level: 'warn' })
      }
      return {
        success: false,
        error: `manifest ${result.reason}`,
        kind: 'manifest',
      }
    }
    if (kind === 'plugins') {
      this.isPinnedPluginListFailed = false
      this.pinnedPluginNames = new Map(
        result.plugins.map(entry => [entry.id, entry.name]),
      )
    }
    if (first) {
      logForDebugging(feature)
    }
    return { success: true, entries: result[kind] }
  }

  /**
   * Official 2.1.325 #1369 (@289513085) — allow plugin if its name matches the
   * pinned list, or if the pinned list fetch failed and the plugin is NOT
   * `viaCodeRail`.
   */
  isPluginAllowedByPinnedList(plugin: {
    pluginId: string
    name: string
    viaCodeRail?: boolean
  }): boolean {
    if (this.pinnedPluginNames?.get(plugin.pluginId) === plugin.name) {
      return true
    }
    return this.isPinnedPluginListFailed === true && plugin.viaCodeRail !== true
  }
}

/** Official 2.1.325 `eA` (#1369) — unloadable guard isolation reason. */
export const UNLOADABLE_GUARD_REASON =
  'a PreToolUse/PermissionRequest hook that cannot be loaded may be what guards the permissions declared beside it, so nothing it sits in is applied until the entry is fixed or removed'

const GUARD_HOOK_EVENTS = new Set(['PreToolUse', 'PermissionRequest'])

function containsGuardHookShape(val: unknown, depth = 0): boolean {
  if (depth > 3 || val === null || typeof val !== 'object') return false
  if (Array.isArray(val)) {
    return val.some(item => containsGuardHookShape(item, depth + 1))
  }
  const obj = val as Record<string, unknown>
  if (typeof obj.matcher === 'string' && Array.isArray(obj.hooks)) {
    return true
  }
  return Object.values(obj).some(v => containsGuardHookShape(v, depth + 1))
}

/**
 * Official 2.1.325 `tDe` (#1369) — inspect plugin/settings `hooks` object for
 * unloadable `PreToolUse` / `PermissionRequest` guard hooks. When
 * `unloadableGuards.length > 0`, callers must quarantine the entire entry.
 */
export function inspectPluginHooksUnloadableGuards(
  hooks: unknown,
  knownEvents?: ReadonlySet<string>,
): { notes: string[]; unloadableGuards: string[] } {
  if (Array.isArray(hooks)) {
    return {
      notes: [],
      unloadableGuards: [
        'hooks: must be an object mapping event names to matcher arrays; received an array of matchers',
      ],
    }
  }
  if (!hooks || typeof hooks !== 'object') {
    return { notes: [], unloadableGuards: [] }
  }
  const notes: string[] = []
  const unloadableGuards: string[] = []
  for (const [eventName, matchers] of Object.entries(
    hooks as Record<string, unknown>,
  )) {
    const isKnown = knownEvents ? knownEvents.has(eventName) : true
    if (!isKnown) {
      if (containsGuardHookShape(matchers)) {
        unloadableGuards.push(
          `hooks.${eventName}: not a hook event, but it holds PreToolUse/PermissionRequest hooks`,
        )
      } else {
        notes.push(`hooks.${eventName}: unknown hook event; entry ignored`)
      }
      continue
    }
    if (!Array.isArray(matchers)) {
      if (GUARD_HOOK_EVENTS.has(eventName)) {
        unloadableGuards.push(
          `hooks.${eventName}: expected an array of hook matchers`,
        )
      } else {
        notes.push(`hooks.${eventName}: expected an array of hook matchers`)
      }
      continue
    }
    if (GUARD_HOOK_EVENTS.has(eventName)) {
      for (let i = 0; i < matchers.length; i++) {
        const entry = matchers[i]
        if (
          !entry ||
          typeof entry !== 'object' ||
          Array.isArray(entry) ||
          !Array.isArray((entry as Record<string, unknown>).hooks)
        ) {
          unloadableGuards.push(
            `hooks.${eventName}[${i}]: invalid guard hook matcher entry`,
          )
        }
      }
    }
  }
  return { notes, unloadableGuards }
}

/** Official 2.1.331 — HostSlot-scoped SessionRefsStore (`Uln`). */
const sessionRefsStoreHostSlot = new HostSlot<SessionRefsStore>(
  () => new SessionRefsStore(),
)

export function getSessionRefsStore(): SessionRefsStore {
  return sessionRefsStoreHostSlot.of(getBootstrapSessionHost())
}

export function resetSessionRefsStoreForTests(): void {
  const store = getSessionRefsStore()
  store.discardInflight()
  store.featureEventReported.clear()
  store.isPinnedPluginListFailed = false
  store.pinnedPluginNames = undefined
  setSkillManifestGsGetForTests(null)
}
