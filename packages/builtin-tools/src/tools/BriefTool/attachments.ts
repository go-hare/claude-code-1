/**
 * Shared attachment validation + resolution for SendUserMessage and
 * SendUserFile. Lives in BriefTool/ so the dynamic `./upload.js` import
 * inside the feature('BRIDGE_MODE') guard stays relative and upload.ts
 * (axios, crypto, auth utils) remains tree-shakeable from non-bridge builds.
 */

import { feature } from 'bun:bundle'
import { stat } from 'fs/promises'
import { basename } from 'path'

import type { ValidationResult } from 'src/Tool.js'

import { getCwd } from 'src/utils/cwd.js'
import { getErrnoCode } from 'src/utils/errors.js'
import { IMAGE_EXTENSION_REGEX } from 'src/utils/imagePaste.js'
import { expandPath } from 'src/utils/path.js'
import { shouldUploadBriefAttachments } from 'src/utils/residualFinalEnvGates.js'

/**
 * Official 2.1.321 #1898:
 * Reject filenames containing Unicode bidirectional-formatting characters
 * (RLO/LRO/LRE/RLE/PDF/LRI/RLI/FSI/PDI/LRM/RLM/ALM) or ASCII/C1 control
 * characters so a sent file cannot spoof its displayed name/extension.
 */
export const UNSAFE_FILENAME_BIDI_OR_CONTROL_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally rejects control/bidi characters in filenames
  /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/

export function hasUnsafeFilenameCharacters(filePath: string): boolean {
  const name = basename(filePath.replace(/\\/g, '/'))
  return UNSAFE_FILENAME_BIDI_OR_CONTROL_RE.test(name)
}

export function unsafeFilenameRefusalMessage(filePath: string): string {
  return `Refusing to send "${filePath}": filename contains bidirectional-formatting or control characters. Rename the file to a plain filename first.`
}

export type ResolvedAttachment = {
  path: string
  size: number
  isImage: boolean
  file_uuid?: string
}

export async function validateAttachmentPaths(
  rawPaths: string[],
): Promise<ValidationResult> {
  const cwd = getCwd()
  for (const rawPath of rawPaths) {
    if (hasUnsafeFilenameCharacters(rawPath)) {
      return {
        result: false,
        message: unsafeFilenameRefusalMessage(rawPath),
        errorCode: 1,
      }
    }
    const fullPath = expandPath(rawPath)
    try {
      const stats = await stat(fullPath)
      if (!stats.isFile()) {
        return {
          result: false,
          message: `Attachment "${rawPath}" is not a regular file.`,
          errorCode: 1,
        }
      }
    } catch (e) {
      const code = getErrnoCode(e)
      if (code === 'ENOENT') {
        return {
          result: false,
          message: `Attachment "${rawPath}" does not exist. Current working directory: ${cwd}.`,
          errorCode: 1,
        }
      }
      if (code === 'EACCES' || code === 'EPERM') {
        return {
          result: false,
          message: `Attachment "${rawPath}" is not accessible (permission denied).`,
          errorCode: 1,
        }
      }
      throw e
    }
  }
  return { result: true }
}

export async function resolveAttachments(
  rawPaths: string[],
  uploadCtx: { replBridgeEnabled: boolean; signal?: AbortSignal },
): Promise<ResolvedAttachment[]> {
  // Stat serially (local, fast) to keep ordering deterministic, then upload
  // in parallel (network, slow). Upload failures resolve undefined — the
  // attachment still carries {path, size, isImage} for local renderers.
  const stated: ResolvedAttachment[] = []
  for (const rawPath of rawPaths) {
    if (hasUnsafeFilenameCharacters(rawPath)) {
      throw new Error(unsafeFilenameRefusalMessage(rawPath))
    }
    const fullPath = expandPath(rawPath)
    // Single stat — we need size, so this is the operation, not a guard.
    // validateInput ran before us, but the file could have moved since
    // (TOCTOU); if it did, let the error propagate so the model sees it.
    const stats = await stat(fullPath)
    stated.push({
      path: fullPath,
      size: stats.size,
      isImage: IMAGE_EXTENSION_REGEX.test(fullPath),
    })
  }
  // Dynamic import inside the feature() guard so upload.ts (axios, crypto,
  // zod, auth utils, MIME map) is fully eliminated from non-BRIDGE_MODE
  // builds. A static import would force module-scope evaluation regardless
  // of the guard inside uploadBriefAttachment — CLAUDE.md: "helpers defined
  // outside remain in the build even if never called".
  if (feature('BRIDGE_MODE')) {
    // Headless/SDK callers never set appState.replBridgeEnabled (only the TTY
    // REPL does, at main.tsx init). Official: bridge || BRIEF_UPLOAD ||
    // REMOTE_ENVIRONMENT_TYPE || REMOTE (paths are host-local).
    const shouldUpload = shouldUploadBriefAttachments({
      replBridgeEnabled: uploadCtx.replBridgeEnabled,
    })
    const { uploadBriefAttachment } = await import('./upload.js')
    const uuids = await Promise.all(
      stated.map(a =>
        uploadBriefAttachment(a.path, a.size, {
          replBridgeEnabled: shouldUpload,
          signal: uploadCtx.signal,
        }),
      ),
    )
    return stated.map((a, i) =>
      uuids[i] === undefined ? a : { ...a, file_uuid: uuids[i] },
    )
  }
  return stated
}
