/**
 * densable AWt / EWt / Wtn / Rto / SGi / Wot portable (2.1.239);
 * iq / Wte / HLe / MLe / joe / Lp / DLe / eH pin (2.1.289).
 *
 * out_dir resolves a local directory; read_file joins published `path` (or
 * each `paths` entry's) segments; read_asset joins `asset_id` then appends
 * SGi(content-type) extension after fetch.
 */
import { randomBytes } from 'crypto'
import { mkdir, rename, unlink, writeFile } from 'fs/promises'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  resolve,
  sep,
} from 'path'
import { checkBgIsolationWriteBlock } from '../../utils/bgIsolationContainment.js'
import { getCwd } from '../../utils/cwd.js'
import { getErrnoCode } from '../../utils/errors.js'
import type { ApprovedWrite } from '../../utils/fileToolApprovedOpen.js'
import { expandPath, isDeviceOrNtNamespacePath } from '../../utils/path.js'
import { parseArtifactUrl } from '../../utils/artifactUrl.js'
import {
  getScratchpadDir,
  isScratchpadEnabled,
} from '../../utils/permissions/filesystem.js'

/** densable UX */
export const ARTIFACT_ASSET_ID_RE = /^[0-9a-f]{32}$/i

/** densable MEe — content-type shape this tool will save. */
export const ARTIFACT_SAVE_CONTENT_TYPE_RE =
  /^[a-z0-9]{1,24}\/[a-z0-9.+-]{1,80}$/

/** densable Nee — 2 MiB asset/file save cap (portable). */
export const ARTIFACT_SAVE_MAX_BYTES = 2_097_152

/**
 * densable _Gi — ext → content-type. SGi is the reverse lookup.
 */
export const ARTIFACT_ASSET_CONTENT_TYPES = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.pdf', 'application/pdf'],
  ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.csv', 'text/csv'],
  ['.md', 'text/markdown'],
  ['.markdown', 'text/markdown'],
  ['.json', 'application/json'],
  ['.txt', 'text/plain'],
  ['.ts', 'text/plain'],
  ['.css', 'text/css'],
  ['.js', 'text/javascript'],
  ['.mjs', 'text/javascript'],
  ['.cjs', 'text/javascript'],
])

/** densable SGi — content-type → preferred extension (or undefined). */
export function extensionForContentType(
  contentType: string,
): string | undefined {
  const ct = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  for (const [ext, type] of ARTIFACT_ASSET_CONTENT_TYPES) {
    if (type === ct) return ext
  }
  return undefined
}

/** densable _Cm — candidate suffixes for permission probing. */
export function assetReadPathCandidates(stem: string): string[] {
  const exts = new Set<string>()
  for (const type of ARTIFACT_ASSET_CONTENT_TYPES.values()) {
    const ext = extensionForContentType(type)
    if (ext) exts.add(ext)
  }
  return [...exts].map(ext => `${stem}${ext}`)
}

export type OutDirFields = {
  path?: string
  outDir?: string
  assetId?: string
}

/** densable Wtn + a0t subset. */
export function readOutDirFields(input: {
  path?: unknown
  out_dir?: unknown
  asset_id?: unknown
}): OutDirFields {
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' ? v : undefined
  return {
    path: str(input.path),
    outDir: str(input.out_dir),
    assetId: str(input.asset_id),
  }
}

/** densable Wot / GCl portable — UNC / device / NT namespace. */
export function isNetworkOrDevicePath(p: string): boolean {
  if (isDeviceOrNtNamespacePath(p)) return true
  if (/^\\\\[^\\]/.test(p) || /^\/\/[^/]/.test(p)) return true
  if (/^\/net(\/|$)/i.test(p) || /^\/Volumes\/Network(\/|$)/i.test(p))
    return true
  return false
}

/** Windows CON/PRN/AUX/NUL/COM1–9/LPT1–9, including CON.txt. */
const WIN_RESERVED_DEVICE_SEGMENT =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i

export function isWindowsReservedPublishedSegment(segment: string): boolean {
  return WIN_RESERVED_DEVICE_SEGMENT.test(segment)
}

/**
 * densable $em/Rto portable — published path key for list_files / read_file.
 */
export function normalizePublishedPath(
  path: string,
): { key: string } | { errMsg: string } {
  if (typeof path !== 'string' || path.length === 0) {
    return {
      errMsg:
        'read_file requires `path` — a published path from a list_files result',
    }
  }
  if (path.includes('\\') || path.includes('\0')) {
    return {
      errMsg: `path ${JSON.stringify(path)} must use forward-slash segments`,
    }
  }
  if (isAbsolute(path) || path.startsWith('~/') || path === '~') {
    return {
      errMsg: `path ${JSON.stringify(path)} must be a published relative path, not a local filesystem path`,
    }
  }
  const parts = path.split('/')
  if (
    parts.some(
      p =>
        p === '' ||
        p === '.' ||
        p === '..' ||
        p.includes('\0') ||
        /[~*]/.test(p),
    )
  ) {
    return {
      errMsg: `path ${JSON.stringify(path)} is not a safe published path`,
    }
  }
  if (process.platform === 'win32') {
    if (
      parts.some(
        p =>
          /[<>"|*]/.test(p) ||
          /[. ]$/.test(p) ||
          /~\d/.test(p) ||
          isWindowsReservedPublishedSegment(p),
      )
    ) {
      return {
        errMsg: `path ${JSON.stringify(path)} cannot be a file name on Windows (reserved device name, trailing dot or space, or one of < > " | *)`,
      }
    }
  }
  const key = parts.join('/')
  if (key.startsWith('_') || key === 'index.html.json') {
    return {
      errMsg: `path ${JSON.stringify(path)} names one of the artifact service's own views, not a published file; list_files shows the readable paths`,
    }
  }
  return { key }
}

/**
 * densable b5 — default out_dir is `<scratchpad>/artifact-files/<slug>`;
 * null without a scratchpad (callers then fall back to cwd).
 */
export function defaultArtifactFilesDir(slug: string): string | null {
  if (!isScratchpadEnabled()) return null
  return join(getScratchpadDir(), 'artifact-files', slug)
}

/** densable `to` — case fold used for scratchpad / collision comparisons. */
export function foldPathCase(p: string): string {
  return p
    .toLowerCase()
    .replace(/\u0131/g, 'i')
    .replace(/\u017f/g, 's')
}

/** densable MLe (2.1.289) — dest lies inside the session scratchpad. */
export function isInArtifactScratchpad(path: string): boolean {
  if (!isScratchpadEnabled()) return false
  return foldPathCase(normalize(path)).startsWith(
    foldPathCase(getScratchpadDir()) + sep,
  )
}

/** densable joe (2.1.289) — create the session scratchpad owner-only. */
export async function ensureArtifactScratchpad(): Promise<string | null> {
  if (!isScratchpadEnabled()) return null
  const dir = getScratchpadDir()
  await mkdir(dir, { recursive: true, mode: 0o700 })
  return dir
}

function resolveOutDirBase(
  outDir: string | undefined,
  url: string | undefined,
): { base: string; defaultDir?: true } | { reason: string } {
  try {
    if (outDir === undefined || outDir === '') {
      const parsed = typeof url === 'string' ? parseArtifactUrl(url) : null
      const dir = parsed !== null ? defaultArtifactFilesDir(parsed.slug) : null
      if (dir !== null) return { base: resolve(dir), defaultDir: true }
      return { base: resolve(getCwd()) }
    }
    const expanded = expandPath(outDir)
    if (isNetworkOrDevicePath(expanded) || isNetworkOrDevicePath(outDir)) {
      return { reason: 'out_dir names a network path' }
    }
    return { base: resolve(expanded) }
  } catch {
    return { reason: 'out_dir cannot be resolved to a local directory' }
  }
}

/**
 * densable EWt — stem path = join(out_dir|cwd, asset_id) without extension.
 */
export function resolveAssetOutStem(input: {
  url?: string
  asset_id?: string
  out_dir?: string
}): string | undefined {
  return resolveAssetOutTarget(input)?.stem
}

/** densable CLe — {stem, defaultDir?}; `defaultDir` marks the b5 scratchpad default. */
export function resolveAssetOutTarget(input: {
  url?: string
  asset_id?: string
  out_dir?: string
}): { stem: string; defaultDir?: true } | undefined {
  const { assetId, outDir } = readOutDirFields(input)
  if (assetId === undefined || !ARTIFACT_ASSET_ID_RE.test(assetId))
    return undefined
  try {
    let base: string
    let defaultDir = false
    if (outDir === undefined || outDir === '') {
      const parsed =
        typeof input.url === 'string' ? parseArtifactUrl(input.url) : null
      const dir = parsed !== null ? defaultArtifactFilesDir(parsed.slug) : null
      defaultDir = dir !== null
      base = dir ?? getCwd()
    } else {
      base = expandPath(outDir)
    }
    if (isNetworkOrDevicePath(base)) return undefined
    return {
      stem: join(base, assetId.toLowerCase()),
      ...(defaultDir && { defaultDir: true as const }),
    }
  } catch {
    return undefined
  }
}

/**
 * densable AWt / Wte (2.1.289) — {dest, base, defaultDir?} or {reason}.
 * `defaultDir` marks the b5 scratchpad default (not the cwd fallback).
 * `outDirJudged` (call time, after approval) skips the Windows out_dir
 * spelling refusal the approval already ruled on.
 */
export function resolveFileOutDest(
  input: {
    url?: string
    path?: string
    out_dir?: string
  },
  opts?: { outDirJudged?: boolean },
): { dest: string; base: string; defaultDir?: true } | { reason: string } {
  const { path: published, outDir } = readOutDirFields(input)
  if (published === undefined) {
    return {
      reason:
        'read_file requires `path` — a published path from a list_files result',
    }
  }
  const norm = normalizePublishedPath(published)
  if ('errMsg' in norm) return { reason: norm.errMsg }
  const segments = norm.key.split('/')
  const resolved = resolveOutDirBase(outDir, input.url)
  if ('reason' in resolved) {
    return {
      reason:
        resolved.reason === 'out_dir names a network path'
          ? `out_dir ${JSON.stringify(outDir)} names a network path`
          : resolved.reason,
    }
  }
  const { base, defaultDir } = resolved
  if (
    opts?.outDirJudged !== true &&
    process.platform === 'win32' &&
    base.split(sep).some(c => c !== '' && /[. ]$/.test(c))
  ) {
    const where =
      outDir === undefined || outDir === ''
        ? 'the default save directory'
        : `out_dir ${JSON.stringify(outDir)}`
    return {
      reason: `${where} has a name ending in a dot or space, which Windows would save under a different name`,
    }
  }
  return {
    dest: join(base, ...segments),
    base,
    ...(defaultDir && { defaultDir }),
  }
}

/** densable Iv — longest published path the schema accepts. */
export const ARTIFACT_PUBLISHED_PATH_MAX_CHARS = 512

/** densable Tne (= ex + 1) — most published paths one read_file names. */
export const ARTIFACT_READ_FILE_MAX_PATHS = 256

/** densable xq — bytes one batch read carries before later files are refused. */
export const ARTIFACT_READ_BATCH_BYTE_BUDGET = 67_108_864

/** densable `re` in mko — concurrent fetches of one batch read. */
export const ARTIFACT_READ_BATCH_CONCURRENCY = 4

/** densable wv — rule-matched files at which a batch sets them aside. */
export const ARTIFACT_READ_BATCH_RULE_ASIDE_MIN = 3

/** densable Tp — on-line batch files above which the ask is human-only. */
export const ARTIFACT_READ_BATCH_ON_LINE_MAX = 64

/** densable _v — published path length that makes a batch ask human-only. */
export const ARTIFACT_READ_BATCH_LONG_PATH = 120

/** densable cQt — paths quoted in a whole-batch refusal. */
export const ARTIFACT_READ_BATCH_QUOTED_PATHS = 8

/** densable vv — decisionReason when every batch destination is protected. */
export const ARTIFACT_READ_ALL_PROTECTED_REASON =
  'Every file in this read would be saved to a path the file-edit safety rules protect, so each must be read on its own'

/** densable Op — JSON-quote with non-printable ASCII and `<>` \\u-escaped. */
export function quotePublishedPath(p: string): string {
  return JSON.stringify(p).replace(/[^\x20-\x7e]|[<>]/gu, ch =>
    ch
      .split('')
      .map(c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
      .join(''),
  )
}

/** densable Ep — whole-batch refusal when every destination is protected. */
export function allPathsProtectedMessage(paths: readonly string[]): string {
  const quoted = paths
    .slice(0, ARTIFACT_READ_BATCH_QUOTED_PATHS)
    .map(p => quotePublishedPath(p))
  return `every path in this read (${quoted.join(', ')}${paths.length > quoted.length ? ', \u2026' : ''}) would be saved at a path Claude Code protects (git, hook, tool, and agent settings, shell profiles and other sensitive files), under a suspicious spelling, or through a link leading out of the scratchpad \u2014 nothing was read; read them one at a time with \`path\``
}

export type ReadFileInputFields = {
  path?: string
  paths?: string[]
  outDir?: string
}

/** densable Xw — snapshot an untrusted array; unreadable → `[]`. */
function snapshotStringArray(value: unknown): string[] | undefined {
  let length: number
  try {
    if (!Array.isArray(value)) return undefined
    length = value.length
  } catch {
    return []
  }
  if (!Number.isSafeInteger(length) || length < 0) return []
  const out: unknown[] = []
  for (let i = 0; i < length; i++) {
    let item: unknown
    try {
      item = (value as unknown[])[i]
    } catch {
      item = undefined
    }
    out.push(item)
  }
  return out.filter((p): p is string => typeof p === 'string')
}

/** densable iq — read_file `path` / `paths` / `out_dir`, string-typed only. */
export function readFileInputFields(input: object): ReadFileInputFields {
  const rec = input as Record<string, unknown>
  const str = (k: string): string | undefined =>
    typeof rec[k] === 'string' ? (rec[k] as string) : undefined
  return {
    path: str('path'),
    paths: snapshotStringArray(rec.paths),
    outDir: str('out_dir'),
  }
}

export type ReadFileBatchFile = { path: string; dest: string }

export type ReadFileBatchDests =
  | { base: string; defaultDir?: true; files: ReadFileBatchFile[] }
  | { reason: string }

const batchDestsMemo = new WeakMap<
  object,
  { key: string; value: ReadFileBatchDests }
>()

/**
 * densable HLe (2.1.289) — resolve every `paths` entry as Wte would; refuse
 * repeats and entries that fold to one file on a case-insensitive volume.
 * Memoized on the `paths` array identity + url/out_dir/judged/cwd/scratchpad.
 */
export function resolveFileOutDests(
  input: { url?: unknown; out_dir?: unknown; paths?: unknown },
  opts: { outDirJudged?: boolean } = {},
): ReadFileBatchDests {
  const { paths, url, out_dir } = input
  const arr = typeof paths === 'object' && paths !== null ? paths : undefined
  const key = [
    typeof url === 'string' ? url : '',
    typeof out_dir === 'string' ? out_dir : '',
    opts.outDirJudged === true ? 'judged' : '',
    getCwd(),
    (isScratchpadEnabled() ? getScratchpadDir() : null) ?? '',
  ].join('\0')
  const hit = arr === undefined ? undefined : batchDestsMemo.get(arr)
  if (hit !== undefined && hit.key === key) return hit.value
  const value = computeFileOutDests(input, opts)
  if (arr !== undefined) batchDestsMemo.set(arr, { key, value })
  return value
}

function computeFileOutDests(
  input: { url?: unknown; out_dir?: unknown; paths?: unknown },
  opts: { outDirJudged?: boolean },
): ReadFileBatchDests {
  const { paths } = readFileInputFields(input)
  if (paths === undefined || paths.length === 0) {
    return {
      reason:
        'read_file requires `path`, or `paths` naming at least one published path',
    }
  }
  if (paths.length > ARTIFACT_READ_FILE_MAX_PATHS) {
    return {
      reason: `\`paths\` names ${paths.length} paths; at most ${ARTIFACT_READ_FILE_MAX_PATHS} can be read in one call`,
    }
  }
  const url = typeof input.url === 'string' ? input.url : undefined
  const outDir = typeof input.out_dir === 'string' ? input.out_dir : undefined
  let head: { base: string; defaultDir?: true } | undefined
  const files: ReadFileBatchFile[] = []
  const seen = new Map<string, string>()
  for (const p of paths) {
    const one = resolveFileOutDest({ url, out_dir: outDir, path: p }, opts)
    if ('reason' in one) return one
    const norm = normalizePublishedPath(p)
    const published = 'key' in norm ? norm.key.normalize('NFC') : p
    const fold = foldPathCase(
      normalize(one.dest).normalize('NFC').toUpperCase().toLowerCase(),
    )
    const prior = seen.get(fold)
    if (prior !== undefined) {
      return {
        reason:
          prior === published
            ? `\`paths\` names ${quotePublishedPath(p)} more than once`
            : `\`paths\` names ${quotePublishedPath(prior)} and ${quotePublishedPath(p)}, which could save to the same file on a case-insensitive volume; read one of them on its own`,
      }
    }
    seen.set(fold, published)
    head ??= { base: one.base, ...(one.defaultDir && { defaultDir: true }) }
    files.push({ path: published, dest: one.dest })
  }
  return { ...(head as { base: string; defaultDir?: true }), files }
}

/**
 * densable jwe — bg/worktree isolation write fence (tip: checkBgIsolationWriteBlock).
 * Not a cwd containment check — densable allows out_dir outside cwd when jwe is null.
 */
export function artifactJweWriteBlock(
  dest: string,
  ctx?: { agentId?: string; agentWorktree?: string },
): string | null {
  return checkBgIsolationWriteBlock(dest, ctx ?? {})
}

/**
 * @deprecated densable does not cwd-fence artifact saves; use {@link artifactJweWriteBlock}.
 * Kept as alias for older tip call sites during migration.
 */
export function outsideWorktreeMessage(
  dest: string,
  _opts?: { allowArtifactFilesRoot?: boolean },
): string | null {
  return artifactJweWriteBlock(dest)
}

/** densable j4e */
export function tempSiblingPath(dest: string): string {
  return `${dest}.tmp.${randomBytes(4).toString('hex')}`
}

/**
 * densable write path: joe (scratchpad 0o700) → mkdir → writeFile(tmp, wx) →
 * XGi rename (retry unlink dest).
 */
export async function writeBytesExclusive(
  dest: string,
  bytes: Buffer,
): Promise<void> {
  if (isInArtifactScratchpad(dest)) {
    await mkdir(getScratchpadDir(), { recursive: true, mode: 0o700 })
  }
  await mkdir(dirname(dest), { recursive: true })
  const tmp = tempSiblingPath(dest)
  let wroteTmp = false
  try {
    await writeFile(tmp, bytes, { flag: 'wx' })
    wroteTmp = true
    try {
      await rename(tmp, dest)
      wroteTmp = false
    } catch (first) {
      try {
        await unlink(dest)
      } catch (u) {
        const code = (u as NodeJS.ErrnoException)?.code
        if (code !== 'ENOENT') throw first
      }
      await rename(tmp, dest)
      wroteTmp = false
    }
  } finally {
    if (wroteTmp) {
      await unlink(tmp).catch(() => {})
    }
  }
}

/** densable Pe subset — a save refusal carrying its gold reason code. */
export class ArtifactSaveError extends Error {
  readonly reason: string
  constructor(message: string, reason: string) {
    super(message)
    this.name = 'ArtifactSaveError'
    this.reason = reason
  }
}

/** densable w5 — the staged bytes could not be renamed into place and were kept. */
export class PartialKeptError extends Error {
  readonly partial: string
  readonly renameError: unknown
  readonly removedEarlier: boolean
  constructor(partial: string, renameError: unknown, removedEarlier: boolean) {
    super('the staged file could not be moved into place')
    this.name = 'PartialKeptError'
    this.partial = partial
    this.renameError = renameError
    this.removedEarlier = removedEarlier
  }
}

/** densable AA — rename errors retried after removing the destination. */
const RENAME_RETRY_CODES = new Set(['EXDEV', 'EPERM', 'EEXIST', 'EBUSY'])

/** densable DLe — rename; on AA codes unlink dest and retry, else keep the partial. */
export async function renameIntoPlace(
  tmp: string,
  dest: string,
): Promise<void> {
  let removedEarlier = true
  try {
    await rename(tmp, dest)
    return
  } catch (first) {
    const code = getErrnoCode(first)
    if (code === undefined || !RENAME_RETRY_CODES.has(code)) throw first
    await unlink(dest).catch((u: unknown) => {
      if (getErrnoCode(u) !== 'ENOENT') throw first
      removedEarlier = false
    })
  }
  try {
    await rename(tmp, dest)
  } catch (e) {
    throw new PartialKeptError(tmp, e, removedEarlier)
  }
}

/** densable y_ — guarded opener pinned to the approved spellings. */
export type PrepareGuardedWrite = (
  dest: string,
  spellings: readonly string[],
  opts: { createParents: true },
) => Promise<ApprovedWrite>

/** densable `_m` family — the approved write target moved under us. */
function isWriteMovedError(e: unknown): boolean {
  return (
    e instanceof Error &&
    (e.name === 'SymlinkResolutionChangedError' ||
      e.name === 'SymlinkWriteRefusedError' ||
      e.name === 'HardLinkWriteRefusedError')
  )
}

/**
 * densable Lp (read_file) / read_asset save tail (2.1.289): MLe→joe, y_ open
 * on `guardPath`, wx temp sibling, recheckBeforeWrite, DLe rename.
 * `guardPath` is the file dest, or the asset stem whose sibling `dest` is
 * `${stem}${ext}`. Without `prepareWrite`, parents are created plainly and
 * no recheck runs (the session stash hook is wired by the integrator).
 */
export async function saveArtifactBytes(opts: {
  kind: 'file' | 'asset'
  guardPath: string
  dest: string
  bytes: Buffer
  spellings: readonly string[]
  prepareWrite?: PrepareGuardedWrite
}): Promise<void> {
  const { kind, guardPath, dest, bytes, spellings, prepareWrite } = opts
  const prefix = kind === 'file' ? 'file_read' : 'asset_read'
  let tmp = tempSiblingPath(dest)
  let ownsTmp = false
  let guard: ApprovedWrite | undefined
  try {
    if (isInArtifactScratchpad(guardPath)) await ensureArtifactScratchpad()
    let ioPath: string
    if (prepareWrite !== undefined) {
      guard = await prepareWrite(guardPath, spellings, { createParents: true })
      ioPath =
        kind === 'file'
          ? guard.ioPath
          : join(dirname(guard.ioPath), basename(dest))
    } else {
      await mkdir(dirname(guardPath), { recursive: true })
      ioPath = dest
    }
    tmp = tempSiblingPath(ioPath)
    await writeFile(tmp, bytes, { flag: 'wx' }).catch((e: unknown) => {
      ownsTmp = getErrnoCode(e) !== 'EEXIST'
      throw e
    })
    ownsTmp = true
    await guard?.recheckBeforeWrite()
    await renameIntoPlace(tmp, ioPath).catch((e: unknown) => {
      if (e instanceof PartialKeptError) {
        throw new PartialKeptError(
          join(dirname(dest), basename(e.partial)),
          e.renameError,
          e.removedEarlier,
        )
      }
      throw e
    })
  } catch (e) {
    if (e instanceof PartialKeptError) {
      const why = getErrnoCode(e.renameError) ?? 'unexpected error'
      const name = basename(dest)
      throw new ArtifactSaveError(
        e.removedEarlier
          ? `the earlier copy at ${name} was removed but the fetched ${kind} could not be moved into its place (${why}) \u2014 the bytes are kept at ${e.partial}; move or delete that file`
          : `the fetched ${kind} could not be moved to ${name} (${why}) \u2014 the bytes are kept at ${e.partial}; move or delete that file`,
        `${prefix}_write_kept`,
      )
    }
    if (ownsTmp) await unlink(tmp).catch(() => {})
    if (isWriteMovedError(e)) {
      throw new ArtifactSaveError(
        kind === 'file'
          ? 'out_dir no longer resolves where it did when the save was approved \u2014 the file was fetched but not saved; retry so it is checked again'
          : 'the destination folder no longer resolves where it did when the save was approved \u2014 the asset was fetched but not saved; retry so it is checked again',
        `${prefix}_write_moved`,
      )
    }
    throw new ArtifactSaveError(
      `the ${kind} was fetched but could not be saved (${getErrnoCode(e) ?? 'unexpected error'})`,
      `${prefix}_write_error`,
    )
  } finally {
    await guard?.close()
  }
}

/** densable eH — the read/asset approval pin key on Artifact input. */
export const ARTIFACT_ASSET_TARGET_PIN = '__artifactAssetTargetPin'

/**
 * densable `B` — every Artifact approval pin; j5 refuses an input carrying
 * any pin other than the action's own.
 */
export const ARTIFACT_APPROVAL_PIN_KEYS = [
  '__artifactPublishTarget',
  '__artifactAssetUploadPin',
  '__artifactRoomSendTarget',
  ARTIFACT_ASSET_TARGET_PIN,
  '__artifactReadTargetPin',
  '__artifactDeletePin',
  '__artifactConsentPin',
  '__artifactSyncTargetPin',
] as const

/** densable j5 */
export function hasForeignArtifactPin(input: object, own: string): boolean {
  return ARTIFACT_APPROVAL_PIN_KEYS.some(
    k => k !== own && Reflect.get(input, k) !== undefined,
  )
}

/**
 * densable `Sn[eH]` (2.1.289) — stamped by checkPermissions on list_assets /
 * read_asset / list_files / read_file; read_file carries `path`+`stem` or
 * `paths`+`stems` (+`skipped`). `out_dir` (the resolved base) is stamped
 * beside it on the input, not inside.
 */
export type ArtifactAssetTargetPin = {
  action:
    | 'read_file'
    | 'read_asset'
    | 'list_files'
    | 'list_assets'
    | 'delete_asset'
  slug: string
  assetId?: string
  stem?: string
  stems?: string[]
  path?: string
  paths?: string[]
  skipped?: string[]
  liveCopy?: boolean
  defaultDir?: boolean
  once?: boolean
  userOnly?: boolean
  classifier?: boolean
}

/** @deprecated use {@link ArtifactAssetTargetPin} (densable eH pin). */
export type OutDirPin = ArtifactAssetTargetPin
