import { mkdir, open } from 'fs/promises'
import { join } from 'path'
import { getSessionId } from '../bootstrap/state.js'
import type { AppState } from '../state/AppStateStore.js'
import type { PastedContent } from './config.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { getFsImplementation } from './fsOperations.js'

const IMAGE_STORE_DIR = 'image-cache'
const MAX_STORED_IMAGE_PATHS = 200

export type SetAppState = (f: (prev: AppState) => AppState) => void

/**
 * densable V9d — immutable Map update with cap eviction for new keys.
 */
export function withStoredImagePath(
  prev: Map<number, string>,
  imageId: number,
  path: string,
): Map<number, string> {
  if (prev.get(imageId) === path) return prev
  const next = new Map(prev)
  if (!next.has(imageId)) {
    while (next.size >= MAX_STORED_IMAGE_PATHS) {
      const oldest = next.keys().next().value
      if (oldest === undefined) break
      next.delete(oldest)
    }
  }
  next.set(imageId, path)
  return next
}

/**
 * densable G9d — stamp one image path into AppState.storedImagePaths.
 */
export function stampStoredImagePath(
  setAppState: SetAppState | undefined,
  imageId: number,
  path: string,
): void {
  if (!setAppState) return
  setAppState(prev => {
    const next = withStoredImagePath(prev.storedImagePaths, imageId, path)
    return next === prev.storedImagePaths
      ? prev
      : { ...prev, storedImagePaths: next }
  })
}

/**
 * Get the image store directory for the current session.
 */
function getImageStoreDir(): string {
  return join(getClaudeConfigHomeDir(), IMAGE_STORE_DIR, getSessionId())
}

/**
 * Ensure the image store directory exists.
 */
async function ensureImageStoreDir(): Promise<void> {
  const dir = getImageStoreDir()
  await mkdir(dir, { recursive: true })
}

/**
 * Get the file path for an image by ID.
 */
function getImagePath(imageId: number, mediaType: string): string {
  const extension = mediaType.split('/')[1] || 'png'
  return join(getImageStoreDir(), `${imageId}.${extension}`)
}

/**
 * densable Cct — cache path immediately (fast, no file I/O) and stamp AppState.
 */
export function cacheImagePath(
  content: PastedContent,
  setAppState?: SetAppState,
): string | null {
  if (content.type !== 'image') {
    return null
  }
  const imagePath = getImagePath(content.id, content.mediaType || 'image/png')
  stampStoredImagePath(setAppState, content.id, imagePath)
  return imagePath
}

/**
 * densable wct / W9d — store an image from pastedContents to disk, stamp path.
 */
export async function storeImage(
  content: PastedContent,
  setAppState?: SetAppState,
): Promise<string | null> {
  if (content.type !== 'image') {
    return null
  }

  try {
    await ensureImageStoreDir()
    const imagePath = getImagePath(content.id, content.mediaType || 'image/png')
    const fh = await open(imagePath, 'w', 0o600)
    try {
      await fh.writeFile(content.content, { encoding: 'base64' })
      await fh.datasync()
    } finally {
      await fh.close()
    }
    stampStoredImagePath(setAppState, content.id, imagePath)
    logForDebugging(`Stored image ${content.id} to ${imagePath}`)
    return imagePath
  } catch (error) {
    logForDebugging(`Failed to store image: ${error}`)
    return null
  }
}

/**
 * densable j9d — store all images from pastedContents and batch-stamp AppState.
 */
export async function storeImages(
  pastedContents: Record<number, PastedContent>,
  setAppState?: SetAppState,
): Promise<Map<number, string>> {
  const pathMap = new Map<number, string>()

  for (const [id, content] of Object.entries(pastedContents)) {
    if (content.type === 'image') {
      // Disk write only; batch stamp below (avoid N setAppState).
      const path = await storeImage(content)
      if (path) {
        pathMap.set(Number(id), path)
      }
    }
  }

  if (pathMap.size > 0 && setAppState) {
    setAppState(prev => {
      let next = prev.storedImagePaths
      for (const [id, path] of pathMap) {
        next = withStoredImagePath(next, id, path)
      }
      return next === prev.storedImagePaths
        ? prev
        : { ...prev, storedImagePaths: next }
    })
  }

  return pathMap
}

/**
 * densable yb selector helper — prefer AppState, optional module-less path.
 * Components should use useAppState(s => s.storedImagePaths.get(id) ?? null).
 */
export function getStoredImagePathFromState(
  state: Pick<AppState, 'storedImagePaths'>,
  imageId: number,
): string | null {
  return state.storedImagePaths.get(imageId) ?? null
}

/**
 * @deprecated Prefer AppState.storedImagePaths via useAppState. Kept only for
 * non-React callers that already hold a path snapshot from storeImages.
 */
export function getStoredImagePath(
  imageId: number,
  state?: Pick<AppState, 'storedImagePaths'>,
): string | null {
  if (state) {
    return state.storedImagePaths.get(imageId) ?? null
  }
  return null
}

/**
 * densable session_start clear of storedImagePaths.
 * Prefer setAppState clear when available; no-op for disk files (session dir cleanup is separate).
 */
export function clearStoredImagePaths(setAppState?: SetAppState): void {
  if (!setAppState) return
  setAppState(prev =>
    prev.storedImagePaths.size === 0
      ? prev
      : { ...prev, storedImagePaths: new Map() },
  )
}

/**
 * Clean up old image cache directories from previous sessions.
 */
export async function cleanupOldImageCaches(): Promise<void> {
  const fsImpl = getFsImplementation()
  const baseDir = join(getClaudeConfigHomeDir(), IMAGE_STORE_DIR)
  const currentSessionId = getSessionId()

  try {
    let sessionDirs
    try {
      sessionDirs = await fsImpl.readdir(baseDir)
    } catch {
      return
    }

    for (const sessionDir of sessionDirs) {
      if (sessionDir.name === currentSessionId) {
        continue
      }

      const sessionPath = join(baseDir, sessionDir.name)
      try {
        await fsImpl.rm(sessionPath, { recursive: true, force: true })
        logForDebugging(`Cleaned up old image cache: ${sessionPath}`)
      } catch {
        // Ignore errors for individual directories
      }
    }

    try {
      const remaining = await fsImpl.readdir(baseDir)
      if (remaining.length === 0) {
        await fsImpl.rmdir(baseDir)
      }
    } catch {
      // Ignore
    }
  } catch {
    // Ignore errors reading base directory
  }
}
