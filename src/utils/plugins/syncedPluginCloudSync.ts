/**
 * leftover 2.1.239 zXl / AZn / jal — claude.ai org plugin sync.
 *
 * Gold: GET list-plugins (teleport-org) → download zip → extract under
 * ~/.claude/plugins/synced/ → qMr(W1h) + plugins_sync_complete.
 * Fhr (sessionRefsGate) gates cowork listEntries("plugins") + optional AZn.
 */

import axios from 'axios'
import { createWriteStream } from 'fs'
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'fs/promises'
import { tmpdir } from 'os'
import { monitorEventLoopDelay } from 'perf_hooks'
import { basename, join, relative } from 'path'
import { Transform } from 'stream'
import { pipeline } from 'stream/promises'
import { z } from 'zod'
import { setSyncedPluginDirs } from '../../bootstrap/state.js'
import { getOauthConfig } from '../../constants/oauth.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/metadata.js'
import { logEvent } from '../../services/analytics/index.js'
import { logForDebugging } from '../debug.js'
import { getErrnoCode, isENOENT } from '../errors.js'
import { execFileNoThrow } from '../execFileNoThrow.js'
import {
  isSyncPluginsBufferedDownloadEnabled,
  isSyncPluginsEnabled,
  resolveSyncPluginsDownloadStallMs,
} from '../residualFinalEnvGates.js'
import { isSessionRefsSyncEnabled } from '../sessionRefsGate.js'
import { sleep } from '../sleep.js'
import { getOAuthHeaders, prepareApiRequest } from '../teleport/api.js'
import { getPluginsDirectory } from './pluginDirectories.js'
import { SYNCED_MARKETPLACE_NAME } from './pluginIdentifier.js'
import { getSessionRefsStore } from './sessionRefsManifest.js'
import {
  auditSyncedExtractTree,
  dirsFromSyncedManifest,
  getSyncedConfigHome,
  getSyncedPluginsManifestPath,
  getSyncedPluginsRoot,
  getSyncedPluginsTrashRoot,
  getSyncedStagingDir,
  hydrateSyncedPluginDirsFromDisk,
  SYNCED_PLUGINS_ROOT_LABEL,
} from './syncedPluginHydrate.js'
import {
  auditSyncedRoot,
  createSyncedLiveDirClassifier,
  createSyncedManifestCtx,
  downloadFailed,
  ensureSyncedRootRound,
  extractedTreeIsBareRepo,
  extractFailed,
  isOccupantRenameErrno,
  landingRefused,
  moveSyncedDirToTrash,
  promotionFailed,
  sameSyncedOccupant,
  skipZipEntryIfReserved,
  SYNCED_EXTRACT_OK,
  SYNCED_OCCUPANT_STUCK,
  SYNCED_ROOT_REFUSED,
  SyncOwnedRootRefusedError,
  type SyncedExtractResult,
} from './syncedPluginSyncFs.js'
import {
  foldSyncedPathKey,
  isReservedDottedSyncedName,
  LegacyReservedSpellingError,
  resolveSyncedItemLeaf,
  resolveSyncedPluginDir,
} from './syncedPluginSyncNames.js'
import { extractZipToDirectory } from './zipCache.js'
import { unwrapZpfZipRoot, ZPF_URL_MAX_BYTES } from './zpfLoad.js'

/** leftover 239 IVS */
export const LIST_PLUGINS_PATH =
  '/api/oauth/organizations/:orgUUID/plugins/list-plugins?enabled_only=true&compact=true'
/** leftover 239 Bzf */
export const LIST_PLUGINS_PAGE_SIZE = 100
/** leftover 239 Fal */
export const LIST_PLUGINS_PAGE_CAP = 20
/** leftover 239 xVS */
const LIST_TIMEOUT_MS = 10_000
/** leftover 239 Vzf */
const LIST_RETRY_MS = 500
/** leftover 239 Bal */
const DOWNLOAD_TIMEOUT_MS = 60_000
/** leftover 239 A1h */
const DOWNLOAD_CONCURRENCY = 6

export type SyncedCloudPlugin = {
  pluginId: string
  name: string
  description: string
  version: string | null
  updatedAt: string | null
  requestedVersion?: string
}

type ListedPluginRow = {
  id?: unknown
  name?: unknown
  description?: unknown
  version?: unknown
  updated_at?: unknown
  enabled?: unknown
}

/** leftover 239 C1h — cowork Uln.listEntries("plugins") row. */
export function mapCoworkListedPlugin(row: {
  id?: unknown
  directory?: unknown
  name?: unknown
  description?: unknown
  version?: unknown
}): SyncedCloudPlugin {
  const id = String(row.id ?? '')
  const name = String(row.directory || row.name || row.id || '')
  return {
    pluginId: id,
    name,
    description: typeof row.description === 'string' ? row.description : '',
    version: typeof row.version === 'string' ? row.version : null,
    updatedAt: null,
    requestedVersion: typeof row.version === 'string' ? row.version : undefined,
  }
}

/** leftover 239 xos — merge cowork then cloud by pluginId (cloud wins). */
export function mergeCoworkAndCloudPlugins(
  cowork: SyncedCloudPlugin[],
  cloud: SyncedCloudPlugin[],
): SyncedCloudPlugin[] {
  const byId = new Map<string, SyncedCloudPlugin>()
  for (const plugin of cowork) {
    if (plugin.pluginId) byId.set(plugin.pluginId, plugin)
  }
  for (const plugin of cloud) {
    if (plugin.pluginId) byId.set(plugin.pluginId, plugin)
  }
  return [...byId.values()]
}

/**
 * leftover 239 Uln.of(e).listEntries("plugins").
 * Official `!Q.success` fails the whole zXl list → jXl (hydrate disk,
 * do not wipe). Empty success writes an empty manifest.
 */
export async function listCoworkPluginEntries(): Promise<
  | {
      success: true
      entries: Array<{
        id?: unknown
        directory?: unknown
        name?: unknown
        description?: unknown
        version?: unknown
      }>
    }
  | { success: false; error: string }
> {
  return getSessionRefsStore().listEntries('plugins')
}

/** leftover 239 Fzf */
export function mapCloudListedPlugin(row: ListedPluginRow): SyncedCloudPlugin {
  return {
    pluginId: String(row.id ?? ''),
    name: String(row.name ?? ''),
    description: typeof row.description === 'string' ? row.description : '',
    version: typeof row.version === 'string' ? row.version : null,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
  }
}

/** leftover 239 Uzf */
export function isCloudListedPluginEnabled(row: ListedPluginRow): boolean {
  return row.enabled !== false
}

/** leftover 239 jal */
export function cloudPluginDownloadPath(
  pluginId: string,
  version?: string | null,
): string {
  const q = version ? `?version=${encodeURIComponent(version)}` : ''
  return `/api/oauth/organizations/:orgUUID/plugins/${encodeURIComponent(pluginId)}/download${q}`
}

export function expandOrgApiPath(path: string, orgUUID: string): string {
  return path.replace(':orgUUID', orgUUID)
}

export type ListOrgPluginsResult =
  | { success: true; plugins: SyncedCloudPlugin[] }
  | { success: false; error: string; status?: number }

type OrgCtx = {
  headers: Record<string, string>
  orgUUID: string
  base: string
}

async function orgCtx(): Promise<OrgCtx> {
  const { accessToken, orgUUID } = await prepareApiRequest()
  return {
    headers: {
      ...getOAuthHeaders(accessToken),
      'x-organization-uuid': orgUUID,
    },
    orgUUID,
    base: getOauthConfig().BASE_API_URL,
  }
}

/** leftover 239 jzf — paginated list-plugins. */
export async function listOrgSyncedPluginsPage(
  ctx: OrgCtx,
  offset: number,
): Promise<{
  ok: boolean
  status: number
  data?: { plugins?: unknown; has_more?: unknown; error?: { type?: string } }
  error?: string
}> {
  const url = `${ctx.base}${expandOrgApiPath(LIST_PLUGINS_PATH, ctx.orgUUID)}&limit=${LIST_PLUGINS_PAGE_SIZE}&offset=${offset}`
  try {
    const res = await axios.get<{
      plugins?: unknown
      has_more?: unknown
      error?: { type?: string }
    }>(url, {
      headers: ctx.headers,
      timeout: LIST_TIMEOUT_MS,
      validateStatus: () => true,
      maxContentLength: 16_777_216,
    })
    if (res.status < 200 || res.status >= 300) {
      return {
        ok: false,
        status: res.status,
        data: res.data,
        error: res.status === 401 || res.status === 403 ? 'no-auth' : 'http',
      }
    }
    return { ok: true, status: res.status, data: res.data }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** leftover 239 jzf */
export async function listOrgSyncedPluginsOnce(): Promise<ListOrgPluginsResult> {
  const ctx = await orgCtx()
  const plugins: SyncedCloudPlugin[] = []
  try {
    for (let page = 0; page < LIST_PLUGINS_PAGE_CAP; page++) {
      const offset = page * LIST_PLUGINS_PAGE_SIZE
      const res = await listOrgSyncedPluginsPage(ctx, offset)
      if (!res.ok) {
        const serverError =
          res.data && typeof res.data === 'object' && res.data.error?.type
            ? res.data.error.type
            : undefined
        if (serverError) {
          logForDebugging('plugins_sync_list_error', { level: 'warn' })
          return { success: false, error: serverError, status: res.status }
        }
        return {
          success: false,
          error: res.error === 'no-auth' ? 'no-auth' : (res.error ?? 'http'),
          status: res.status,
        }
      }
      if (!Array.isArray(res.data?.plugins)) {
        logForDebugging('plugins_sync_list_malformed', { level: 'warn' })
        return { success: false, error: 'malformed list-plugins response' }
      }
      for (const row of res.data.plugins as ListedPluginRow[]) {
        if (isCloudListedPluginEnabled(row)) {
          plugins.push(mapCloudListedPlugin(row))
        }
      }
      if (res.data.has_more !== true) {
        return { success: true, plugins }
      }
    }
    logForDebugging('plugins_sync_list_page_cap', { level: 'warn' })
    return {
      success: false,
      error: `list-plugins page cap (${LIST_PLUGINS_PAGE_CAP}) exceeded`,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** leftover 239 AZn — one retry unless 403. */
export async function listOrgSyncedPlugins(): Promise<ListOrgPluginsResult> {
  const first = await listOrgSyncedPluginsOnce()
  if (first.success || first.status === 403) return first
  await sleep(LIST_RETRY_MS)
  return listOrgSyncedPluginsOnce()
}

function isZipMagic(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 80 && buf[1] === 75
}

const downloadErrorEnvelopeSchema = z.object({
  error: z.object({
    type: z.string().optional(),
    message: z.string().nullish().catch(undefined),
  }),
})

/** leftover 239 wZn */
export function parseSyncedDownloadErrorBody(buf: Buffer): string {
  try {
    const parsed = downloadErrorEnvelopeSchema.safeParse(
      JSON.parse(buf.toString('utf8', 0, 2048)),
    )
    if (parsed.success) {
      return parsed.data.error.type ?? 'error_envelope_no_type'
    }
  } catch {
    // not an error envelope
  }
  return 'non_json_body'
}

function errorCodeOf(err: unknown): string | undefined {
  if (err !== null && typeof err === 'object' && 'code' in err) {
    const code = err.code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

function destroyAxiosBody(err: unknown): void {
  if (err === null || typeof err !== 'object' || !('response' in err)) return
  const response = err.response
  if (
    response === null ||
    typeof response !== 'object' ||
    !('data' in response)
  )
    return
  const data = response.data
  if (
    data !== null &&
    typeof data === 'object' &&
    'destroy' in data &&
    typeof data.destroy === 'function'
  ) {
    data.destroy()
  }
}

/** leftover 239 HVS — one retry after Vzf. */
export async function retrySyncedDownloadOnce<T extends { ok: boolean }>(
  fn: () => Promise<T>,
): Promise<T> {
  const first = await fn()
  if (first.ok) return first
  await sleep(LIST_RETRY_MS)
  return fn()
}

type DownloadResult = { ok: true } | { ok: false; reason: string }

async function downloadOrgSyncedPluginZipBuffered(
  url: string,
  zipPath: string,
  headers: Record<string, string>,
): Promise<DownloadResult> {
  try {
    const res = await axios.get<ArrayBuffer>(url, {
      headers,
      timeout: DOWNLOAD_TIMEOUT_MS,
      responseType: 'arraybuffer',
      maxContentLength: ZPF_URL_MAX_BYTES,
      validateStatus: () => true,
    })
    if (res.status < 200 || res.status >= 300 || !res.data) {
      logForDebugging('plugins_sync_download_not_ok', { level: 'warn' })
      return { ok: false, reason: res.status ? 'http' : 'empty_body' }
    }
    const buf = Buffer.from(res.data)
    if (!isZipMagic(buf)) {
      logForDebugging('plugins_sync_download_not_zip', { level: 'warn' })
      return {
        ok: false,
        reason:
          buf.length === 0 ? 'empty_body' : parseSyncedDownloadErrorBody(buf),
      }
    }
    await writeFile(zipPath, buf)
    return { ok: true }
  } catch (err) {
    logForDebugging('plugins_sync_download_exception', { level: 'warn' })
    return { ok: false, reason: err instanceof Error ? err.message : 'network' }
  }
}

/** leftover 239 PVS — streamed download with stall timer + byte cap. */
async function downloadOrgSyncedPluginZipStreamed(
  url: string,
  zipPath: string,
  headers: Record<string, string>,
): Promise<DownloadResult> {
  let bytes = 0
  let stalled = false
  try {
    const res = await axios.get(url, {
      headers,
      timeout: DOWNLOAD_TIMEOUT_MS,
      responseType: 'stream',
      validateStatus: () => true,
    })
    if (res.status < 200 || res.status >= 300 || !res.data) {
      logForDebugging('plugins_sync_download_not_ok', { level: 'warn' })
      return { ok: false, reason: res.status ? 'http' : 'empty_body' }
    }
    const stallMs = resolveSyncPluginsDownloadStallMs()
    let stallTimer: ReturnType<typeof setTimeout> | undefined
    let body!: Transform
    const markStalled = (): void => {
      stalled = true
      body.destroy(new Error('plugin download stream stalled'))
    }
    body = new Transform({
      transform(chunk, _enc, cb) {
        if (stallTimer !== undefined) clearTimeout(stallTimer)
        stallTimer = setTimeout(markStalled, stallMs)
        bytes += chunk.length
        if (bytes > ZPF_URL_MAX_BYTES) {
          cb(new Error('plugin zip exceeds download byte cap'))
          return
        }
        cb(null, chunk)
      },
      flush(cb) {
        if (stallTimer !== undefined) clearTimeout(stallTimer)
        cb()
      },
    })
    stallTimer = setTimeout(markStalled, stallMs)
    try {
      await pipeline(res.data, body, createWriteStream(zipPath))
    } finally {
      if (stallTimer !== undefined) clearTimeout(stallTimer)
    }
    const peek = Buffer.alloc(2048)
    const fd = await open(zipPath, 'r')
    let read = 0
    try {
      read = (await fd.read(peek, 0, peek.length, 0)).bytesRead
    } finally {
      await fd.close()
    }
    if (read < 2 || peek[0] !== 80 || peek[1] !== 75) {
      await rm(zipPath, { force: true })
      const reason =
        read === 0
          ? 'empty_body'
          : parseSyncedDownloadErrorBody(peek.subarray(0, read))
      logForDebugging('plugins_sync_download_not_zip', { level: 'warn' })
      return { ok: false, reason }
    }
    return { ok: true }
  } catch (err) {
    await rm(zipPath, { force: true }).catch(() => {})
    destroyAxiosBody(err)
    const code = errorCodeOf(err)
    const reason = stalled
      ? 'timeout'
      : bytes > ZPF_URL_MAX_BYTES
        ? 'too_large'
        : code === 'ECONNRESET' || code === 'EPIPE' || code === 'ETIMEDOUT'
          ? 'network'
          : err instanceof Error
            ? err.message
            : 'network'
    logForDebugging('plugins_sync_download_exception', { level: 'warn' })
    return { ok: false, reason }
  }
}

/** leftover 239 qzf = HVS(() => PVS). */
export async function downloadOrgSyncedPluginZip(
  plugin: SyncedCloudPlugin,
  zipPath: string,
): Promise<DownloadResult> {
  return retrySyncedDownloadOnce(async () => {
    const ctx = await orgCtx()
    const path = cloudPluginDownloadPath(
      plugin.pluginId,
      plugin.requestedVersion,
    )
    const url = `${ctx.base}${expandOrgApiPath(path, ctx.orgUUID)}`
    if (isSyncPluginsBufferedDownloadEnabled()) {
      return downloadOrgSyncedPluginZipBuffered(url, zipPath, ctx.headers)
    }
    return downloadOrgSyncedPluginZipStreamed(url, zipPath, ctx.headers)
  })
}

type ManifestPlugin = {
  pluginId?: string
  name?: string
  version?: string | null
  updatedAt?: string | null
  requestedVersion?: string
  description?: string
}

/** leftover 239 Bln */
export const SYNCED_MANIFEST_MAX_BYTES = 4_194_304

const syncedCloudPluginSchema = z.object({
  pluginId: z.string(),
  name: z.string(),
  description: z.string().catch(''),
  version: z.string().nullable().catch(null),
  updatedAt: z.string().nullable().catch(null),
  requestedVersion: z.string().optional().catch(undefined),
})

/** leftover 239 tVE — leftover keys survive for T1h Hos. */
const syncedManifestDiskSchema = z
  .object({
    lastUpdated: z.number().catch(0),
    plugins: z.array(z.unknown()).optional(),
    staleDirs: z.array(z.unknown()).optional(),
  })
  .passthrough()

type SyncedManifest = {
  lastUpdated: number
  plugins: SyncedCloudPlugin[]
  staleDirs?: string[]
  leftover?: Record<string, unknown>
}

type SyncErrorRow =
  | {
      type: 'network-error'
      source: string
      plugin: string
      url: string
      details: string
    }
  | { type: 'generic-error'; source: string; plugin?: string; error: string }

type PluginsSyncState = {
  syncErrors: SyncErrorRow[]
  pendingTrashRemovals: Array<Promise<void>>
}

const pluginsSync: PluginsSyncState = {
  syncErrors: [],
  pendingTrashRemovals: [],
}

export type SyncedSyncPlan = {
  toDownload: Array<{ item: SyncedCloudPlugin; prev?: SyncedCloudPlugin }>
  toRemove: SyncedCloudPlugin[]
  carryover: SyncedCloudPlugin[]
  liveDirs: Set<string>
  carryoverOwningLiveDir: Set<string>
}

/** leftover 239 Yst */
export function stringArrayOrUndef(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined
}

/** leftover 239 Ios — overlay write-set, keep disk rows not in removed. */
export function mergeSyncedRowsById<T>(
  incoming: readonly T[],
  previous: readonly T[] | undefined,
  idOf: (row: T) => string,
  removedIds: ReadonlySet<string>,
  deferred: readonly T[] = [],
): T[] {
  const byId = new Map<string, T>()
  for (const row of deferred) byId.set(idOf(row), row)
  for (const row of previous ?? []) {
    if (!removedIds.has(idOf(row))) byId.set(idOf(row), row)
  }
  for (const row of incoming) byId.set(idOf(row), row)
  return [...byId.values()]
}

/** leftover 239 ngo */
export function mergeStaleDirs(
  next: readonly string[] | undefined,
  previous: readonly string[] | undefined,
  removed: ReadonlySet<string>,
): string[] | undefined {
  const merged = new Set(next ?? [])
  for (const dir of stringArrayOrUndef(previous) ?? []) merged.add(dir)
  for (const dir of removed) merged.delete(dir)
  return merged.size > 0 ? [...merged] : undefined
}

/** leftover 239 Hos */
export function omitSyncedManifestKeys(
  value: Record<string, unknown> | null | undefined,
  keys: readonly string[],
): Record<string, unknown> {
  const skip = new Set(keys)
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value ?? {})) {
    if (!skip.has(key)) out[key] = item
  }
  return out
}

/** leftover 239 jEr + j1h */
function asCloudPlugin(
  row: ManifestPlugin | unknown,
): SyncedCloudPlugin | null {
  const parsed = syncedCloudPluginSchema.safeParse(row)
  return parsed.success ? parsed.data : null
}

/** leftover 239 Pos */
async function readSyncedManifestText(
  logUnreadable: boolean,
): Promise<string | null> {
  const path = getSyncedPluginsManifestPath()
  try {
    const st = await stat(path)
    if (st.size > SYNCED_MANIFEST_MAX_BYTES) {
      if (logUnreadable) {
        logForDebugging('plugins_sync_manifest_unreadable', { level: 'warn' })
      }
      return null
    }
    return await readFile(path, 'utf8')
  } catch (err) {
    if (logUnreadable && !isENOENT(err)) {
      logForDebugging('plugins_sync_manifest_unreadable', { level: 'warn' })
    }
    return null
  }
}

/** leftover 239 Kyo / Dos */
async function readSyncedManifest(
  logUnreadable: boolean,
): Promise<SyncedManifest | null> {
  const raw = await readSyncedManifestText(logUnreadable)
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    if (logUnreadable) {
      logForDebugging('plugins_sync_manifest_unreadable', { level: 'warn' })
    }
    return null
  }
  const disk = syncedManifestDiskSchema.safeParse(parsed)
  if (!disk.success) {
    if (logUnreadable) {
      logForDebugging('plugins_sync_manifest_unreadable', { level: 'warn' })
    }
    return null
  }
  const { plugins, staleDirs, lastUpdated, ...rest } = disk.data
  return {
    lastUpdated,
    leftover: rest,
    plugins: Array.isArray(plugins)
      ? plugins
          .map(row => asCloudPlugin(row))
          .filter((row): row is SyncedCloudPlugin => row !== null)
      : [],
    staleDirs: stringArrayOrUndef(staleDirs),
  }
}

/**
 * leftover 239 rVE / Ros — download when updatedAt / name / requestedVersion
 * differ (not `version`). Invalid / colliding names keep the previous row.
 */
export function planSyncedPluginSync(
  listed: SyncedCloudPlugin[],
  local: SyncedCloudPlugin[],
  root: string = getSyncedPluginsRoot(),
): SyncedSyncPlan {
  const isRow = (row: unknown): row is SyncedCloudPlugin =>
    typeof row === 'object' && row !== null
  const remote = listed.filter(isRow)
  const previous = local.filter(isRow)
  const prevById = new Map(previous.map(row => [row.pluginId, row]))
  const listedIds = new Set(remote.map(row => row.pluginId))
  const liveDirs = new Set<string>()
  const seenKeys = new Set<string>()
  const toDownload: SyncedSyncPlan['toDownload'] = []
  const carryover: SyncedCloudPlugin[] = []
  const carryoverOwningLiveDir = new Set<string>()

  for (const item of remote) {
    const prev = prevById.get(item.pluginId)
    let dest: string
    try {
      dest = resolveSyncedPluginDir(item.name, root)
    } catch {
      logForDebugging('plugins_sync_invalid_name', { level: 'warn' })
      if (prev) carryover.push(prev)
      continue
    }
    const key = foldSyncedPathKey(dest)
    if (seenKeys.has(key)) {
      logForDebugging('plugins_sync_name_collision', { level: 'warn' })
      if (prev) carryover.push(prev)
      continue
    }
    liveDirs.add(dest)
    seenKeys.add(key)
    if (
      !prev ||
      prev.updatedAt !== item.updatedAt ||
      prev.name !== item.name ||
      prev.requestedVersion !== item.requestedVersion
    ) {
      toDownload.push({ item, prev })
    } else {
      carryover.push(prev)
      carryoverOwningLiveDir.add(prev.pluginId)
    }
  }

  return {
    toDownload,
    toRemove: previous.filter(row => !listedIds.has(row.pluginId)),
    carryover,
    liveDirs,
    carryoverOwningLiveDir,
  }
}

/**
 * leftover 239 zXl write set: B = [...T, ...I, ...M]
 * T unchanged, I downloaded ok, M previous local row when download/extract failed.
 * Failed first-time plugins stay out of the manifest so the next sync retries.
 */
export function mergeSyncedManifestAfterSync(
  listed: SyncedCloudPlugin[],
  downloadIds: ReadonlySet<string>,
  downloaded: SyncedCloudPlugin[],
  local: ManifestPlugin[],
): SyncedCloudPlugin[] {
  const downloadedIds = new Set(downloaded.map(p => p.pluginId))
  const unchanged = listed.filter(
    p => p.name && p.pluginId && !downloadIds.has(p.pluginId),
  )
  const previousOnFail: SyncedCloudPlugin[] = []
  for (const id of downloadIds) {
    if (downloadedIds.has(id)) continue
    const prev = local.find(p => p.pluginId === id)
    const mapped = prev ? asCloudPlugin(prev) : null
    if (mapped) previousOnFail.push(mapped)
  }
  return [...unchanged, ...downloaded, ...previousOnFail]
}

/** leftover 239 S0e user copy — `vD(join(En(), "plugins"))`. */
export function formatSyncedRootRefusedError(
  reason: string,
  code: string | undefined,
  pluginsDir: string,
): string {
  const prefix = `claude.ai plugin sync disabled this session: ${pluginsDir}`
  if (reason === 'unverified' || reason === 'landing_unverified') {
    return `${prefix} could not be verified${code ? ` (${code})` : ''}`
  }
  if (reason === 'landing_absent') {
    return `${prefix} was removed while a sync round was running`
  }
  return `${prefix} is not a plain directory tree (a symlink or stray file is in the way)`
}

export function getSyncedPluginSyncErrors(): readonly SyncErrorRow[] {
  return pluginsSync.syncErrors
}

/** leftover 239 Gyo */
export function recordSyncedPluginError(
  plugin: SyncedCloudPlugin,
  type: 'network-error' | 'generic-error',
  detail: string,
): void {
  const source = `${plugin.name}@${SYNCED_MARKETPLACE_NAME}`
  if (type === 'network-error') {
    pluginsSync.syncErrors.push({
      type,
      source,
      plugin: plugin.name,
      url: cloudPluginDownloadPath(plugin.pluginId, plugin.requestedVersion),
      details: detail,
    })
    return
  }
  pluginsSync.syncErrors.push({
    type,
    source,
    plugin: plugin.name,
    error: detail,
  })
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items]
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      for (;;) {
        const next = queue.shift()
        if (next === undefined) return
        await fn(next)
      }
    },
  )
  await Promise.all(workers)
}

/** leftover 239 k1h */
async function isSameSyncedOccupantName(
  a: string,
  b: string,
  root: string,
): Promise<boolean> {
  try {
    const left = resolveSyncedPluginDir(a, root)
    const right = resolveSyncedPluginDir(b, root)
    return (
      basename(left) === basename(right) ||
      (await sameSyncedOccupant(left, right))
    )
  } catch {
    return false
  }
}

/**
 * leftover 239 zXl — list, download missing/updated, write manifest, qMr.
 * List fail → jXl (hydrate from existing disk).
 */
/** leftover 239 zXl list arm: Fhr → cowork ± AZn, else AZn. */
async function listSyncedPluginsForSync(): Promise<ListOrgPluginsResult> {
  if (isSessionRefsSyncEnabled()) {
    const [cowork, cloud] = await Promise.all([
      listCoworkPluginEntries(),
      isSyncPluginsEnabled() ? listOrgSyncedPlugins() : null,
    ])
    if (!cowork.success) return { success: false, error: cowork.error }
    if (cloud === null) {
      return {
        success: true,
        plugins: cowork.entries.map(mapCoworkListedPlugin),
      }
    }
    if (!cloud.success) return cloud
    return {
      success: true,
      plugins: mergeCoworkAndCloudPlugins(
        cowork.entries.map(mapCoworkListedPlugin),
        cloud.plugins,
      ),
    }
  }
  return listOrgSyncedPlugins()
}

/** leftover 239 nVE */
const EXTRACT_RETRY_MS = 500

function assertGuard(ctx: { guard: { refusedReason(): string | null } }): void {
  const reason = ctx.guard.refusedReason()
  if (reason !== null) throw landingRefused(reason)
}

async function verifyGuard(ctx: {
  guard: { verify(): Promise<boolean> }
}): Promise<SyncedExtractResult | null> {
  return (await ctx.guard.verify()) ? null : SYNCED_ROOT_REFUSED
}

/** leftover 239 x1h */
async function extractAndPromoteSyncedPlugin(
  plugin: SyncedCloudPlugin,
  prev: SyncedCloudPlugin | undefined,
  timings: { downloadMs: number[]; extractMs: number[] },
  ctx: { guard: { refused(): boolean; verify(): Promise<boolean> } },
): Promise<SyncedExtractResult> {
  const root = getSyncedPluginsRoot()
  const dest = resolveSyncedPluginDir(plugin.name, root)
  const staging = join(getSyncedStagingDir(root), relative(root, dest))
  const zipPath = join(
    tmpdir(),
    `claude-plugin-${process.pid}-${Math.random().toString(36).slice(2)}.zip`,
  )
  try {
    if (ctx.guard.refused()) return SYNCED_ROOT_REFUSED
    const downloadStarted = Date.now()
    const got = await downloadOrgSyncedPluginZip(plugin, zipPath)
    timings.downloadMs.push(Date.now() - downloadStarted)
    if (!got.ok) return downloadFailed(got.reason)
    const refused = await verifyGuard(ctx)
    if (refused !== null) return refused
    const extractStarted = Date.now()
    try {
      await rm(staging, { recursive: true, force: true })
      await mkdir(getSyncedStagingDir(root), { recursive: true })
      const unzipped = await execFileNoThrow(
        'unzip',
        ['-q', '-o', zipPath, '-d', staging],
        { useCwd: false },
      )
      const walk =
        unzipped.code === 0
          ? await auditSyncedExtractTree(staging).catch(
              () => 'walk_failed' as const,
            )
          : 'unzip_failed'
      if (walk !== 'ok') {
        logForDebugging('plugins_sync_unzip_fallback', { level: 'info' })
        await rm(staging, { recursive: true, force: true })
        await extractZipToDirectory(zipPath, staging, {
          skipEntry: skipZipEntryIfReserved,
        })
      }
      const pluginRoot = await unwrapZpfZipRoot(staging)
      if (await extractedTreeIsBareRepo(pluginRoot)) {
        return extractFailed('extracted tree carries a bare-repo layout')
      }
      const refusedAfter = await verifyGuard(ctx)
      if (refusedAfter !== null) return refusedAfter
      try {
        await rename(pluginRoot, dest)
        return SYNCED_EXTRACT_OK
      } catch (err) {
        const code = getErrnoCode(err)
        if (!isOccupantRenameErrno(code)) {
          logForDebugging('plugins_sync_promotion_failed', { level: 'warn' })
          return promotionFailed(code)
        }
      }
      let sameOccupant =
        prev !== undefined &&
        (await isSameSyncedOccupantName(prev.name, plugin.name, root))
      if (!sameOccupant) {
        const disk = await readSyncedManifest(false)
        for (const row of disk?.plugins ?? []) {
          if (
            row.pluginId === plugin.pluginId &&
            (await isSameSyncedOccupantName(row.name, plugin.name, root))
          ) {
            sameOccupant = true
            break
          }
        }
      }
      let displaced: string | undefined
      if (sameOccupant) {
        displaced = join(
          getSyncedStagingDir(root),
          `.replaced-${process.pid}-${Math.random().toString(36).slice(2)}`,
        )
        try {
          await rename(dest, displaced)
        } catch (err) {
          logForDebugging('plugins_sync_occupant_displace_failed', {
            level: 'warn',
          })
          void getErrnoCode(err)
          return SYNCED_OCCUPANT_STUCK
        }
      } else if (
        !(await moveSyncedDirToTrash({
          dir: dest,
          trashRoot: getSyncedPluginsTrashRoot(),
          configHome: getSyncedConfigHome(),
          failureEvent: 'plugins_sync_trash_move_failed',
        }))
      ) {
        return SYNCED_OCCUPANT_STUCK
      }
      try {
        await rename(pluginRoot, dest)
      } catch (err) {
        const restored =
          displaced === undefined
            ? false
            : await rename(displaced, dest)
                .then(() => true)
                .catch(() => false)
        logForDebugging('plugins_sync_promotion_failed', { level: 'warn' })
        void restored
        return promotionFailed(getErrnoCode(err))
      }
      if (displaced !== undefined) {
        pluginsSync.pendingTrashRemovals.push(
          rm(displaced, { recursive: true, force: true }).catch(() => {}),
        )
      }
      return SYNCED_EXTRACT_OK
    } finally {
      timings.extractMs.push(Date.now() - extractStarted)
    }
  } finally {
    await rm(zipPath, { force: true }).catch(() => {})
    if (
      !ctx.guard.refused() &&
      (await auditSyncedRoot(
        root,
        getSyncedConfigHome(),
        {
          event: 'plugins_sync_root_refused',
          phase: 'sweep',
          rootLabel: SYNCED_PLUGINS_ROOT_LABEL,
        },
        { checkStagingLeaf: true },
      ).catch(() => null)) === 'real'
    ) {
      await rm(staging, { recursive: true, force: true }).catch(() => {})
    }
  }
}

/** leftover 239 oVE */
async function extractSyncedPluginWithRetry(
  plugin: SyncedCloudPlugin,
  prev: SyncedCloudPlugin | undefined,
  timings: { downloadMs: number[]; extractMs: number[] },
  ctx: { guard: { refused(): boolean; verify(): Promise<boolean> } },
): Promise<SyncedExtractResult> {
  try {
    return await extractAndPromoteSyncedPlugin(plugin, prev, timings, ctx)
  } catch {
    logForDebugging('plugins_sync_extract_retry', { level: 'warn' })
    await sleep(EXTRACT_RETRY_MS)
    return extractAndPromoteSyncedPlugin(plugin, prev, timings, ctx)
  }
}

/** leftover 239 P1h */
async function trashOrphanSyncedDirs(
  ctx: { guard: { verify(): Promise<boolean> } },
  listed: SyncedCloudPlugin[],
): Promise<void> {
  if (!(await ctx.guard.verify())) return
  const root = getSyncedPluginsRoot()
  const disk = await readSyncedManifest(false)
  if (!disk) return
  const keep = new Set<string>()
  for (const row of [...disk.plugins, ...listed]) {
    try {
      keep.add(
        foldSyncedPathKey(basename(resolveSyncedPluginDir(row.name, root))),
      )
    } catch {
      // invalid name — skip
    }
  }
  for (const stale of disk.staleDirs ?? []) keep.add(foldSyncedPathKey(stale))
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  let trashed = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (isReservedDottedSyncedName(entry.name)) continue
    if (keep.has(foldSyncedPathKey(entry.name))) continue
    if (
      await moveSyncedDirToTrash({
        dir: join(root, entry.name),
        trashRoot: getSyncedPluginsTrashRoot(),
        configHome: getSyncedConfigHome(),
        failureEvent: 'plugins_sync_trash_move_failed',
      })
    ) {
      trashed++
    }
  }
  if (trashed > 0) {
    logForDebugging('plugins_sync_orphan_dir_trashed', { level: 'info' })
  }
}

/** leftover 239 T1h */
async function writeSyncedManifest(
  ctx: { guard: { refusedReason(): string | null }; manifestRead: boolean },
  next: SyncedManifest,
  merge: { staleDirs: Set<string>; removedPluginIds: Set<string> },
): Promise<void> {
  assertGuard(ctx)
  await ensureSyncedRootRound({
    root: getSyncedPluginsRoot(),
    trashRoot: getSyncedPluginsTrashRoot(),
    configHome: getSyncedConfigHome(),
    event: 'plugins_sync_root_refused',
  })
  const disk = await readSyncedManifest(false)
  await writeFile(
    getSyncedPluginsManifestPath(),
    JSON.stringify(
      {
        ...omitSyncedManifestKeys(
          {
            ...(disk?.leftover ?? {}),
            lastUpdated: disk?.lastUpdated,
            plugins: disk?.plugins,
            staleDirs: disk?.staleDirs,
          },
          ['lastUpdated', 'plugins', 'staleDirs'],
        ),
        lastUpdated: next.lastUpdated,
        plugins: mergeSyncedRowsById(
          next.plugins
            .map(row => asCloudPlugin(row))
            .filter((row): row is SyncedCloudPlugin => row !== null),
          disk?.plugins,
          row => row.pluginId,
          merge.removedPluginIds,
        ),
        staleDirs: mergeStaleDirs(
          next.staleDirs,
          disk?.staleDirs,
          merge.staleDirs,
        ),
      },
      null,
      2,
    ),
  )
}

function timingSummary(timings: { downloadMs: number[]; extractMs: number[] }) {
  return {
    download_ms_sum: timings.downloadMs.reduce((a, b) => a + b, 0),
    download_ms_max: Math.max(0, ...timings.downloadMs),
    extract_ms_sum: timings.extractMs.reduce((a, b) => a + b, 0),
    extract_ms_max: Math.max(0, ...timings.extractMs),
  }
}

export async function syncCloudSyncedPlugins(): Promise<void> {
  const started = Date.now()
  pluginsSync.syncErrors = []
  let loopDelay: ReturnType<typeof monitorEventLoopDelay> | undefined
  try {
    loopDelay = monitorEventLoopDelay({ resolution: 20 })
    loopDelay.enable()
  } catch {
    // bun/node without event-loop delay histogram
  }
  const loopLag = (): {
    loop_lag_p95_ms?: number
    loop_lag_max_ms?: number
  } => {
    if (!loopDelay) return {}
    loopDelay.disable()
    return {
      loop_lag_p95_ms: Math.round(loopDelay.percentile(95) / 1e6),
      loop_lag_max_ms: Math.round(loopDelay.max / 1e6),
    }
  }
  const timings = { downloadMs: [] as number[], extractMs: [] as number[] }
  const ctx = createSyncedManifestCtx({
    root: getSyncedPluginsRoot,
    configHome: getSyncedConfigHome,
    rootLabel: SYNCED_PLUGINS_ROOT_LABEL,
    event: 'plugins_sync_root_refused',
  })
  let listedOk = false
  let registered = false
  let listMs: number | undefined
  try {
    logForDebugging('plugins_sync_starting', { level: 'info' })
    await ensureSyncedRootRound({
      root: getSyncedPluginsRoot(),
      trashRoot: getSyncedPluginsTrashRoot(),
      configHome: getSyncedConfigHome(),
      event: 'plugins_sync_root_refused',
    })
    listedOk = true
    const listStarted = Date.now()
    const listed = await listSyncedPluginsForSync()
    listMs = Date.now() - listStarted
    if (!listed.success) {
      logForDebugging('plugins_sync_list_failed', { level: 'warn' })
      logEvent('tengu_plugins_sync_list_failed', {
        duration_ms: Date.now() - started,
        list_ms: listMs,
        ...loopLag(),
      })
      await hydrateSyncedPluginDirsFromDisk()
      return
    }

    const root = getSyncedPluginsRoot()
    const disk = await readSyncedManifest(!ctx.manifestRead)
    ctx.manifestRead = true
    const hadManifest = disk !== null
    const plan = planSyncedPluginSync(listed.plugins, disk?.plugins ?? [], root)
    const missingCarryover = new Set<string>()
    const missing = await Promise.all(
      plan.carryover.map(async row => {
        if (!plan.carryoverOwningLiveDir.has(row.pluginId)) return false
        try {
          return !(
            await lstat(resolveSyncedPluginDir(row.name, root))
          ).isDirectory()
        } catch {
          return true
        }
      }),
    )
    for (const [index, row] of plan.carryover.entries()) {
      if (!missing[index]) continue
      const fresh = listed.plugins.find(item => item.pluginId === row.pluginId)
      if (fresh) {
        missingCarryover.add(row.pluginId)
        plan.toDownload.push({ item: fresh, prev: row })
      }
    }
    const carryoverKept = plan.carryover.filter(
      row => !missingCarryover.has(row.pluginId),
    )

    await Promise.all(pluginsSync.pendingTrashRemovals.splice(0))
    if ((await verifyGuard(ctx)) === null) {
      await rm(getSyncedStagingDir(root), {
        recursive: true,
        force: true,
      }).catch(() => {})
    }

    const stale = new Set(disk?.staleDirs ?? [])
    const clearedStale = new Set<string>()
    const classifyLive = createSyncedLiveDirClassifier(plan.liveDirs)
    const trashIfNotLive = async (name: string): Promise<boolean> => {
      let dest: string
      try {
        dest = resolveSyncedItemLeaf(name, root)
      } catch (err) {
        return err instanceof LegacyReservedSpellingError ? false : true
      }
      const kind = await classifyLive(dest)
      if (kind === 'live') return true
      if (kind === 'indeterminate') return false
      return moveSyncedDirToTrash({
        dir: dest,
        trashRoot: getSyncedPluginsTrashRoot(),
        configHome: getSyncedConfigHome(),
        failureEvent: 'plugins_sync_trash_move_failed',
      })
    }
    for (const name of stale) {
      if (await trashIfNotLive(name)) {
        stale.delete(name)
        clearedStale.add(name)
      }
    }

    if (plan.toDownload.length === 0 && plan.toRemove.length === 0) {
      assertGuard(ctx)
      setSyncedPluginDirs([...plan.liveDirs])
      registered = true
      if (clearedStale.size > 0 && disk) {
        await writeSyncedManifest(
          ctx,
          {
            lastUpdated: disk.lastUpdated,
            plugins: disk.plugins,
            staleDirs: stale.size > 0 ? [...stale] : undefined,
          },
          { staleDirs: clearedStale, removedPluginIds: new Set() },
        )
      }
      await trashOrphanSyncedDirs(ctx, listed.plugins)
      logForDebugging('plugins_sync_no_changes', { level: 'info' })
      void loopLag()
      return
    }

    const downloaded: SyncedCloudPlugin[] = []
    const previousOnFail: SyncedCloudPlugin[] = []
    const extractStarted = Date.now()
    await mapPool(
      plan.toDownload,
      DOWNLOAD_CONCURRENCY,
      async ({ item, prev }) => {
        let result: SyncedExtractResult
        try {
          result = await extractSyncedPluginWithRetry(item, prev, timings, ctx)
          if (!result.ok) {
            switch (result.cause) {
              case 'download':
                logForDebugging('plugins_sync_download_failed', {
                  level: 'warn',
                })
                recordSyncedPluginError(item, 'network-error', result.reason)
                break
              case 'root_refused':
              case 'extract':
              case 'local':
              case 'deferred':
                if (result.cause === 'deferred') {
                  logForDebugging('plugins_sync_unexpected_landing_cause', {
                    level: 'warn',
                  })
                }
                recordSyncedPluginError(item, 'generic-error', result.reason)
                break
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          result = extractFailed(message)
          logForDebugging('plugins_sync_extract_failed', { level: 'warn' })
          recordSyncedPluginError(item, 'generic-error', message)
        }
        if (result.ok) {
          downloaded.push(item)
          if (prev && prev.name !== item.name) {
            if (!(await trashIfNotLive(prev.name))) stale.add(prev.name)
          }
        } else if (prev) {
          previousOnFail.push(prev)
        }
      },
    )
    const downloadExtractMs = Date.now() - extractStarted
    await mapPool(plan.toRemove, DOWNLOAD_CONCURRENCY, async row => {
      if (!(await trashIfNotLive(row.name))) stale.add(row.name)
    })

    const kept = [...carryoverKept, ...downloaded, ...previousOnFail]
    assertGuard(ctx)
    setSyncedPluginDirs(dirsFromSyncedManifest(kept, root))
    registered = true
    await writeSyncedManifest(
      ctx,
      {
        lastUpdated: Date.now(),
        plugins: kept,
        staleDirs: stale.size > 0 ? [...stale] : undefined,
      },
      {
        staleDirs: clearedStale,
        removedPluginIds: new Set(plan.toRemove.map(row => row.pluginId)),
      },
    )
    await trashOrphanSyncedDirs(ctx, listed.plugins)
    logForDebugging('plugins_sync_complete', { level: 'info' })
    logEvent('tengu_plugins_sync_success', {
      downloaded: downloaded.length,
      removed: plan.toRemove.length,
      total: listed.plugins.length,
      duration_ms: Date.now() - started,
      list_ms: listMs,
      download_extract_ms: downloadExtractMs,
      had_manifest: hadManifest,
      failed: pluginsSync.syncErrors.length,
      ...timingSummary(timings),
      ...loopLag(),
    } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
  } catch (err) {
    const lag = loopLag()
    if (!(err instanceof SyncOwnedRootRefusedError)) {
      logForDebugging(
        `plugins_sync_unexpected_error: ${err instanceof Error ? err.message : String(err)}`,
        { level: 'error' },
      )
      logEvent('tengu_plugins_sync_error', {
        duration_ms: Date.now() - started,
        ...(listMs !== undefined && { list_ms: listMs }),
        ...(timings.downloadMs.length > 0 ? timingSummary(timings) : {}),
        ...lag,
      })
    }
    if (err instanceof SyncOwnedRootRefusedError && registered) {
      logForDebugging('plugins_sync_post_registration_refusal', {
        level: 'warn',
      })
      logEvent('tengu_plugins_sync_root_refused', {
        reason: err.reason,
        phase: 'post_registration',
        duration_ms: Date.now() - started,
      } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
      listedOk = false
    } else if (err instanceof SyncOwnedRootRefusedError) {
      logForDebugging('plugins_sync_root_refused_fail_closed', {
        level: 'warn',
      })
      logEvent('tengu_plugins_sync_root_refused', {
        reason: err.reason,
        phase: 'head',
        duration_ms: Date.now() - started,
      } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
      pluginsSync.syncErrors.push({
        type: 'generic-error',
        source: `${SYNCED_MARKETPLACE_NAME}[root]`,
        error: formatSyncedRootRefusedError(
          err.reason,
          err.code,
          getPluginsDirectory(),
        ),
      })
      setSyncedPluginDirs([])
    } else if (!registered) {
      await hydrateSyncedPluginDirsFromDisk()
    }
  } finally {
    if (ctx.guard.refused()) listedOk = false
    if (listedOk) {
      const staging = getSyncedStagingDir()
      const sweep = Promise.all(
        pluginsSync.pendingTrashRemovals.splice(0),
      ).then(async () => {
        if (
          (await auditSyncedRoot(
            getSyncedPluginsRoot(),
            getSyncedConfigHome(),
            {
              event: 'plugins_sync_root_refused',
              phase: 'sweep',
              rootLabel: SYNCED_PLUGINS_ROOT_LABEL,
            },
            { checkStagingLeaf: true },
          ).catch(() => null)) === 'real'
        ) {
          await rm(staging, { recursive: true, force: true }).catch(() => {})
        }
      })
      pluginsSync.pendingTrashRemovals.push(sweep)
    }
  }
}

let firstSyncPromise: Promise<void> | null = null

/** leftover 239 qyo — L1h/N1h/$1h callers. */
export function isSyncedPluginSyncKickEnabled(): boolean {
  return isSyncPluginsEnabled() || isSessionRefsSyncEnabled()
}

/** leftover 239 L1h */
export function kickFirstSyncedPluginSync(): void {
  firstSyncPromise ??= syncCloudSyncedPlugins().catch(err => {
    logForDebugging(
      `plugins_sync_unexpected_error: ${err instanceof Error ? err.message : String(err)}`,
      { level: 'error' },
    )
    logEvent('tengu_plugins_sync_error', {
      duration_ms: 0,
    })
  })
}

/** leftover 239 N1h — official always kicks zXl (env only gates AZn under Fhr). */
export function awaitFirstSyncedPluginSync(): Promise<void> {
  kickFirstSyncedPluginSync()
  return firstSyncPromise ?? Promise.resolve()
}

/**
 * leftover 239 $1h — Uln.discardInflight() then remint zXl after
 * the in-flight round settles.
 */
export function remintFirstSyncedPluginSync(): Promise<void> {
  getSessionRefsStore().discardInflight()
  firstSyncPromise = (firstSyncPromise ?? Promise.resolve())
    .catch(() => {})
    .then(() => syncCloudSyncedPlugins())
  return firstSyncPromise
}

/** leftover 239 N1h then T0r — product load/enable/disable sites. */
export async function ensureSyncedPluginDirsHydrated(): Promise<void> {
  await awaitFirstSyncedPluginSync()
  await hydrateSyncedPluginDirsFromDisk()
}

export function resetFirstSyncedPluginSyncForTests(): void {
  firstSyncPromise = null
}
