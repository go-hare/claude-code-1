/**
 * densable read_file / read_asset call bodies (2.1.289) — out_dir save path.
 * Gold: Artifact.call `list_files||read_file` / `read_asset` branches —
 * eH pin + j5 refusals → iq/Wte|HLe resolve → TCm/mko fetch → Lp save.
 *
 * Absent here (gold `se` working-copy host is null outside cowork): live-copy
 * reads, workingCopyLocationRefusal, isBoundWorkingCopy, Etn boot fallback.
 */
import { createHash } from 'crypto'
import { basename } from 'path'
import {
  artifactViewerUrlFor,
  parseArtifactUrlAnyCase,
} from '../../utils/artifactUrl.js'
import type { WRITE_STASH_EXPIRED } from '../../utils/sessionSlots.js'
import {
  ARTIFACT_ASSET_ID_RE,
  ARTIFACT_ASSET_TARGET_PIN,
  ARTIFACT_READ_BATCH_BYTE_BUDGET,
  ARTIFACT_READ_BATCH_CONCURRENCY,
  type ArtifactAssetTargetPin,
  ArtifactSaveError,
  allPathsProtectedMessage,
  artifactJweWriteBlock,
  extensionForContentType,
  isNetworkOrDevicePath,
  type PrepareGuardedWrite,
  quotePublishedPath,
  type ReadFileBatchFile,
  hasForeignArtifactPin,
  readFileInputFields,
  resolveAssetOutStem,
  resolveFileOutDest,
  resolveFileOutDests,
  saveArtifactBytes,
} from './outDirPaths.js'
import { fetchArtifactAssetBytes, fetchArtifactFileBytes } from './restApis.js'

export type ReadFileSaveResult = {
  file_read: {
    url: string
    path: string
    saved_to: string
    ver: string
    size_bytes: number
    content_type: string
    sha256: string
  }
}

export type ReadFileBatchEntry =
  | {
      path: string
      saved_to: string
      size_bytes: number
      content_type: string
      sha256: string
    }
  | { path: string; error: string }

export type ReadFilesSaveResult = {
  files_read: {
    url: string
    ver: string
    saved_dir: string
    files: ReadFileBatchEntry[]
  }
}

export type ReadAssetSaveResult = {
  asset_read: {
    id: string
    path: string
    size_bytes: number
    content_type: string
    sha256: string
  }
}

export type ArtifactSaveCallError = { error: string; reason?: string }

/**
 * Session permission-layer hooks gold reads off `n.session` / the permission
 * context. Each one absent falls back to the no-stash path (fresh spellings,
 * plain mkdir, no deny re-check) so tip callers keep working unwired.
 */
export type ArtifactReadSaveHooks = {
  /** densable m4 — stashed check-time spellings, else fresh Ro; throws when the stash expired. */
  takeApprovedSpellings?: (dest: string) => string[]
  /** densable `writePermissionStash.consume(toolUseId, base)` + Rv, per batch dest. */
  takeBatchSpellings?: (
    base: string,
    dests: readonly string[],
  ) => readonly (readonly string[])[] | typeof WRITE_STASH_EXPIRED | undefined
  /** densable Ro — fresh spellings when the batch stash holds nothing. */
  freshSpellings?: (dest: string) => string[]
  /** densable y_ */
  prepareWrite?: PrepareGuardedWrite
  /** densable `iS(CE, input, perms, {...Ia(dest), spellings:[...extra, ...]}).behavior === 'deny'` */
  isWriteDenied?: (dest: string, extraSpellings: readonly string[]) => boolean
  /** densable Ca — set-aside planning when the call carries no pin; null = every file protected. */
  planBatch?: (
    files: readonly ReadFileBatchFile[],
  ) => { aside: string[] } | null
  /** densable kv — per-file reason for a set-aside entry. */
  setAsideReason?: (dest: string) => string
  /** densable `if (De) cKe(...)` — record the read grant once the guards pass. */
  grantRead?: () => void
}

type CallCommon = {
  signal?: AbortSignal
  agentId?: string
  agentWorktree?: string
  /** Whole tool input — densable j5 refuses any foreign approval pin on it. */
  toolInput?: object
  hooks?: ArtifactReadSaveHooks
  /**
   * densable admitPublicRead — mKe(g,n,slug,"files"|"assets") passed into
   * fetch. Omit refuses tokenless public content (public_unasked).
   */
  admitPublicRead?: () => boolean
  /** densable probeToolUseId — reuse shareStatus.probeBoots for this tool use. */
  probeToolUseId?: string
}

const NOT_FETCHED_OUT_DIR =
  '`out_dir` no longer names the destination this read was approved for \u2014 nothing was fetched; retry so it is checked again'

/** densable gold kv final branch (no permission context to classify further). */
const DEFAULT_SET_ASIDE_REASON =
  'set aside: the approval set it aside \u2014 read it by itself with `path`'

/** densable $v — per-file fetch failures that never fail the whole batch. */
const BATCH_PER_FILE_REASONS = new Set([
  'batch_budget',
  'http_404',
  'invalid_path',
  'live_path',
  'size',
  'unexpected_type',
])

function clip(message: string, max = 1024): string {
  return message.length > max ? `${message.slice(0, max - 1)}\u2026` : message
}

function fail(error: string, reason: string): ArtifactSaveCallError {
  return { error, reason }
}

function errorOf(e: unknown, reason: string): ArtifactSaveCallError {
  if (e instanceof ArtifactSaveError) return fail(e.message, e.reason)
  return fail(e instanceof Error ? e.message : String(e), reason)
}

/**
 * densable read_file pin check (`Ae` + j5) — `path` vs `paths` must match
 * what was approved; `skipped` entries are dropped from `paths` and must
 * each still be named by the call.
 */
export function readFilePinMismatch(
  pin: ArtifactAssetTargetPin | null | undefined,
  input: { path?: unknown; paths?: unknown },
): boolean {
  if (pin == null) return false
  const { path, paths } = readFileInputFields(input)
  const skipped = new Set(
    Array.isArray(pin.skipped)
      ? pin.skipped.filter((p): p is string => typeof p === 'string')
      : [],
  )
  if (paths === undefined) {
    return (
      pin.paths !== undefined || (pin.path !== undefined && pin.path !== path)
    )
  }
  const named = paths.map(p => p.normalize('NFC'))
  const kept = named.filter(p => !skipped.has(p))
  return (
    pin.path !== undefined ||
    !Array.isArray(pin.paths) ||
    pin.paths.length !== kept.length ||
    pin.paths.some((p, i) => p !== kept[i]) ||
    [...skipped].some(p => !named.includes(p))
  )
}

function readFileTargetChanged(
  input: CallCommon & { path?: unknown; paths?: unknown },
  pin: ArtifactAssetTargetPin | null | undefined,
  slug: string,
): ArtifactSaveCallError | null {
  if (
    (input.toolInput !== undefined &&
      hasForeignArtifactPin(input.toolInput, ARTIFACT_ASSET_TARGET_PIN)) ||
    (pin !== undefined &&
      (pin === null ||
        pin.action !== 'read_file' ||
        pin.slug !== slug ||
        readFilePinMismatch(pin, input)))
  ) {
    return fail(
      '`action`, `url`, or `path` no longer names what was approved \u2014 nothing was done; retry so it is checked again',
      'file_target_changed',
    )
  }
  return null
}

/**
 * densable read_file call, single `path` (2.1.289).
 */
export async function callArtifactReadFile(
  input: CallCommon & {
    url: string
    path?: string
    out_dir?: string
    pin?: ArtifactAssetTargetPin | null
  },
): Promise<{ data: ReadFileSaveResult } | ArtifactSaveCallError> {
  const parsed = parseArtifactUrlAnyCase(input.url)
  if (!parsed) {
    return fail(
      '`url` must be an artifact URL for action "read_file"',
      'file_bad_url',
    )
  }
  const { pin, hooks } = input
  const changed = readFileTargetChanged(input, pin, parsed.slug)
  if (changed) return changed
  const judged = pin != null
  const destRes = resolveFileOutDest(
    { url: input.url, path: input.path, out_dir: input.out_dir },
    { outDirJudged: judged },
  )
  if ('reason' in destRes) return fail(destRes.reason, 'file_read_bad_path')
  const { dest } = destRes
  if (input.path === undefined || isNetworkOrDevicePath(dest)) {
    return fail(
      'read_file saves only to local directories \u2014 out_dir names a network path or cannot be resolved',
      'file_read_network_path',
    )
  }
  const jwe = artifactJweWriteBlock(dest, {
    agentId: input.agentId,
    agentWorktree: input.agentWorktree,
  })
  if (jwe) return fail(jwe, 'file_read_outside_worktree')
  if (pin?.stem !== undefined && pin.stem !== dest) {
    return fail(NOT_FETCHED_OUT_DIR, 'file_target_changed')
  }
  let spellings: string[]
  try {
    spellings = hooks?.takeApprovedSpellings?.(dest) ?? [dest]
  } catch (e) {
    return errorOf(e, 'file_read_write_moved')
  }
  const denied = () => hooks?.isWriteDenied?.(dest, spellings) === true
  if (denied()) {
    return fail(
      'writing to that path under out_dir is blocked by an Edit permission rule \u2014 nothing was fetched',
      'file_read_write_denied',
    )
  }
  hooks?.grantRead?.()
  const fetched = await fetchArtifactFileBytes({
    slug: parsed.slug,
    path: input.path,
    env: parsed.env,
    signal: input.signal,
    admitPublicRead: input.admitPublicRead,
    ...(input.probeToolUseId !== undefined
      ? { probeToolUseId: input.probeToolUseId }
      : {}),
  })
  if (fetched.kind === 'error') {
    return fail(fetched.message, `file_read_${fetched.reason}`)
  }
  if (denied()) {
    return fail(
      `writing ${basename(dest)} is blocked by an Edit permission rule \u2014 the file was fetched but not saved`,
      'file_read_write_denied',
    )
  }
  try {
    await saveArtifactBytes({
      kind: 'file',
      guardPath: dest,
      dest,
      bytes: fetched.bytes,
      spellings,
      prepareWrite: hooks?.prepareWrite,
    })
  } catch (e) {
    return errorOf(e, 'file_read_write_error')
  }
  return {
    data: {
      file_read: {
        url: artifactViewerUrlFor(parsed),
        path: fetched.path,
        saved_to: dest,
        ver: fetched.ver,
        size_bytes: fetched.bytes.length,
        content_type: fetched.contentType,
        sha256: fetched.sha256,
      },
    },
  }
}

type FileFetch = Awaited<ReturnType<typeof fetchArtifactFileBytes>> & {
  path: string
}

/** densable mko — bounded-concurrency fetch with the xq batch byte budget. */
async function fetchBatch(
  slug: string,
  env: 'prod' | 'staging' | undefined,
  paths: readonly string[],
  signal: AbortSignal | undefined,
  admitPublicRead?: () => boolean,
  probeToolUseId?: string,
): Promise<FileFetch[]> {
  const out = new Array<FileFetch>(paths.length)
  let next = 0
  let carried = 0
  const budget = ARTIFACT_READ_BATCH_BYTE_BUDGET
  const worker = async () => {
    while (next < paths.length) {
      const i = next++
      const path = paths[i] as string
      if (carried >= budget) {
        out[i] = {
          kind: 'error',
          reason: 'batch_budget',
          message: `not fetched: the files read before it in this call already hold ${Math.floor(budget / 1048576)}MB, the most one read carries \u2014 read it, and any after it, in another call`,
          path,
        }
        continue
      }
      const r = await fetchArtifactFileBytes({
        slug,
        path,
        env,
        signal,
        admitPublicRead,
        ...(probeToolUseId !== undefined ? { probeToolUseId } : {}),
      })
      if (r.kind === 'ok') carried += r.bytes.length
      out[i] = r.kind === 'ok' ? r : { ...r, path }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(ARTIFACT_READ_BATCH_CONCURRENCY, paths.length) },
      () => worker(),
    ),
  )
  return out
}

/**
 * densable read_file call, `paths` batch (2.1.289) — one approval, one
 * stash entry under the base dir, per-file save results / errors.
 */
export async function callArtifactReadFiles(
  input: CallCommon & {
    url: string
    paths: string[]
    out_dir?: string
    pin?: ArtifactAssetTargetPin | null
  },
): Promise<{ data: ReadFilesSaveResult } | ArtifactSaveCallError> {
  const parsed = parseArtifactUrlAnyCase(input.url)
  if (!parsed) {
    return fail(
      '`url` must be an artifact URL for action "read_file"',
      'file_bad_url',
    )
  }
  const { pin, hooks } = input
  const changed = readFileTargetChanged(input, pin, parsed.slug)
  if (changed) return changed
  const skipped = new Set(
    Array.isArray(pin?.skipped)
      ? pin.skipped.filter((p): p is string => typeof p === 'string')
      : [],
  )
  const batch = resolveFileOutDests(
    { url: input.url, out_dir: input.out_dir, paths: input.paths },
    { outDirJudged: pin != null },
  )
  if ('reason' in batch) return fail(batch.reason, 'file_read_bad_path')
  const { base } = batch
  if (pin == null && hooks?.planBatch !== undefined) {
    const plan = hooks.planBatch(batch.files)
    if (plan === null) {
      return fail(
        allPathsProtectedMessage(batch.files.map(f => f.path)),
        'file_read_write_denied',
      )
    }
    for (const p of plan.aside) skipped.add(p)
  }
  const kept = batch.files.filter(f => !skipped.has(f.path))
  const network = kept.find(f => isNetworkOrDevicePath(f.dest))
  if (network !== undefined) {
    return fail(
      `${quotePublishedPath(network.path)}: read_file saves only to local directories \u2014 out_dir names a network path or cannot be resolved`,
      'file_read_network_path',
    )
  }
  for (const f of kept) {
    const jwe = artifactJweWriteBlock(f.dest, {
      agentId: input.agentId,
      agentWorktree: input.agentWorktree,
    })
    if (jwe) {
      return fail(
        `${quotePublishedPath(f.path)}: ${jwe}`,
        'file_read_outside_worktree',
      )
    }
  }
  if (
    pin != null &&
    (!Array.isArray(pin.stems) ||
      pin.stems.length !== kept.length ||
      pin.stems.some((s, i) => s !== kept[i]?.dest))
  ) {
    return fail(NOT_FETCHED_OUT_DIR, 'file_target_changed')
  }
  const dests = kept.map(f => f.dest)
  const stashed = hooks?.takeBatchSpellings?.(base, dests)
  if (typeof stashed === 'symbol') {
    return fail(
      'the permission check for these saves expired before they ran (too many concurrent file operations) \u2014 nothing was fetched; retry so it is checked again',
      'file_read_write_moved',
    )
  }
  const spellings: (readonly string[])[] =
    stashed === undefined
      ? dests.map(d => hooks?.freshSpellings?.(d) ?? [d])
      : [...stashed]
  const firstDenied = (): string | undefined => {
    const isDenied = hooks?.isWriteDenied
    if (isDenied === undefined) return undefined
    const plain = kept.find(f => isDenied(f.dest, []))
    if (plain !== undefined) return plain.path
    return kept.some((f, i) => isDenied(f.dest, spellings[i] ?? []))
      ? ''
      : undefined
  }
  const deniedLine = (path: string, tail: string) =>
    `${path === '' ? 'writing under out_dir' : `${quotePublishedPath(path)}: writing it under out_dir`} is blocked by an Edit permission rule \u2014 ${tail}`
  const before = firstDenied()
  if (before !== undefined) {
    return fail(
      deniedLine(before, 'nothing was fetched'),
      'file_read_write_denied',
    )
  }
  hooks?.grantRead?.()
  const fetched = await fetchBatch(
    parsed.slug,
    parsed.env,
    kept.map(f => f.path),
    input.signal,
    input.admitPublicRead,
    input.probeToolUseId,
  )
  const first = fetched[0]
  if (
    first?.kind === 'error' &&
    !BATCH_PER_FILE_REASONS.has(first.reason) &&
    fetched.every(f => f.kind === 'error' && f.reason === first.reason)
  ) {
    return fail(first.message, `file_read_${first.reason}`)
  }
  const after = firstDenied()
  if (after !== undefined) {
    return fail(
      deniedLine(after, 'the files were fetched but nothing was saved'),
      'file_read_write_denied',
    )
  }
  const byPath = new Map<string, ReadFileBatchEntry>()
  let ver: string | undefined
  for (const [i, f] of fetched.entries()) {
    const dest = kept[i]?.dest as string
    if (f.kind === 'error') {
      byPath.set(f.path, { path: f.path, error: clip(f.message) })
      continue
    }
    ver ??= f.ver
    try {
      await saveArtifactBytes({
        kind: 'file',
        guardPath: dest,
        dest,
        bytes: f.bytes,
        spellings: spellings[i] ?? [dest],
        prepareWrite: hooks?.prepareWrite,
      })
    } catch (e) {
      if (!(e instanceof ArtifactSaveError)) throw e
      byPath.set(f.path, { path: f.path, error: clip(e.message) })
      continue
    }
    byPath.set(f.path, {
      path: f.path,
      saved_to: dest,
      size_bytes: f.bytes.length,
      content_type: f.contentType,
      sha256: f.sha256,
    })
  }
  const files = batch.files.map(
    f =>
      byPath.get(f.path) ?? {
        path: f.path,
        error: hooks?.setAsideReason?.(f.dest) ?? DEFAULT_SET_ASIDE_REASON,
      },
  )
  return {
    data: {
      files_read: {
        url: artifactViewerUrlFor(parsed),
        ver: ver ?? '',
        saved_dir: base,
        files,
      },
    },
  }
}

/**
 * densable read_file dispatch — gold `iq(g).paths === void 0 ? Wte : HLe`.
 */
export function callArtifactReadFileAction(
  input: CallCommon & {
    url: string
    path?: string
    paths?: string[]
    out_dir?: string
    pin?: ArtifactAssetTargetPin | null
  },
): Promise<
  | { data: ReadFileSaveResult }
  | { data: ReadFilesSaveResult }
  | ArtifactSaveCallError
> {
  const { paths } = readFileInputFields(input)
  if (paths === undefined) return callArtifactReadFile(input)
  return callArtifactReadFiles({ ...input, paths })
}

/**
 * densable read_asset call (2.1.289).
 */
export async function callArtifactReadAsset(
  input: CallCommon & {
    url: string
    asset_id: string
    out_dir?: string
    pin?: ArtifactAssetTargetPin | null
  },
): Promise<{ data: ReadAssetSaveResult } | ArtifactSaveCallError> {
  const parsed = parseArtifactUrlAnyCase(input.url)
  if (!parsed) {
    return fail(
      '`url` must be an artifact URL for action "read_asset"',
      'asset_bad_url',
    )
  }
  const { pin, hooks } = input
  const assetId =
    typeof input.asset_id === 'string' ? input.asset_id : undefined
  if (
    (input.toolInput !== undefined &&
      hasForeignArtifactPin(input.toolInput, ARTIFACT_ASSET_TARGET_PIN)) ||
    (pin !== undefined &&
      (pin?.action !== 'read_asset' ||
        pin.slug !== parsed.slug ||
        (pin.assetId !== undefined && pin.assetId !== assetId)))
  ) {
    return fail(
      '`action`, `url`, or `asset_id` no longer names what was approved \u2014 nothing was done; retry so it is checked again',
      'asset_target_changed',
    )
  }
  if (assetId === undefined || !ARTIFACT_ASSET_ID_RE.test(assetId)) {
    return fail(
      'asset_id (32 hex characters) is required for action "read_asset"',
      'asset_bad_id',
    )
  }
  const stem = resolveAssetOutStem({
    url: input.url,
    asset_id: assetId,
    out_dir: input.out_dir,
  })
  if (stem === undefined || isNetworkOrDevicePath(stem)) {
    return fail(
      'read_asset saves only to local directories \u2014 out_dir names a network path or cannot be resolved',
      'asset_read_network_path',
    )
  }
  const isolation = {
    agentId: input.agentId,
    agentWorktree: input.agentWorktree,
  }
  const jwe = artifactJweWriteBlock(stem, isolation)
  if (jwe) return fail(jwe, 'asset_read_outside_worktree')
  if (pin?.stem !== undefined && pin.stem !== stem) {
    return fail(
      'the destination no longer matches the one this read was approved for \u2014 nothing was fetched; retry so it is checked again',
      'asset_target_changed',
    )
  }
  let spellings: string[]
  try {
    spellings = hooks?.takeApprovedSpellings?.(stem) ?? [stem]
  } catch (e) {
    return errorOf(e, 'asset_read_write_moved')
  }
  const denied = (p: string) =>
    hooks?.isWriteDenied?.(p, p === stem ? spellings : []) === true
  if (denied(stem)) {
    return fail(
      'writing to the destination is blocked by an Edit permission rule \u2014 nothing was fetched',
      'asset_read_write_denied',
    )
  }
  hooks?.grantRead?.()
  const fetched = await fetchArtifactAssetBytes({
    slug: parsed.slug,
    assetId,
    env: parsed.env,
    signal: input.signal,
    admitPublicRead: input.admitPublicRead,
    ...(input.probeToolUseId !== undefined
      ? { probeToolUseId: input.probeToolUseId }
      : {}),
  })
  if (fetched.kind === 'error') {
    return fail(fetched.message, `asset_read_${fetched.reason}`)
  }
  const ext = extensionForContentType(fetched.contentType)
  if (ext === undefined) {
    return fail(
      'asset read failed: the content host served a type this tool does not save',
      'asset_read_unexpected_type',
    )
  }
  const dest = `${stem}${ext}`
  const jweDest = artifactJweWriteBlock(dest, isolation)
  if (jweDest) return fail(jweDest, 'asset_read_outside_worktree')
  if (denied(dest)) {
    return fail(
      `writing ${basename(dest)} is blocked by an Edit permission rule \u2014 the asset was fetched but not saved`,
      'asset_read_write_denied',
    )
  }
  const sha256 = createHash('sha256').update(fetched.bytes).digest('hex')
  try {
    await saveArtifactBytes({
      kind: 'asset',
      guardPath: stem,
      dest,
      bytes: fetched.bytes,
      spellings,
      prepareWrite: hooks?.prepareWrite,
    })
  } catch (e) {
    return errorOf(e, 'asset_read_write_error')
  }
  return {
    data: {
      asset_read: {
        id: assetId,
        path: dest,
        size_bytes: fetched.bytes.length,
        content_type: fetched.contentType,
        sha256,
      },
    },
  }
}
