/**
 * Official 325 Artifact Database (`read_db` / `write_db`) support:
 * - `#1756`: 1-hour `dbUndeclaredAt` cache so repeated DB calls aren't sent to
 *   artifacts without a database, plus clear republish guidance.
 * - `#1757`: `read_db` `out_dir` local path resolution & validation.
 * - `#1798`: Clear error messages when an update targets a missing document or
 *   when the service pauses repeated refused writes (`refused_writes`).
 * - `#1818`: Hidden marker files alongside saved DB row exports so existing
 *   files without a marker (user files or older exports) are left untouched
 *   and reported.
 * - `#1916`: `scan_budget` error guidance telling Claude to drop `query.order_by`,
 *   page with `query.cursor`, and sort results itself.
 */
import { constants as fsConstants } from 'fs'
import { lstat, mkdir, open, unlink, writeFile } from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'
import { parseArtifactUrlAnyCase } from '../../utils/artifactUrl.js'
import { getClaudeAIOAuthTokens } from '../../utils/auth.js'
import { getCwd } from '../../utils/cwd.js'
import { frameControlPlaneHeaders } from './mint.js'
import { un } from './store.js'

/** Official `pt` = 1 hour TTL for remembered undeclared-database answers. */
export const DB_UNDECLARED_TTL_MS = 3_600_000
export const DB_UNDECLARED_REMEMBERED_REASON = 'not_declared_remembered'

export const ARTIFACT_DB_MARKER_PREFIX = '.'
export const ARTIFACT_DB_MARKER_SUFFIX = '.claude-artifact-db-marker'

export type ArtifactDbOp = 'read' | 'write'

export type ArtifactDbErrorCode =
  | 'not_declared'
  | 'not_found'
  | 'forbidden'
  | 'invalid_argument'
  | 'too_large'
  | 'quota_or_rate'
  | 'quota_exceeded'
  | 'busy'
  | 'upstream_auth'
  | 'store_unavailable'
  | 'store_read_only'
  | 'credential_rejected'
  | 'cloud_unavailable'
  | 'vm_unavailable'
  | 'restricted_sandbox'
  | 'network_off'
  | 'version_mismatch'

export type ArtifactDbErrorDetails = {
  kind?: string
  reason?: string
  limit?: number
  op?: 'set' | 'update' | 'delete' | 'str_replace'
  path?: string
  required?: boolean
  pinned?: string | number
  current?: string | number
  resolvesMe?: boolean
  republishHelps?: boolean
}

export type ArtifactDbCachedUndeclaredResult = {
  kind: 'error'
  code: 'not_declared'
  reason: typeof DB_UNDECLARED_REMEMBERED_REASON
  message: string
}

/**
 * Official 325 `ce` (#1756) — check whether `slug` was remembered as having no
 * database within the last hour; if so, return a cached error without sending
 * a network request.
 */
export function checkRememberedDbUndeclared(
  slug: string,
  op: ArtifactDbOp = 'read',
  now: number = Date.now(),
): ArtifactDbCachedUndeclaredResult | undefined {
  const store = un()
  const recordedAt = store.dbUndeclaredAt.get(slug)
  if (recordedAt === undefined) return undefined
  if (now - recordedAt >= DB_UNDECLARED_TTL_MS) {
    store.dbUndeclaredAt.delete(slug)
    return undefined
  }
  const baseMessage = formatArtifactDbError('not_declared', op, {})
  return {
    kind: 'error',
    code: 'not_declared',
    reason: DB_UNDECLARED_REMEMBERED_REASON,
    message: `${baseMessage} (this repeats the server's answer from earlier in this session; the call was not sent. The server is asked again an hour after that answer, or sooner if this session publishes the artifact, sees a new version of it, or sees its capabilities include a database)`,
  }
}

/**
 * Official 325 `fe` (#1756) — remember a 404 `not_declared` answer for `slug`
 * unless a newer publish/version invalidated the entry while the request was
 * in flight.
 */
export function rememberDbUndeclared(
  slug: string,
  httpStatus: number,
  reason: string | undefined,
  requestStartedAt: number = Date.now(),
): void {
  if (httpStatus !== 404 || reason !== 'not_declared') return
  const store = un()
  const droppedAt = store.dbUndeclaredDroppedAt.get(slug)
  if (droppedAt !== undefined && requestStartedAt <= droppedAt) return
  store.dbUndeclaredAt.set(slug, Date.now())
}

/**
 * Official 325 `le` (#1756) — invalidate any remembered `not_declared` entry
 * when this session publishes the artifact, observes a new version, or sees
 * database capabilities declared.
 */
export function clearDbUndeclared(slug: string, at: number = Date.now()): void {
  const store = un()
  store.dbUndeclaredAt.delete(slug)
  const prev = store.dbUndeclaredDroppedAt.get(slug)
  if (prev === undefined || prev < at) {
    store.dbUndeclaredDroppedAt.set(slug, at)
  }
}

export function isRememberedDbUndeclared(slug: string): boolean {
  return un().dbUndeclaredAt.has(slug)
}

/**
 * Official 325 `we` (#1798, #1916) — format quota/rate/scan_budget/refused_writes
 * detail strings for artifact database operations.
 */
export function formatArtifactDbQuotaOrRateReason(
  kind: string | undefined,
  limit?: number,
): string | undefined {
  const docLimit =
    limit === undefined ? 'document limit' : `limit of ${limit} documents`
  const byteLimit =
    limit === undefined ? 'storage limit' : `storage limit of ${limit} bytes`
  switch (kind) {
    case 'docs_per_collection':
      return `this collection has reached its ${docLimit} — delete documents; retrying won't help`
    case 'docs_per_database':
      return `this artifact's database has reached its ${docLimit} — delete documents before adding more; retrying won't help`
    case 'bytes_per_database':
      return `this artifact's database has reached its ${byteLimit} (the total size of its documents, not their count) — delete documents or make them smaller; a write that makes an existing document larger can be refused too, and retrying won't help`
    case 'databases_per_org':
      return "this organization has reached its limit on artifact databases; retrying won't help"
    case 'active_leases':
      return 'this database has too many active leases — retry after some expire or are released'
    case 'rate_limited':
      return 'rate-limited — retry shortly'
    case 'write_capacity':
      return 'too many concurrent writes to this database — retry shortly'
    case 'scan_budget':
      return 'this collection holds too much data to sort, whatever `query.where` or `query.limit` you pass — drop `query.order_by`, page with `query.cursor` and sort the results yourself; an ordered query will keep failing until the collection holds fewer or smaller documents'
    case 'response_budget':
      return "the query's result is too large — request fewer documents; retrying won't help"
    case 'refused_writes':
      return 'the server refused this operation on this path earlier (a missing document, a path you may not write, or an invalid argument), and after repeated refused writes to this artifact it is briefly turning away repeats of it, whatever data they carry; this write was not applied. Do not resend it unchanged now: use a different operation or path (for example set, to create a document that should exist); if it was refused for its data, fix the data and send it again in a few minutes; otherwise stop'
    default:
      return undefined
  }
}

/**
 * Official 325 `P` (#1756, #1798, #1916) — format human/model-readable artifact
 * database error messages.
 */
export function formatArtifactDbError(
  code: ArtifactDbErrorCode,
  op: ArtifactDbOp,
  details: ArtifactDbErrorDetails = {},
): string {
  const prefix = `db ${op} failed (${code})`
  switch (code) {
    case 'not_declared':
      if (details.resolvesMe) {
        return `${prefix}: resolving 'me' needs this artifact's published version to declare the db and user capabilities — republish with both declared, then retry`
      }
      if (details.republishHelps === true) {
        return `${prefix}: the version of this artifact served to this session does not declare the database capability — republish with the database capability declared, then retry`
      }
      if (details.republishHelps === false) {
        return `${prefix}: the version of this artifact served to this session does not declare the database capability (republishing is not available for this artifact; do not retry)`
      }
      return `${prefix}: the version of this artifact served to this session does not declare the database capability`
    case 'not_found':
      if (op === 'write' && details.op === 'update') {
        const target = details.path ?? 'that document'
        return `${prefix}: ${target} does not exist, so this update was not applied — do not retry update on a missing document; use "set" to create it if it should exist`
      }
      return `${prefix}: the requested ${details.path ?? 'document'} does not exist`
    case 'quota_or_rate': {
      const detail = formatArtifactDbQuotaOrRateReason(
        details.kind ?? details.reason,
        details.limit,
      )
      return `${prefix}: ${detail ?? 'over a rate or storage limit — retry later or write less'}`
    }
    case 'quota_exceeded': {
      const detail = formatArtifactDbQuotaOrRateReason(
        details.kind ?? details.reason,
        details.limit,
      )
      return `${prefix}: ${detail ?? "a storage limit on this artifact's database has been reached — delete documents; retrying won't help"}`
    }
    case 'invalid_argument':
      return `${prefix}: the server could not accept the request as shaped${details.reason ? ` (reason: ${details.reason})` : ''}`
    case 'too_large':
      return `${prefix}: the request body exceeds the server's size limit — send less per call`
    case 'busy':
      return `${prefix}: lost to a concurrent change — re-read and retry deliberately`
    case 'upstream_auth':
      return `${prefix}: could not authenticate — the session's credential may need a refresh; try again`
    case 'store_unavailable':
      return `${prefix}: the store is unavailable right now — try again`
    case 'store_read_only':
      return `${prefix}; nothing was written. This document is read-only`
    case 'credential_rejected':
      return `${prefix}: the server refused this session's credential at the artifact-db door — not an artifact-access or existence answer; report this as a client/server integration fault`
    case 'cloud_unavailable':
      return `${prefix}: reading and editing artifact data isn't available in this cloud session right now; this says nothing about the artifact or its data, and if the user has access, Claude Code on their own machine can still read and edit it`
    case 'vm_unavailable':
      return `${prefix}: artifact data isn't available here`
    case 'network_off':
      return op === 'read'
        ? `${prefix}: this cloud session's network access is turned off (or could not be confirmed), so it cannot read artifact data; do not retry the read here`
        : `${prefix}: this cloud session's network access is turned off (or could not be confirmed), and the gateway did not accept this call as a write it allows — do not retry it here`
    case 'version_mismatch': {
      const target = details.path ?? 'that document'
      if (details.required === true) {
        return `${prefix}: ${target} already exists and this write carried no if_version — nothing was written. Read it back with read_db, base the change on what it holds now, and resend with if_version set to the version that read returns`
      }
      return details.current !== undefined
        ? `${prefix}: the document is no longer at version ${details.pinned ?? '?'}, the one this write was pinned to — it is now at version ${details.current}; nothing was written. Read it back, re-plan the write against what it holds now, and pin to that version`
        : `${prefix}: the document is no longer at version ${details.pinned ?? '?'}, the one this write was pinned to — it has changed or may have been deleted; nothing was written. Read it back before retrying`
    }
    case 'forbidden':
    case 'restricted_sandbox':
    default:
      return `${prefix}: access to this artifact's database was refused${details.reason ? ` (${details.reason})` : ''}`
  }
}

/**
 * Compute the hidden marker path alongside a saved DB export file (#1818).
 */
export function getArtifactDbRowMarkerPath(filePath: string): string {
  return join(
    dirname(filePath),
    `${ARTIFACT_DB_MARKER_PREFIX}${basename(filePath)}${ARTIFACT_DB_MARKER_SUFFIX}`,
  )
}

export type SaveArtifactDbRowResult =
  | { status: 'written'; filePath: string; markerPath: string }
  | {
      status: 'skipped_existing_unmarked'
      filePath: string
      markerPath: string
      reason: string
    }

async function lstatIfExists(filePath: string) {
  try {
    return await lstat(filePath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw err
  }
}

async function writeFileNoFollow(
  targetPath: string,
  data: string,
  label: string,
): Promise<void> {
  const noFollow = fsConstants.O_NOFOLLOW ?? 0
  const flags =
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | noFollow
  let fh: Awaited<ReturnType<typeof open>> | undefined
  try {
    fh = await open(targetPath, flags, 0o666)
    await fh.writeFile(data, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ELOOP') {
      throw new Error(`Refusing to write ${label} to symlink: ${targetPath}`)
    }
    throw err
  } finally {
    await fh?.close()
  }
}

/**
 * Official 325 #1818 — save an exported DB row file into `outDir` with a
 * companion hidden marker file. If the target file already exists WITHOUT the
 * hidden marker (including user-authored files or exports from earlier
 * versions), leave it untouched and report it instead of overwriting.
 * Refuses symlinks (including dangling symlinks) via `lstat` / `O_NOFOLLOW`
 * and uses `flag: 'wx'` for new files to prevent TOCTOU overwrites.
 */
export async function saveArtifactDbRowWithMarker(
  outDir: string,
  filename: string,
  content: string,
  options?: { sharedByOthers?: boolean },
): Promise<SaveArtifactDbRowResult> {
  const safeName = basename(filename)
  if (!safeName || safeName === '.' || safeName === '..') {
    throw new Error(`Invalid DB export filename: ${filename}`)
  }
  const resolvedDir = resolve(getCwd(), outDir)
  const filePath = join(resolvedDir, safeName)
  const markerPath = getArtifactDbRowMarkerPath(filePath)
  const checkMarker = options?.sharedByOthers !== false

  const fileStat = await lstatIfExists(filePath)
  if (fileStat?.isSymbolicLink()) {
    throw new Error(
      `Refusing to write artifact DB export to symlink: ${filePath}`,
    )
  }
  const markerStat = await lstatIfExists(markerPath)
  if (markerStat?.isSymbolicLink()) {
    throw new Error(`Refusing to use symlink artifact DB marker: ${markerPath}`)
  }

  const hasValidMarker = markerStat !== null && markerStat.isFile()
  if (checkMarker && fileStat !== null && !hasValidMarker) {
    return {
      status: 'skipped_existing_unmarked',
      filePath,
      markerPath,
      reason: `Left existing file untouched because it has no hidden artifact DB export marker (it may be a user file or an export from an earlier version): ${filePath}`,
    }
  }

  await mkdir(resolvedDir, { recursive: true })
  const markerPayload = JSON.stringify({
    v: 1,
    savedAt: new Date().toISOString(),
  })

  if (fileStat === null) {
    let createdNewFile = false
    try {
      await writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' })
      createdNewFile = true
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw err
      }
      const racedFileStat = await lstatIfExists(filePath)
      if (racedFileStat?.isSymbolicLink()) {
        throw new Error(
          `Refusing to write artifact DB export to symlink: ${filePath}`,
        )
      }
      const racedMarkerStat = await lstatIfExists(markerPath)
      if (racedMarkerStat?.isSymbolicLink()) {
        throw new Error(
          `Refusing to use symlink artifact DB marker: ${markerPath}`,
        )
      }
      if (
        checkMarker &&
        !(racedMarkerStat !== null && racedMarkerStat.isFile())
      ) {
        return {
          status: 'skipped_existing_unmarked',
          filePath,
          markerPath,
          reason: `Left existing file untouched because it has no hidden artifact DB export marker (it may be a user file or an export from an earlier version): ${filePath}`,
        }
      }
      await writeFileNoFollow(filePath, content, 'artifact DB export')
    }
    try {
      await writeFileNoFollow(markerPath, markerPayload, 'artifact DB marker')
    } catch (err) {
      if (createdNewFile) {
        await unlink(filePath).catch(() => {})
      }
      throw err
    }
  } else {
    await writeFileNoFollow(filePath, content, 'artifact DB export')
    await writeFileNoFollow(markerPath, markerPayload, 'artifact DB marker')
  }

  return { status: 'written', filePath, markerPath }
}

/**
 * Parse a structured server error payload from an artifact DB HTTP response
 * into `(code, details)` suitable for `formatArtifactDbError`.
 */
export function parseArtifactDbHttpError(
  status: number,
  body: unknown,
  op: ArtifactDbOp,
  context?: {
    writeOp?: 'set' | 'update' | 'delete' | 'str_replace'
    path?: string
  },
): { code: ArtifactDbErrorCode; details: ArtifactDbErrorDetails } {
  const errObj =
    body && typeof body === 'object' && 'error' in body
      ? ((body as { error?: Record<string, unknown> }).error ?? {})
      : {}
  const rawCode = typeof errObj.code === 'string' ? errObj.code : undefined
  const rawKind = typeof errObj.kind === 'string' ? errObj.kind : undefined
  const limit =
    typeof errObj.limit === 'number' && Number.isSafeInteger(errObj.limit)
      ? errObj.limit
      : undefined
  const baseDetails: ArtifactDbErrorDetails = {
    kind: rawKind,
    reason: rawKind ?? rawCode,
    limit,
    op: context?.writeOp,
    path: context?.path,
  }
  if (
    status === 404 &&
    (rawCode === 'not_declared' || rawKind === 'not_declared')
  ) {
    return {
      code: 'not_declared',
      details: { ...baseDetails, reason: 'not_declared' },
    }
  }
  if (status === 404) {
    return { code: 'not_found', details: baseDetails }
  }
  if (
    rawKind === 'scan_budget' ||
    rawKind === 'refused_writes' ||
    rawKind === 'rate_limited' ||
    rawKind === 'write_capacity' ||
    rawKind === 'response_budget' ||
    rawKind === 'active_leases'
  ) {
    return { code: 'quota_or_rate', details: baseDetails }
  }
  if (
    rawKind === 'docs_per_collection' ||
    rawKind === 'docs_per_database' ||
    rawKind === 'bytes_per_database' ||
    rawKind === 'databases_per_org'
  ) {
    return { code: 'quota_exceeded', details: baseDetails }
  }
  if (status === 429) {
    return {
      code: 'quota_or_rate',
      details: { ...baseDetails, kind: rawKind ?? 'rate_limited' },
    }
  }
  if (status === 409) {
    return { code: 'version_mismatch', details: baseDetails }
  }
  if (status === 413) {
    return { code: 'too_large', details: baseDetails }
  }
  if (status === 401) {
    return { code: 'upstream_auth', details: baseDetails }
  }
  if (status === 403) {
    return { code: 'forbidden', details: baseDetails }
  }
  if (status === 400) {
    return { code: 'invalid_argument', details: baseDetails }
  }
  return {
    code: status >= 500 ? 'store_unavailable' : 'invalid_argument',
    details: { ...baseDetails, reason: rawCode ?? `http_${status}_${op}` },
  }
}

export type ArtifactDbCallResult = {
  id: string
  url: string
  expiresAt: string
  output?: string
  error?: string
  savedFiles?: string[]
  skippedFiles?: Array<{ filePath: string; reason: string }>
}

/**
 * Execute `read_db` / `write_db` against an artifact URL, honoring the 1-hour
 * `dbUndeclaredAt` cache (#1756), formatting `scan_budget`/`refused_writes`/
 * missing-doc update errors (#1798, #1916), and writing `out_dir` exports with
 * hidden markers (#1818).
 */
export async function executeArtifactDbAction(params: {
  action: 'read_db' | 'write_db'
  url: string
  db_op?: string
  collection?: string
  doc_id?: string
  query?: Record<string, unknown>
  data?: unknown
  writes?: unknown[]
  if_version?: string | number
  out_dir?: string
  oauthToken?: string | null
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}): Promise<ArtifactDbCallResult> {
  const parsed = parseArtifactUrlAnyCase(params.url)
  if (!parsed) {
    return {
      id: '',
      url: params.url,
      expiresAt: '',
      error: `Invalid artifact URL for ${params.action}: ${params.url}`,
    }
  }
  const op: ArtifactDbOp = params.action === 'read_db' ? 'read' : 'write'
  const cachedUndeclared = checkRememberedDbUndeclared(parsed.slug, op)
  if (cachedUndeclared) {
    return {
      id: parsed.slug,
      url: params.url,
      expiresAt: '',
      error: cachedUndeclared.message,
    }
  }

  const token =
    params.oauthToken !== undefined
      ? params.oauthToken
      : (getClaudeAIOAuthTokens()?.accessToken ?? null)
  if (!token) {
    return {
      id: parsed.slug,
      url: params.url,
      expiresAt: '',
      error: `db ${op} failed (upstream_auth): not signed in to claude.ai — run /login to sign in`,
    }
  }

  const startedAt = Date.now()
  const origin =
    parsed.env === 'staging' ? 'https://staging.claude.ai' : 'https://claude.ai'
  const endpoint = `${origin}/api/artifacts/${parsed.slug}/db/${op}`
  const fetcher = params.fetchImpl ?? fetch
  let res: Response
  try {
    res = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...frameControlPlaneHeaders(),
      },
      body: JSON.stringify({
        db_op: params.db_op,
        collection: params.collection,
        doc_id: params.doc_id,
        query: params.query,
        data: params.data,
        writes: params.writes,
        if_version: params.if_version,
      }),
      signal: params.signal,
    })
  } catch (err) {
    return {
      id: parsed.slug,
      url: params.url,
      expiresAt: '',
      error: formatArtifactDbError('store_unavailable', op, {
        reason: err instanceof Error ? err.message : String(err),
      }),
    }
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = undefined
  }

  if (!res.ok) {
    const writeOp =
      params.db_op === 'set' ||
      params.db_op === 'update' ||
      params.db_op === 'delete' ||
      params.db_op === 'str_replace'
        ? params.db_op
        : undefined
    const docPath =
      params.collection && params.doc_id
        ? `${params.collection}/${params.doc_id}`
        : params.collection
    const { code, details } = parseArtifactDbHttpError(res.status, body, op, {
      writeOp,
      path: docPath,
    })
    if (code === 'not_declared') {
      rememberDbUndeclared(parsed.slug, res.status, 'not_declared', startedAt)
    }
    return {
      id: parsed.slug,
      url: params.url,
      expiresAt: '',
      error: formatArtifactDbError(code, op, details),
    }
  }

  // Successful DB call confirms database capability is declared.
  clearDbUndeclared(parsed.slug)

  if (op === 'read' && params.out_dir && body && typeof body === 'object') {
    const docs = Array.isArray((body as { documents?: unknown[] }).documents)
      ? (body as { documents: Array<{ id?: string; data?: unknown }> })
          .documents
      : [
          {
            id: params.doc_id ?? 'result',
            data: body,
          },
        ]
    const savedFiles: string[] = []
    const skippedFiles: Array<{ filePath: string; reason: string }> = []
    for (let i = 0; i < docs.length; i++) {
      const row = docs[i]!
      const safeId = (row.id ?? `row-${i}`).replace(/[^A-Za-z0-9._-]/g, '_')
      const saveRes = await saveArtifactDbRowWithMarker(
        params.out_dir,
        `${safeId}.json`,
        JSON.stringify(row, null, 2),
      )
      if (saveRes.status === 'written') {
        savedFiles.push(saveRes.filePath)
      } else {
        skippedFiles.push({
          filePath: saveRes.filePath,
          reason: saveRes.reason,
        })
      }
    }
    const summaryLines = [
      `Saved ${savedFiles.length} database row file(s) under ${resolve(getCwd(), params.out_dir)}.`,
      ...skippedFiles.map(s => `Skipped: ${s.reason}`),
    ]
    return {
      id: parsed.slug,
      url: params.url,
      expiresAt: '',
      output: summaryLines.join('\n'),
      savedFiles,
      ...(skippedFiles.length > 0 ? { skippedFiles } : {}),
    }
  }

  return {
    id: parsed.slug,
    url: params.url,
    expiresAt: '',
    output:
      typeof body === 'string' ? body : JSON.stringify(body ?? {}, null, 2),
  }
}
