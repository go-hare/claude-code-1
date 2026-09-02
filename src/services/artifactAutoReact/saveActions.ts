/**
 * densable read_file / read_asset call bodies (2.1.239) — out_dir save path.
 * Gold: AWt/EWt resolve → TCm/JCm fetch → j4e wx + XGi rename.
 */
import { createHash } from 'crypto'
import {
  artifactViewerUrlFor,
  parseArtifactUrl,
} from '../../utils/artifactUrl.js'
import {
  extensionForContentType,
  isNetworkOrDevicePath,
  artifactJweWriteBlock,
  resolveAssetOutStem,
  resolveFileOutDest,
  writeBytesExclusive,
  type OutDirPin,
} from './outDirPaths.js'
import { fetchArtifactAssetBytes, fetchArtifactFileBytes } from './restApis.js'

export type ReadFileSaveResult = {
  file_read: {
    url: string
    path: string
    dest: string
    ver: string
    content_type: string
    size_bytes: number
    sha256: string
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

/**
 * densable read_file call (portable) — requires confirmed out_dir pin when present.
 */
export async function callArtifactReadFile(input: {
  url: string
  path: string
  out_dir?: string
  pin?: OutDirPin
  signal?: AbortSignal
  agentId?: string
  agentWorktree?: string
}): Promise<{ data: ReadFileSaveResult } | { error: string }> {
  const parsed = parseArtifactUrl(input.url)
  if (!parsed) {
    return { error: '`url` must be an artifact URL for action "read_file"' }
  }
  const destRes = resolveFileOutDest({
    url: input.url,
    path: input.path,
    out_dir: input.out_dir,
  })
  if ('reason' in destRes) {
    return { error: destRes.reason }
  }
  const { dest } = destRes
  if (isNetworkOrDevicePath(dest)) {
    return {
      error:
        'read_file saves only to local directories — out_dir names a network path',
    }
  }
  const jwe = artifactJweWriteBlock(dest, {
    agentId: input.agentId,
    agentWorktree: input.agentWorktree,
  })
  if (jwe) {
    return { error: jwe }
  }
  if (input.pin) {
    if (
      input.pin.action !== 'read_file' ||
      input.pin.slug !== parsed.slug ||
      input.pin.stem !== dest ||
      (input.pin.path !== undefined && input.pin.path !== input.path)
    ) {
      return {
        error:
          '`out_dir` no longer names the destination this read was approved for — nothing was fetched; retry so it is checked again',
      }
    }
  }
  const fetched = await fetchArtifactFileBytes({
    slug: parsed.slug,
    path: input.path,
    env: parsed.env,
    signal: input.signal,
  })
  if (fetched.kind === 'error') {
    return { error: fetched.message }
  }
  try {
    await writeBytesExclusive(dest, fetched.bytes)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unexpected error'
    return {
      error: `the file was fetched but could not be saved (${msg})`,
    }
  }
  return {
    data: {
      file_read: {
        url: artifactViewerUrlFor(parsed),
        path: fetched.path,
        dest,
        ver: fetched.ver,
        content_type: fetched.contentType,
        size_bytes: fetched.bytes.length,
        sha256: fetched.sha256,
      },
    },
  }
}

/**
 * densable read_asset call (portable).
 */
export async function callArtifactReadAsset(input: {
  url: string
  asset_id: string
  out_dir?: string
  pin?: OutDirPin
  signal?: AbortSignal
  agentId?: string
  agentWorktree?: string
}): Promise<{ data: ReadAssetSaveResult } | { error: string }> {
  const parsed = parseArtifactUrl(input.url)
  if (!parsed) {
    return { error: '`url` must be an artifact URL for action "read_asset"' }
  }
  const stem = resolveAssetOutStem({
    url: input.url,
    asset_id: input.asset_id,
    out_dir: input.out_dir,
  })
  if (stem === undefined || isNetworkOrDevicePath(stem)) {
    return {
      error:
        'read_asset saves only to local directories — out_dir names a network path or cannot be resolved',
    }
  }
  const jwe = artifactJweWriteBlock(stem, {
    agentId: input.agentId,
    agentWorktree: input.agentWorktree,
  })
  if (jwe) {
    return { error: jwe }
  }
  if (input.pin) {
    if (
      input.pin.action !== 'read_asset' ||
      input.pin.slug !== parsed.slug ||
      input.pin.stem !== stem ||
      (input.pin.assetId !== undefined &&
        input.pin.assetId !== input.asset_id.toLowerCase())
    ) {
      return {
        error:
          '`out_dir` no longer names the destination this read was approved for — nothing was fetched; retry so it is checked again',
      }
    }
  }
  const fetched = await fetchArtifactAssetBytes({
    slug: parsed.slug,
    assetId: input.asset_id,
    env: parsed.env,
    signal: input.signal,
  })
  if (fetched.kind === 'error') {
    return { error: fetched.message }
  }
  const ext = extensionForContentType(fetched.contentType)
  if (ext === undefined) {
    return {
      error:
        'asset read failed: the content host served a type this tool does not save',
    }
  }
  const dest = `${stem}${ext}`
  try {
    await writeBytesExclusive(dest, fetched.bytes)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unexpected error'
    return {
      error: `the asset was fetched but could not be saved (${msg})`,
    }
  }
  return {
    data: {
      asset_read: {
        id: input.asset_id.toLowerCase(),
        path: dest,
        size_bytes: fetched.bytes.length,
        content_type: fetched.contentType,
        sha256: createHash('sha256').update(fetched.bytes).digest('hex'),
      },
    },
  }
}
