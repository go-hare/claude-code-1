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

const sessionRefsEntrySchema = z.object({
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
})

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
  | { success: false; error: string }

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

let skillManifestGsGet: SkillManifestGsGet = defaultSkillManifestGsGet

export function setSkillManifestGsGetForTests(
  fn: SkillManifestGsGet | null,
): void {
  skillManifestGsGet = fn ?? defaultSkillManifestGsGet
}

/** leftover 239 uCh */
export async function fetchSkillManifestOnce(): Promise<SkillManifestFetch> {
  try {
    const res = await skillManifestGsGet()
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

/** leftover 239 dCh */
export class SessionRefsStore {
  inflight: Promise<SkillManifestFetch> | null = null
  featureEventReported = new Set<SessionRefsKind>()

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
  }

  async listEntries(
    kind: SessionRefsKind,
  ): Promise<ListSessionRefsEntriesResult> {
    const feature =
      kind === 'skills'
        ? 'sync_session_refs_skills'
        : 'sync_session_refs_plugins'
    const first = !this.featureEventReported.has(kind)
    this.featureEventReported.add(kind)
    const result = await this.fetch()
    if (!result.ok) {
      logEvent(
        kind === 'skills'
          ? 'tengu_skills_sync_manifest_failed'
          : 'tengu_plugins_sync_manifest_failed',
        { unavailable: result.reason === 'unavailable' },
      )
      if (first) {
        logForDebugging(`${feature} ${result.reason}`, { level: 'warn' })
      }
      return { success: false, error: `manifest ${result.reason}` }
    }
    if (first) {
      logForDebugging(feature)
    }
    return { success: true, entries: result[kind] }
  }
}

/** leftover 239 Uln — process singleton (leftover has no session-host object). */
const Uln = new SessionRefsStore()

export function getSessionRefsStore(): SessionRefsStore {
  return Uln
}

export function resetSessionRefsStoreForTests(): void {
  Uln.discardInflight()
  Uln.featureEventReported.clear()
  setSkillManifestGsGetForTests(null)
}
