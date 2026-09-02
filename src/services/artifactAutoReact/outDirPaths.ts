/**
 * densable AWt / EWt / Wtn / Rto / SGi / Wot portable (2.1.239).
 * Gold: function EWt / AWt / SGi / TCm / JCm peels from SEA.
 *
 * out_dir resolves a local directory; read_file joins published `path` segments;
 * read_asset joins `asset_id` then appends SGi(content-type) extension after fetch.
 */
import { randomBytes } from 'crypto'
import { mkdir, rename, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'path'
import { checkBgIsolationWriteBlock } from '../../utils/bgIsolationContainment.js'
import { getCwd } from '../../utils/cwd.js'
import { expandPath, isDeviceOrNtNamespacePath } from '../../utils/path.js'
import { parseArtifactUrl } from '../../utils/artifactUrl.js'

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

/** densable e5i — default out_dir under session temp: artifact-files/<slug>. */
export function defaultArtifactFilesDir(slug: string): string {
  const root =
    process.env.CLAUDE_CODE_ARTIFACT_FILES_DIR?.trim() ||
    join(tmpdir(), 'claude-code-artifact-files')
  return join(root, slug)
}

function resolveOutDirBase(
  outDir: string | undefined,
  url: string | undefined,
): { base: string } | { reason: string } {
  try {
    if (outDir === undefined || outDir === '') {
      const parsed = typeof url === 'string' ? parseArtifactUrl(url) : null
      const fallback =
        parsed !== null ? defaultArtifactFilesDir(parsed.slug) : getCwd()
      return { base: resolve(fallback) }
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
  const { assetId, outDir } = readOutDirFields(input)
  if (assetId === undefined || !ARTIFACT_ASSET_ID_RE.test(assetId))
    return undefined
  try {
    let base: string
    if (outDir === undefined || outDir === '') {
      const parsed =
        typeof input.url === 'string' ? parseArtifactUrl(input.url) : null
      base = parsed !== null ? defaultArtifactFilesDir(parsed.slug) : getCwd()
    } else {
      base = expandPath(outDir)
    }
    if (isNetworkOrDevicePath(base)) return undefined
    return join(base, assetId.toLowerCase())
  } catch {
    return undefined
  }
}

/**
 * densable AWt — {dest, base} or {reason}.
 */
export function resolveFileOutDest(
  input: {
    url?: string
    path?: string
    out_dir?: string
  },
  opts?: { outDirJudged?: boolean },
): { dest: string; base: string } | { reason: string } {
  void opts
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
  const { base } = resolved
  if (
    process.platform === 'win32' &&
    base.split(sep).some(c => c !== '' && /[. ]$/.test(c))
  ) {
    return {
      reason: `out_dir ${JSON.stringify(outDir)} has a name ending in a dot or space, which Windows would save under a different name`,
    }
  }
  return { dest: join(base, ...segments), base }
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
 * densable write path: mkdir → writeFile(tmp, wx) → XGi rename (retry unlink dest).
 */
export async function writeBytesExclusive(
  dest: string,
  bytes: Buffer,
): Promise<void> {
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

/** Permission pin shape stamped on ask/allow (densable wWt stem). */
export type OutDirPin = {
  action: 'read_file' | 'read_asset'
  slug: string
  stem: string
  path?: string
  assetId?: string
}
