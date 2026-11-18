import type {
  Base64ImageSource,
  ContentBlockParam,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { randomBytes } from 'crypto'
import { open, readFile, stat, statfs, unlink } from 'fs/promises'
import { dirname } from 'path'
import { getOriginalCwd } from 'src/bootstrap/state.js'
import { logEvent } from 'src/services/analytics/index.js'
import type { ToolPermissionContext } from 'src/Tool.js'
import { getCwd } from 'src/utils/cwd.js'
import { getErrnoCode } from 'src/utils/errors.js'
import { pathInAllowedWorkingPath } from 'src/utils/permissions/filesystem.js'
import { setCwd } from 'src/utils/Shell.js'
import { shouldMaintainProjectWorkingDir } from 'src/utils/envUtils.js'
import { maybeResizeAndDownsampleImageBuffer } from 'src/utils/imageResizer.js'
import { getMaxOutputLength } from 'src/utils/shell/outputLimits.js'
import { countCharInString, plural } from 'src/utils/stringUtils.js'
/**
 * Strips leading and trailing lines that contain only whitespace/newlines.
 * Unlike trim(), this preserves whitespace within content lines and only removes
 * completely empty lines from the beginning and end.
 */
export function stripEmptyLines(content: string): string {
  const lines = content.split('\n')

  // Find the first non-empty line
  let startIndex = 0
  while (startIndex < lines.length && lines[startIndex]?.trim() === '') {
    startIndex++
  }

  // Find the last non-empty line
  let endIndex = lines.length - 1
  while (endIndex >= 0 && lines[endIndex]?.trim() === '') {
    endIndex--
  }

  // If all lines are empty, return empty string
  if (startIndex > endIndex) {
    return ''
  }

  // Return the slice with non-empty lines
  return lines.slice(startIndex, endIndex + 1).join('\n')
}

/**
 * Check if content is a base64 encoded image data URL
 */
export function isImageOutput(content: string): boolean {
  return /^data:image\/[a-z0-9.+_-]+;base64,/i.test(content)
}

const DATA_URI_RE = /^data:([^;]+);base64,(.+)$/

/**
 * Parse a data-URI string into its media type and base64 payload.
 * Input is trimmed before matching.
 */
export function parseDataUri(
  s: string,
): { mediaType: string; data: string } | null {
  const match = s.trim().match(DATA_URI_RE)
  if (!match || !match[1] || !match[2]) return null
  return { mediaType: match[1], data: match[2] }
}

/**
 * Build an image tool_result block from shell stdout containing a data URI.
 * Returns null if parse fails so callers can fall through to text handling.
 */
export function buildImageToolResult(
  stdout: string,
  toolUseID: string,
): ToolResultBlockParam | null {
  const parsed = parseDataUri(stdout)
  if (!parsed) return null
  return {
    tool_use_id: toolUseID,
    type: 'tool_result',
    content: [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: parsed.mediaType as Base64ImageSource['media_type'],
          data: parsed.data,
        },
      },
    ],
  }
}

// Cap file reads to 20 MB — any image data URI larger than this is
// well beyond what the API accepts (5 MB base64) and would OOM if read
// into memory.
const MAX_IMAGE_FILE_SIZE = 20 * 1024 * 1024

/**
 * Resize image output from a shell tool. stdout is capped at
 * getMaxOutputLength() when read back from the shell output file — if the
 * full output spilled to disk, re-read it from there, since truncated base64
 * would decode to a corrupt image that either throws here or gets rejected by
 * the API. Caps dimensions too: compressImageBuffer only checks byte size, so
 * a small-but-high-DPI PNG (e.g. matplotlib at dpi=300) sails through at full
 * resolution and poisons many-image requests (CC-304).
 *
 * Returns the re-encoded data URI on success, or null if the source didn't
 * parse as a data URI (caller decides whether to flip isImage).
 */
export async function resizeShellImageOutput(
  stdout: string,
  outputFilePath: string | undefined,
  outputFileSize: number | undefined,
): Promise<string | null> {
  let source = stdout
  if (outputFilePath) {
    const size = outputFileSize ?? (await stat(outputFilePath)).size
    if (size > MAX_IMAGE_FILE_SIZE) return null
    source = await readFile(outputFilePath, 'utf8')
  }
  const parsed = parseDataUri(source)
  if (!parsed) return null
  const buf = Buffer.from(parsed.data, 'base64')
  const ext = parsed.mediaType.split('/')[1] || 'png'
  const resized = await maybeResizeAndDownsampleImageBuffer(
    buf,
    buf.length,
    ext,
  )
  return `data:image/${resized.mediaType};base64,${resized.buffer.toString('base64')}`
}

export function formatOutput(content: string): {
  totalLines: number
  truncatedContent: string
  isImage?: boolean
} {
  const isImage = isImageOutput(content)
  if (isImage) {
    return {
      totalLines: 1,
      truncatedContent: content,
      isImage,
    }
  }

  const maxOutputLength = getMaxOutputLength()
  if (content.length <= maxOutputLength) {
    return {
      totalLines: countCharInString(content, '\n') + 1,
      truncatedContent: content,
      isImage,
    }
  }

  const truncatedPart = content.slice(0, maxOutputLength)
  const remainingLines = countCharInString(content, '\n', maxOutputLength) + 1
  const truncated = `${truncatedPart}\n\n... [${remainingLines} lines truncated] ...`

  return {
    totalLines: countCharInString(content, '\n') + 1,
    truncatedContent: truncated,
    isImage,
  }
}

export const stdErrAppendShellResetMessage = (stderr: string): string =>
  `${stderr.trim()}\nShell cwd was reset to ${getOriginalCwd()}`

export function resetCwdIfOutsideProject(
  toolPermissionContext: ToolPermissionContext,
): boolean {
  const cwd = getCwd()
  const originalCwd = getOriginalCwd()
  const shouldMaintain = shouldMaintainProjectWorkingDir()
  if (
    shouldMaintain ||
    // Fast path: originalCwd is unconditionally in allWorkingDirectories
    // (filesystem.ts), so when cwd hasn't moved, pathInAllowedWorkingPath is
    // trivially true — skip its syscalls for the no-cd common case.
    (cwd !== originalCwd &&
      !pathInAllowedWorkingPath(cwd, toolPermissionContext))
  ) {
    // Reset to original directory if maintaining project dir OR outside allowed working directory
    setCwd(originalCwd)
    if (!shouldMaintain) {
      logEvent('tengu_bash_tool_reset_to_original_dir', {})
      return true
    }
  }
  return false
}

/**
 * Creates a human-readable summary of structured content blocks.
 * Used to display MCP results with images and text in the UI.
 */
export function createContentSummary(content: ContentBlockParam[]): string {
  const parts: string[] = []
  let textCount = 0
  let imageCount = 0

  for (const block of content) {
    if (block.type === 'image') {
      imageCount++
    } else if (block.type === 'text' && 'text' in block) {
      textCount++
      // Include first 200 chars of text blocks for context
      const preview = block.text.slice(0, 200)
      parts.push(preview + (block.text.length > 200 ? '...' : ''))
    }
  }

  const summary: string[] = []
  if (imageCount > 0) {
    summary.push(`[${imageCount} ${plural(imageCount, 'image')}]`)
  }
  if (textCount > 0) {
    summary.push(`[${textCount} text ${plural(textCount, 'block')}]`)
  }

  return `MCP Result: ${summary.join(', ')}${parts.length > 0 ? '\n\n' + parts.join('\n\n') : ''}`
}

const TEMP_VOLUME_REMEDY =
  "Free space on that volume, or restart Claude Code with CLAUDE_CODE_TMPDIR set to a directory on another one, then retry. If this is the user's own computer, tell them before deleting anything to make room."

/**
 * Official temp-dir volume full error (#1163, SEA @280178068):
 * Clear message instead of raw ENOSPC/EDQUOT when the temp volume is full.
 */
export class TempDirVolumeFullError extends Error {
  readonly code: 'ENOSPC' | 'EDQUOT'
  readonly shortMessage =
    'claude temp dir not created: volume full (ENOSPC/EDQUOT)'

  constructor(tempDir: string, rootDir: string, code: 'ENOSPC' | 'EDQUOT') {
    const reason =
      code === 'EDQUOT'
        ? `your disk quota on the volume holding ${rootDir} is used up (${code})`
        : `the volume holding ${rootDir} is full (${code})`
    super(
      `Claude Code's temporary directory ${tempDir} could not be created: ${reason}. Free space on that volume, or set CLAUDE_CODE_TMPDIR to a directory on another one, then try again.`,
    )
    this.name = 'TempDirVolumeFullError'
    this.code = code
  }
}

const PROBE_BYTE = new Uint8Array([10])

/** Official `gjs` @284918970: probe whether writing beside outputPath fails with ENOSPC/EDQUOT. */
export async function probeTaskOutputWrite(
  outputPath: string,
): Promise<string | null> {
  const probePath = `${outputPath}.${randomBytes(6).toString('hex')}.probe`
  try {
    let handle: Awaited<ReturnType<typeof open>>
    try {
      handle = await open(probePath, 'wx')
    } catch {
      return null
    }
    try {
      await handle.write(PROBE_BYTE)
    } finally {
      await handle.close()
    }
    return null
  } catch (err) {
    return getErrnoCode(err) ?? null
  } finally {
    await unlink(probePath).catch(() => {})
  }
}

/**
 * Official `P6o` @289021892 (#1163): diagnose disk-full / inode exhaustion /
 * EDQUOT when a Bash command fails after spilling stdout to a temp output file.
 */
export async function diagnoseDiskFullOnCommandFailure(
  outputPath: string,
  stdoutEmpty: boolean,
  tempDir: string = dirname(outputPath),
): Promise<string | null> {
  const lostClause = stdoutEmpty
    ? 'whatever this command printed was lost'
    : "this command's output may be cut short"
  const failClause = `so ${lostClause} and its own writes may have failed with "No space left on device".`
  let statfsOk = false
  try {
    const v = await statfs(dirname(outputPath), { bigint: true })
    const freeMb = (v.bavail * v.bsize) / (1024n * 1024n)
    statfsOk = freeMb >= 0n && v.blocks > 0n
    if (statfsOk && freeMb < 10n) {
      return `Disk full: this computer's volume holding ${tempDir} (Claude Code's temporary directory) has ${freeMb} MB free, ${failClause} ${TEMP_VOLUME_REMEDY}`
    }
    if (statfsOk && v.files > 0n && v.ffree < 1000n) {
      return `Nearly out of inodes: this computer's volume holding ${tempDir} (Claude Code's temporary directory) has ${v.ffree} free inodes, so creating files there may fail and the command may have failed for that reason. ${TEMP_VOLUME_REMEDY}`
    }
  } catch {
    // Fall through to probeTaskOutputWrite
  }
  if (statfsOk && !stdoutEmpty) {
    return null
  }
  const probeErr = await probeTaskOutputWrite(outputPath)
  if (probeErr === 'EDQUOT') {
    return `Disk quota used up: a test write beside this command's output file, on the volume holding ${tempDir} (Claude Code's temporary directory), failed with EDQUOT, so ${lostClause} and its own writes may have failed with "Disk quota exceeded". Delete files there that are no longer needed, or restart Claude Code with CLAUDE_CODE_TMPDIR set to a directory on another volume, then retry. If this is the user's own computer, tell them before deleting anything to make room.`
  }
  if (probeErr === 'ENOSPC') {
    return `Disk full: a test write beside this command's output file, on the volume holding ${tempDir} (Claude Code's temporary directory), failed with ENOSPC (the volume, or the user's quota on it, has no space left), ${failClause} ${TEMP_VOLUME_REMEDY}`
  }
  return null
}
