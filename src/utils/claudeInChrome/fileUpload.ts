/**
 * densable 2.1.211 Claude in Chrome file_upload path policy (Host-side).
 *
 * densable symbols: Biy = prepareChromeFileUploadInput, Ned = expand paths→files,
 * Uiy = path allowlist, jiy = open/read, $ed = uploadRootsForSession, Med = user error.
 *
 * Policy runs on the Host with live ToolPermissionContext before the Chrome MCP
 * bridge sees file contents — same shape as densable MCP client wrap.
 */

import { createHash } from 'crypto'
import { constants as fsConstants } from 'fs'
import {
  lstat as lstatAsync,
  open as openAsync,
  realpath as realpathAsync,
} from 'fs/promises'
import { basename, dirname, extname, join, sep } from 'path'
import { BRIDGE_ONLY_BROWSER_TOOLS } from '@ant/claude-for-chrome-mcp'
import { getSessionId } from '../../bootstrap/state.js'
import type { ToolPermissionContext } from '../../Tool.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from '../envUtils.js'
import { logForDebugging } from '../debug.js'
import { expandPath } from '../path.js'
import {
  matchingRuleForInput,
  normalizeCaseForComparison,
  pathInAllowedWorkingPath,
} from '../permissions/filesystem.js'
import { permissionRuleValueFromString } from '../permissions/permissionRuleParser.js'
import { getPathsForPermissionCheck } from '../fsOperations.js'
import { containsVulnerableUncPath } from '../shell/readOnlyCommandValidation.js'
import { DEFAULT_STAGE_FILE_ROOT } from '../syncedFileSyncer.js'
import { getPlatform } from '../platform.js'

/** densable Fps */
export const FILE_UPLOAD_MAX_TOTAL_BYTES = 10 * 1024 * 1024

const ATTACHMENT_DIGEST_CAP = 1024
const ATTACHMENT_NAME_PREFIX = /^[A-Za-z0-9_-]{8}-/

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.json': 'application/json',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

/** densable jzu / Wzu — optional attachment content binding. */
const attachmentDigests = new Map<string, string>()

export function registerChromeUploadAttachmentDigest(
  absolutePath: string,
  sha256Hex: string,
): void {
  const key = expandPath(absolutePath)
  if (
    !attachmentDigests.has(key) &&
    attachmentDigests.size >= ATTACHMENT_DIGEST_CAP
  ) {
    const oldest = attachmentDigests.keys().next().value
    if (oldest !== undefined) attachmentDigests.delete(oldest)
  }
  attachmentDigests.set(key, sha256Hex)
}

export function getChromeUploadAttachmentDigest(
  absolutePath: string,
): string | undefined {
  return attachmentDigests.get(expandPath(absolutePath))
}

/** Test helper — clear digest registry. */
export function clearChromeUploadAttachmentDigestsForTests(): void {
  attachmentDigests.clear()
}

export function sha256Hex(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex')
}

/** densable Med */
export function chromeFileUploadDeniedMessage(path: string): string {
  return `Cannot upload "${path}": only files this session is allowed to read can be uploaded. Ask the user to share the file with this session, or to add its folder with /add-dir.`
}

/** densable lrr */
export function getChromeSessionUploadsDir(): string {
  return join(getClaudeConfigHomeDir(), 'uploads', getSessionId())
}

type UploadRoot = { path: string; kind: 'attachments' | 'staging' }

/** densable $ed */
export function uploadRootsForSession(
  _permCtx?: ToolPermissionContext,
): UploadRoot[] {
  const roots: UploadRoot[] = [
    { path: getChromeSessionUploadsDir(), kind: 'attachments' },
  ]
  const explicitStage = process.env.CLAUDE_STAGE_FILE_ROOT?.trim()
  if (explicitStage) {
    roots.push({ path: explicitStage, kind: 'staging' })
    roots.push({
      path: join(dirname(explicitStage), 'outputs'),
      kind: 'staging',
    })
    return roots
  }
  if (
    isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) ||
    isEnvTruthy(process.env.CLAUDE_CODE_REMOTE_SESSION_ID)
  ) {
    roots.push({ path: DEFAULT_STAGE_FILE_ROOT, kind: 'staging' })
    roots.push({
      path: join(dirname(DEFAULT_STAGE_FILE_ROOT), 'outputs'),
      kind: 'staging',
    })
  }
  return roots
}

function isNetworkOrUncPath(path: string): boolean {
  if (path.startsWith('\\\\') || path.startsWith('//')) return true
  if (containsVulnerableUncPath(path)) return true
  return false
}

/** densable eat — subset via filesystem hasSuspicious patterns (inlined). */
function hasSuspiciousWindowsPathPattern(path: string): boolean {
  const platform = getPlatform()
  if (platform === 'windows' || platform === 'wsl') {
    if (path.indexOf(':', 2) !== -1) return true
  }
  if (/~\d/.test(path)) return true
  if (
    path.startsWith('\\\\?\\') ||
    path.startsWith('\\\\.\\') ||
    path.startsWith('//?/') ||
    path.startsWith('//./')
  ) {
    return true
  }
  if (/\.{3,}/.test(path)) return true
  return false
}

function stripAttachmentNamePrefix(name: string): string {
  if (ATTACHMENT_NAME_PREFIX.test(name)) {
    return name.replace(ATTACHMENT_NAME_PREFIX, '') || name
  }
  return name
}

function mimeForPath(p: string): string {
  return MIME_BY_EXT[extname(p).toLowerCase()] ?? 'application/octet-stream'
}

function toolRulesMentionRead(
  rulesBySource:
    | ToolPermissionContext['alwaysDenyRules']
    | ToolPermissionContext['alwaysAskRules'],
): boolean {
  for (const rules of Object.values(rulesBySource)) {
    if (!Array.isArray(rules)) continue
    for (const rule of rules) {
      if (typeof rule !== 'string') continue
      // Whole-tool Read restriction (no path content) blocks non-root uploads.
      const { toolName, ruleContent } = permissionRuleValueFromString(rule)
      if (
        (toolName === 'Read' || toolName === 'FileReadTool') &&
        !ruleContent
      ) {
        return true
      }
    }
  }
  return false
}

class ChromeUploadPathError extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message)
    this.name = 'ChromeUploadPathError'
  }
}

/**
 * densable Uiy — resolve path under session allowlist / working dirs.
 * Throws ChromeUploadPathError on deny (caller maps to Med).
 */
export async function assertChromeUploadPath(
  originalPath: string,
  permCtx: ToolPermissionContext,
): Promise<{ realPath: string; requiredDigest?: string }> {
  const expanded = expandPath(originalPath.trim())
  const variants = getPathsForPermissionCheck(expanded)

  for (const p of [originalPath.trim(), ...variants]) {
    if (isNetworkOrUncPath(p)) {
      throw new ChromeUploadPathError(
        `network path not allowed: ${p}`,
        'claudeInChrome/fileUpload: network path rejected before filesystem access',
      )
    }
    if (hasSuspiciousWindowsPathPattern(p)) {
      throw new ChromeUploadPathError(
        `suspicious path spelling: ${p}`,
        'claudeInChrome/fileUpload: suspicious Windows path pattern rejected',
      )
    }
  }

  let realPath: string
  try {
    realPath = await realpathAsync(expanded)
  } catch {
    throw new ChromeUploadPathError(
      `unresolvable: ${originalPath}`,
      'claudeInChrome/fileUpload: realpath failed',
    )
  }

  const after = new Set([...variants, ...getPathsForPermissionCheck(realPath)])
  for (const p of after) {
    if (isNetworkOrUncPath(p)) {
      throw new ChromeUploadPathError(
        `network path not allowed: ${p}`,
        'claudeInChrome/fileUpload: network path rejected after resolution',
      )
    }
    if (hasSuspiciousWindowsPathPattern(p)) {
      throw new ChromeUploadPathError(
        `suspicious path spelling: ${p}`,
        'claudeInChrome/fileUpload: suspicious Windows path pattern rejected',
      )
    }
    if (matchingRuleForInput(p, permCtx, 'read', 'deny')) {
      throw new ChromeUploadPathError(
        `read denied: ${p}`,
        'claudeInChrome/fileUpload: path matches a read deny rule',
      )
    }
    if (matchingRuleForInput(p, permCtx, 'read', 'ask')) {
      throw new ChromeUploadPathError(
        `read requires approval: ${p}`,
        'claudeInChrome/fileUpload: path matches a read ask rule',
      )
    }
  }

  // Session upload roots (attachments / staging)
  for (const root of uploadRootsForSession(permCtx)) {
    let rootReal: string | undefined
    try {
      const lst = await lstatAsync(root.path)
      if (lst.isSymbolicLink() || !lst.isDirectory()) continue
      const openFlags =
        fsConstants.O_RDONLY |
        (typeof fsConstants.O_DIRECTORY === 'number'
          ? fsConstants.O_DIRECTORY
          : 0) |
        (typeof fsConstants.O_NOFOLLOW === 'number'
          ? fsConstants.O_NOFOLLOW
          : 0)
      const handle = await openAsync(root.path, openFlags).catch(() => null)
      if (!handle) continue
      try {
        const st = await handle.stat()
        if (!st.isDirectory()) continue
        const rp = await realpathAsync(root.path).catch(() => undefined)
        if (rp === undefined) continue
        const st2 = await lstatAsync(rp).catch(() => null)
        // Compare via realpath equality; ino/dev when available
        if (st2 && 'ino' in st && 'ino' in st2) {
          if (
            (st2 as { ino: number }).ino !== (st as { ino: number }).ino ||
            (st2 as { dev: number }).dev !== (st as { dev: number }).dev
          ) {
            continue
          }
        }
        rootReal = rp
      } finally {
        await handle.close()
      }
    } catch {
      continue
    }
    if (!rootReal) continue

    // Case-insensitive prefix on macOS/Windows (match pathInAllowedWorkingPath).
    const rpN = normalizeCaseForComparison(realPath)
    const rootN = normalizeCaseForComparison(rootReal)
    if (rpN === rootN || rpN.startsWith(rootN + sep)) {
      if (root.kind === 'staging') {
        // densable: skip if staging root collides with project cwd
        const cwdReal = await realpathAsync(process.cwd()).catch(() =>
          process.cwd(),
        )
        const cwdN = normalizeCaseForComparison(cwdReal)
        if (
          rootN === cwdN ||
          rootN.startsWith(cwdN + sep) ||
          cwdN.startsWith(rootN + sep)
        ) {
          continue
        }
        return { realPath }
      }
      // Digest registry is keyed by expandPath; also try realPath.
      const digest =
        getChromeUploadAttachmentDigest(realPath) ??
        getChromeUploadAttachmentDigest(expandPath(realPath))
      return digest !== undefined
        ? { realPath, requiredDigest: digest }
        : { realPath }
    }
  }

  if (
    toolRulesMentionRead(permCtx.alwaysDenyRules) ||
    toolRulesMentionRead(permCtx.alwaysAskRules)
  ) {
    throw new ChromeUploadPathError(
      'Read tool is restricted for this session',
      'claudeInChrome/fileUpload: Read tool denied or ask-gated for this session',
    )
  }

  if (permCtx.mode === 'bypassPermissions') {
    return { realPath }
  }

  // densable Ptt(..., "read").allowed — pathInAllowedWorkingPath already expands
  // path variants; require only the resolved real path under working dirs.
  if (!pathInAllowedWorkingPath(realPath, permCtx)) {
    throw new ChromeUploadPathError(
      `read not allowed: ${realPath}`,
      'claudeInChrome/fileUpload: path read not allowed by session permissions',
    )
  }
  return { realPath }
}

/** densable jiy + Bed — open, hardlink check, TOCTOU, bounded read. */
async function readFileBounded(
  originalPath: string,
  realPath: string,
  budget: { remaining: number },
): Promise<{ buf: Buffer } | { error: string }> {
  let st
  try {
    st = await lstatAsync(realPath)
  } catch {
    return { error: `Cannot upload "${originalPath}": not a regular file.` }
  }
  if (!st.isFile()) {
    return { error: `Cannot upload "${originalPath}": not a regular file.` }
  }

  const openFlags =
    fsConstants.O_RDONLY |
    (typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0) |
    (typeof fsConstants.O_NONBLOCK === 'number' ? fsConstants.O_NONBLOCK : 0)

  let handle
  try {
    handle = await openAsync(realPath, openFlags)
  } catch (e) {
    return {
      error: `Cannot upload "${originalPath}": failed to open file (${e instanceof Error ? e.message : String(e)}).`,
    }
  }

  try {
    const st2 = await handle.stat()
    if (st2.nlink > 1) {
      return {
        error: `Cannot upload "${originalPath}": the file has multiple hard links, which can alias a file outside the session's allowed directories. This commonly triggers for files inside package-manager stores like node_modules (Bun and pnpm hard-link packages). Copy the file (e.g. with cp) and upload the copy.`,
      }
    }
    if (!st2.isFile()) {
      return {
        error: `Cannot upload "${originalPath}": path moved during validation.`,
      }
    }
    // densable Ued: same path still resolves; prefer ino/dev when available
    const still = await realpathAsync(realPath).catch(() => null)
    if (still === null) {
      return {
        error: `Cannot upload "${originalPath}": path moved during validation.`,
      }
    }
    if (still !== realPath) {
      const stillSt = await lstatAsync(still).catch(() => null)
      if (
        !stillSt ||
        !('ino' in stillSt) ||
        !('ino' in st2) ||
        (stillSt as { ino: number }).ino !== (st2 as { ino: number }).ino ||
        (stillSt as { dev: number }).dev !== (st2 as { dev: number }).dev
      ) {
        return {
          error: `Cannot upload "${originalPath}": path moved during validation.`,
        }
      }
    }
    if (st2.size > budget.remaining) {
      return {
        error: `Cannot upload "${originalPath}": total upload size would exceed ${Math.round(FILE_UPLOAD_MAX_TOTAL_BYTES / 1048576)} MB. file_upload sends file contents over the browser bridge in a single message; use a smaller file, or split across multiple file_upload calls if the page accepts files one at a time.`,
      }
    }

    // densable Bed: read size+1 to detect grow
    const alloc = st2.size + 1
    const buf = Buffer.allocUnsafe(alloc)
    let offset = 0
    while (offset < alloc) {
      const { bytesRead } = await handle.read(
        buf,
        offset,
        alloc - offset,
        offset,
      )
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset > st2.size) {
      return {
        error: `Cannot upload "${originalPath}": file grew during read.`,
      }
    }
    const slice = buf.subarray(0, offset)
    if (slice.length > budget.remaining) {
      return {
        error: `Cannot upload "${originalPath}": file grew during read.`,
      }
    }
    budget.remaining -= slice.length
    return { buf: slice }
  } catch (e) {
    return {
      error: `Cannot upload "${originalPath}": failed to read file (${e instanceof Error ? e.message : String(e)}).`,
    }
  } finally {
    await handle.close()
  }
}

/**
 * densable Ned — Host always expands `paths` → `files`.
 * Pre-supplied `files` without `paths` is rejected (would skip Uiy).
 */
async function expandFileUploadPaths(
  args: Record<string, unknown>,
  permCtx: ToolPermissionContext,
  budget: { remaining: number },
): Promise<{ input: Record<string, unknown> } | { error: string }> {
  // Model-supplied base64 without paths bypasses path allowlist — never accept.
  if (
    (!('paths' in args) ||
      !Array.isArray(args.paths) ||
      (args.paths as unknown[]).length === 0) &&
    Array.isArray(args.files)
  ) {
    return {
      error:
        'file_upload requires a non-empty `paths` array of files this session is allowed to read. Do not pass pre-encoded `files`; the Host expands paths under the session allowlist.',
    }
  }

  const paths = args.paths
  if (!Array.isArray(paths) || paths.length === 0) {
    return {
      error:
        'file_upload requires a non-empty `paths` array of files the user has shared with this session.',
    }
  }

  const files: Array<{ data: string; name: string; mimeType: string }> = []
  const uploadsReal = await realpathAsync(getChromeSessionUploadsDir()).catch(
    () => undefined,
  )

  for (const entry of paths) {
    if (typeof entry !== 'string') {
      return { error: 'file_upload `paths` entries must be strings.' }
    }
    let realPath: string
    let requiredDigest: string | undefined
    try {
      ;({ realPath, requiredDigest } = await assertChromeUploadPath(
        entry,
        permCtx,
      ))
    } catch (e) {
      logForDebugging(
        `[chrome file_upload] rejected path: ${entry} (${e instanceof Error ? e.message : String(e)})`,
      )
      return { error: chromeFileUploadDeniedMessage(entry) }
    }

    const read = await readFileBounded(entry, realPath, budget)
    if ('error' in read) return { error: read.error }

    if (
      requiredDigest !== undefined &&
      sha256Hex(read.buf) !== requiredDigest
    ) {
      logForDebugging(
        `[chrome file_upload] registered attachment digest mismatch: ${entry}`,
      )
      return { error: chromeFileUploadDeniedMessage(entry) }
    }

    const base = basename(realPath)
    const name =
      uploadsReal !== undefined && dirname(realPath) === uploadsReal
        ? stripAttachmentNamePrefix(base)
        : base

    files.push({
      data: read.buf.toString('base64'),
      name,
      mimeType: mimeForPath(realPath),
    })
  }

  const { paths: _paths, ...rest } = args
  return { input: { ...rest, files } }
}

/**
 * densable Biy / prepareChromeFileUploadInput.
 * Rewrites file_upload (and nested batch file_upload) paths → base64 files.
 * browser_batch structure / BRIDGE_ONLY checks match package prepareToolArgsForChrome
 * so Host rejects early with the same messages (not only after MCP package prep).
 */
export async function prepareChromeFileUploadInput(
  name: string,
  args: Record<string, unknown>,
  permCtx: ToolPermissionContext,
): Promise<{ input: Record<string, unknown> } | { error: string }> {
  const budget = { remaining: FILE_UPLOAD_MAX_TOTAL_BYTES }
  if (name === 'file_upload') {
    return expandFileUploadPaths(args, permCtx, budget)
  }
  if (name === 'browser_batch') {
    if (!Array.isArray(args.actions)) {
      return { error: 'browser_batch requires an `actions` array.' }
    }
    const actions = [...args.actions]
    let rewritten = false
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i]
      if (
        typeof action !== 'object' ||
        action === null ||
        typeof (action as { name?: unknown }).name !== 'string'
      ) {
        return {
          error:
            'browser_batch sub-actions must be objects with a string name, and browser_batch cannot be nested.',
        }
      }
      const actionName = (action as { name: string }).name
      if (!/^[\x20-\x7E]+$/.test(actionName)) {
        return {
          error: `browser_batch sub-action name "${actionName}" is not a valid tool name.`,
        }
      }
      const normalized = actionName.trim().toLowerCase()
      if (normalized === 'browser_batch') {
        return {
          error:
            'browser_batch sub-actions must be objects with a string name, and browser_batch cannot be nested.',
        }
      }
      if (normalized === 'file_upload' && actionName !== 'file_upload') {
        return {
          error: `browser_batch sub-action name "${actionName}" is not a valid tool name.`,
        }
      }
      // Top-level only: local pairing/list/select — never batch (package parity).
      if (BRIDGE_ONLY_BROWSER_TOOLS.has(normalized)) {
        return {
          error: `browser_batch cannot include "${actionName}" (switch_browser / list_connected_browsers / select_browser are top-level only, not batchable).`,
        }
      }
      if (actionName !== 'file_upload') {
        continue
      }
      const input =
        typeof (action as { input?: unknown }).input === 'object' &&
        (action as { input: unknown }).input !== null
          ? (action as { input: Record<string, unknown> }).input
          : {}
      // Always run Uiy/Ned — never trust model-supplied files without paths.
      const expanded = await expandFileUploadPaths(input, permCtx, budget)
      if ('error' in expanded) return { error: expanded.error }
      actions[i] = { ...(action as object), input: expanded.input }
      rewritten = true
    }
    return rewritten ? { input: { ...args, actions } } : { input: args }
  }
  return { input: args }
}

/** True when Host should run densable Biy before forwarding to Chrome MCP. */
export function isChromeFileUploadToolName(toolName: string): boolean {
  return toolName === 'file_upload' || toolName === 'browser_batch'
}
