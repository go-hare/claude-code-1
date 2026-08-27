/**
 * densable odm / Drf — IDE diff eligibility for file permission prompts.
 */
import { FileEditTool } from '@claude-code/builtin-tools/tools/FileEditTool/FileEditTool.js'
import { FileWriteTool } from '@claude-code/builtin-tools/tools/FileWriteTool/FileWriteTool.js'
import type { FileEdit } from '@claude-code/builtin-tools/tools/FileEditTool/types.js'
import { isFilePermissionNetworkPath } from '../components/permissions/FilePermissionDialog/filePermissionPreviewWithhold.js'
import type { Tool, ToolUseContext } from '../Tool.js'
import { getGlobalConfig } from '../utils/config.js'
import { expandPath } from '../utils/path.js'
import {
  getConnectedIdeClient,
  getConnectedIdeName,
  hasAccessToIDEExtensionDiffFeature,
} from '../utils/ide.js'
import type { MCPServerConnection } from '../services/mcp/types.js'
import { readFileSync } from '../utils/fileRead.js'
import { isENOENT } from '../utils/errors.js'

export type IdeDiffEligibility = {
  ideName: string
  ideClient: MCPServerConnection
  filePath: string
  edits: FileEdit[]
}

/** densable P$v — Edit/Write → filePath + edits, else null */
export function buildIdeDiffEditsFromTool(
  tool: Tool,
  input: unknown,
): { filePath: string; edits: FileEdit[] } | null {
  if (tool === FileEditTool) {
    const parsed = FileEditTool.inputSchema.safeParse(input)
    if (!parsed.success) return null
    const r = parsed.data
    return {
      filePath: r.file_path,
      edits: [
        {
          old_string: r.old_string,
          new_string: r.new_string,
          replace_all: r.replace_all || false,
        },
      ],
    }
  }
  if (tool === FileWriteTool) {
    const parsed = FileWriteTool.inputSchema.safeParse(input)
    if (!parsed.success) return null
    const r = parsed.data
    const expanded = expandPath(r.file_path)
    let oldContent = ''
    if (!isFilePermissionNetworkPath(r.file_path)) {
      try {
        oldContent = readFileSync(expanded)
      } catch (e) {
        if (!isENOENT(e)) throw e
      }
    }
    return {
      filePath: r.file_path,
      edits: [
        {
          old_string: oldContent,
          new_string: r.content,
          replace_all: false,
        },
      ],
    }
  }
  return null
}

/** densable D$v — apply IDE-modified edits back onto tool input */
export function applyIdeEditsToToolInput(
  tool: Tool,
  input: Record<string, unknown>,
  edits: FileEdit[],
): Record<string, unknown> {
  const first = edits[0]
  if (!first) return input
  if (tool === FileEditTool) {
    return {
      ...input,
      old_string: first.old_string,
      new_string: first.new_string,
      replace_all: first.replace_all || false,
    }
  }
  if (tool === FileWriteTool) {
    return { ...input, content: first.new_string }
  }
  return input
}

/**
 * densable odm / Drf(tool, input, ctx).
 * null → no IDE diff racer / no showingDiffInIDE stamp.
 */
export function getIdeDiffEligibility(
  tool: Tool,
  input: unknown,
  toolUseContext: ToolUseContext,
): IdeDiffEligibility | null {
  if (tool !== FileEditTool && tool !== FileWriteTool) return null
  const clients = toolUseContext.options?.mcpClients ?? []
  if (!hasAccessToIDEExtensionDiffFeature(clients)) return null
  if (getGlobalConfig().diffTool !== 'auto') return null

  let editsInfo: { filePath: string; edits: FileEdit[] }
  try {
    const built = buildIdeDiffEditsFromTool(tool, input)
    if (!built) return null
    editsInfo = built
  } catch {
    return null
  }

  const { filePath, edits } = editsInfo
  const expanded = expandPath(filePath)
  if (
    isFilePermissionNetworkPath(filePath) ||
    isFilePermissionNetworkPath(expanded)
  ) {
    return null
  }
  if (filePath.endsWith('.ipynb')) return null

  const ideClient = getConnectedIdeClient(clients)
  if (!ideClient || ideClient.type !== 'connected') return null

  return {
    ideName: getConnectedIdeName(clients) ?? 'IDE',
    ideClient,
    filePath,
    edits,
  }
}
