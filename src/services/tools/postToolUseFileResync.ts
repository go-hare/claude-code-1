/**
 * densable Llo — after Edit/Write PostToolUse hooks, if a formatter rewrote
 * the file on disk (mtime newer, full prior read), re-seed readFileState so the
 * next Edit does not fail stale-file, and emit hook_additional_context.
 * Behavior only (no analytics).
 */

import { FILE_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileWriteTool/prompt.js'
import type { Attachment } from '../../utils/attachments.js'
import { logForDebugging } from '../../utils/debug.js'
import { getFileModificationTime } from '../../utils/file.js'
import { readFileSyncWithMetadata } from '../../utils/fileRead.js'
import {
  fileStateContentMatches,
  type FileStateCache,
} from '../../utils/fileStateCache.js'
import { expandPath } from '../../utils/path.js'

/**
 * densable Llo(e,t,r,n) — returns attachment when disk changed after Edit/Write
 * and prior read was full-file. Always updates readFileState when mtime advanced
 * (densable sets before ALe short-circuit).
 */
export function resyncReadFileStateAfterPostToolUse(
  toolName: string,
  toolUseID: string,
  toolInput: unknown,
  readFileState: FileStateCache,
): Attachment | null {
  if (toolName !== FILE_EDIT_TOOL_NAME && toolName !== FILE_WRITE_TOOL_NAME) {
    return null
  }
  if (
    typeof toolInput !== 'object' ||
    toolInput === null ||
    !('file_path' in toolInput) ||
    typeof (toolInput as { file_path?: unknown }).file_path !== 'string'
  ) {
    return null
  }
  try {
    const filePath = expandPath((toolInput as { file_path: string }).file_path)
    const prior = readFileState.get(filePath)
    // densable: only full-file prior reads (offset/limit undefined)
    if (!prior || prior.offset !== undefined || prior.limit !== undefined) {
      return null
    }
    const mtime = getFileModificationTime(filePath)
    if (mtime <= prior.timestamp) {
      return null
    }
    const disk = readFileSyncWithMetadata(filePath)
    // densable always re-sets; ALe decides whether to emit context
    readFileState.set(filePath, {
      content: disk.content,
      timestamp: mtime,
      offset: undefined,
      limit: undefined,
    })
    if (fileStateContentMatches(prior, disk.content)) {
      return null
    }
    logForDebugging(
      `PostToolUse hook modified ${filePath} after ${toolName} — re-synced readFileState`,
      { level: 'info' },
    )
    return {
      type: 'hook_additional_context',
      content: [
        `PostToolUse hook modified ${filePath} after your edit (likely a formatter). Your next Edit will not fail with a stale-file error, but if its old_string targets a region the hook reformatted, Read the file first.`,
      ],
      hookName: `PostToolUse:${toolName}`,
      toolUseID,
      hookEvent: 'PostToolUse',
    }
  } catch {
    return null
  }
}
