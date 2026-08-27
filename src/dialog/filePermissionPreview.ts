/**
 * densable X_w + Lno — file permission preview descriptor (async).
 * Reuses tip withhold helpers; no invent of remote fetch beyond remoteOldContent arg.
 */
import { basename, relative } from 'path'
import { FileEditTool } from '@claude-code/builtin-tools/tools/FileEditTool/FileEditTool.js'
import { FileReadTool } from '@claude-code/builtin-tools/tools/FileReadTool/FileReadTool.js'
import { FileWriteTool } from '@claude-code/builtin-tools/tools/FileWriteTool/FileWriteTool.js'
import { GlobTool } from '@claude-code/builtin-tools/tools/GlobTool/GlobTool.js'
import { GrepTool } from '@claude-code/builtin-tools/tools/GrepTool/GrepTool.js'
import { NotebookEditTool } from '@claude-code/builtin-tools/tools/NotebookEditTool/NotebookEditTool.js'
import type { ToolUseConfirm } from '../components/permissions/PermissionRequest.js'
import {
  evaluateEditContentWithhold,
  evaluateWriteContentWithhold,
  isFilePermissionNetworkPath,
  PROPOSED_CONTENT_TOO_LARGE_MESSAGE,
  PROPOSED_EDIT_TOO_LARGE_MESSAGE,
} from '../components/permissions/FilePermissionDialog/filePermissionPreviewWithhold.js'
import {
  buildNotebookPermissionPreview,
  type NotebookPermissionPreviewInput,
} from '../components/permissions/NotebookEditPermissionRequest/notebookPermissionPreview.js'
import { getCwd } from '../utils/cwd.js'
import { isENOENT } from '../utils/errors.js'
import { readFileSync } from '../utils/fileRead.js'
import { getFsImplementation, safeResolvePath } from '../utils/fsOperations.js'
import {
  buildPermissionDescriptorBase,
  type PermissionDescriptorBase,
} from './permissionDescriptor.js'

export type FilePermissionContent =
  | { kind: 'no-changes'; message: string }
  | {
      kind: 'file-edit-diff'
      filePath: string
      edits: Array<{
        old_string: string
        new_string: string
        replace_all: boolean
      }>
      remoteOldContent?: string
      skipLocalRead?: boolean
    }
  | {
      kind: 'file-write-diff'
      filePath: string
      content: string
      fileExists: boolean
      oldContent: string
    }
  | {
      kind: 'notebook-edit-diff'
      notebookPath: string
      cellId?: string
      newSource?: string
      cellType?: string
      editMode?: string
      remoteOldContent?: string | null
      skipLocalRead?: boolean
      oldCellSource?: string
    }
  | { kind: 'tool-use-line' }

export type FilePermissionQuestion =
  | { kind: 'plain'; text: string }
  | { kind: 'file-action'; verbPhrase: string; fileName: string }

export type FilePermissionPreview = {
  title: string
  subtitle?: string
  question: FilePermissionQuestion
  content: FilePermissionContent
  contentWithheld: boolean
}

/** densable Mno — file-family tools */
export function isFilePermissionTool(tool: ToolUseConfirm['tool']): boolean {
  return (
    tool === FileEditTool ||
    tool === FileWriteTool ||
    tool === FileReadTool ||
    tool === NotebookEditTool ||
    tool === GlobTool ||
    tool === GrepTool
  )
}

/** densable Ono */
export function tryGetToolPath(
  tool: ToolUseConfirm['tool'],
  input: unknown,
): string | null {
  try {
    const getPath = (tool as { getPath?: (i: unknown) => string }).getPath
    if (typeof getPath !== 'function') return null
    const path = getPath(input)
    return typeof path === 'string' && path !== '' ? path : null
  } catch {
    return null
  }
}

/** densable RSl */
function formatSubtitle(filePath: string, remoteWorkspace: boolean): string {
  return remoteWorkspace ? filePath : relative(getCwd(), filePath) || filePath
}

/** densable TBi */
function formatFileName(filePath: string, remoteWorkspace: boolean): string {
  return remoteWorkspace ? basename(filePath) : basename(filePath)
}

/** densable Ium — symlink target for write ops only */
function resolveSymlinkTarget(
  filePath: string,
  operationType: 'read' | 'write',
  remoteWorkspace: boolean,
): string | null {
  if (operationType === 'read' || remoteWorkspace) return null
  try {
    const fs = getFsImplementation()
    const { resolvedPath, isSymlink } = safeResolvePath(fs, filePath)
    return isSymlink ? resolvedPath : null
  } catch {
    return null
  }
}

/** densable X_w */
export async function buildFilePermissionPreview(input: {
  tool: ToolUseConfirm['tool']
  input: unknown
  remoteWorkspace?: boolean
  remoteOldContent?: string | null
}): Promise<FilePermissionPreview> {
  const { tool, remoteWorkspace = false, remoteOldContent } = input
  const toolInput = input.input

  if (tool === FileEditTool) {
    const a = toolInput as {
      file_path: string
      old_string: string
      new_string: string
      replace_all?: boolean
    }
    const withhold = evaluateEditContentWithhold(a.old_string, a.new_string)
    return {
      title: 'Edit file',
      subtitle: formatSubtitle(a.file_path, remoteWorkspace),
      question: {
        kind: 'file-action',
        verbPhrase: 'make this edit to',
        fileName: formatFileName(a.file_path, remoteWorkspace),
      },
      content: withhold.contentWithheld
        ? { kind: 'no-changes', message: PROPOSED_EDIT_TOO_LARGE_MESSAGE }
        : {
            kind: 'file-edit-diff',
            filePath: a.file_path,
            edits: [
              {
                old_string: a.old_string,
                new_string: a.new_string,
                replace_all: a.replace_all || false,
              },
            ],
            remoteOldContent: remoteOldContent ?? undefined,
            skipLocalRead: remoteWorkspace,
          },
      contentWithheld: withhold.contentWithheld,
    }
  }

  if (tool === FileWriteTool) {
    const a = toolInput as { file_path: string; content: string }
    let oldContent = ''
    let fileExists = false
    let unreadableLarge = false
    let title: string
    let verb: string

    if (remoteWorkspace) {
      if (typeof remoteOldContent === 'string') {
        oldContent = remoteOldContent
        fileExists = true
        title = 'Overwrite file'
        verb = 'overwrite'
      } else if (remoteOldContent === null) {
        title = 'Create file'
        verb = 'create'
      } else {
        title = 'Write file'
        verb = 'write to'
        unreadableLarge = true
      }
    } else if (isFilePermissionNetworkPath(a.file_path)) {
      unreadableLarge = true
      title = 'Write file'
      verb = 'write to'
    } else {
      try {
        oldContent = readFileSync(a.file_path)
        fileExists = true
      } catch (e) {
        if (!isENOENT(e)) {
          // densable aDt → treat as exists-but-too-large
          fileExists = true
          unreadableLarge = true
        }
      }
      if (unreadableLarge) {
        title = 'Write file'
        verb = 'write to'
      } else {
        title = fileExists ? 'Overwrite file' : 'Create file'
        verb = fileExists ? 'overwrite' : 'create'
      }
    }

    const withhold = evaluateWriteContentWithhold({
      content: a.content,
      filePath: a.file_path,
      fileExists,
      oldContent,
    })
    const contentWithheld = withhold.contentWithheld || unreadableLarge
    let content: FilePermissionContent
    if (
      withhold.contentWithheld &&
      withhold.message === PROPOSED_CONTENT_TOO_LARGE_MESSAGE
    ) {
      content = {
        kind: 'no-changes',
        message: PROPOSED_CONTENT_TOO_LARGE_MESSAGE,
      }
    } else if (contentWithheld) {
      content = {
        kind: 'no-changes',
        message:
          withhold.message ??
          (fileExists
            ? `Existing file is too large to preview — approving will overwrite ${basename(a.file_path)}.`
            : remoteWorkspace
              ? `The remote file could not be checked — approving will write to ${basename(a.file_path)}.`
              : `File is on a network path that cannot be previewed — approving will write to ${basename(a.file_path)}.`),
      }
    } else {
      content = {
        kind: 'file-write-diff',
        filePath: a.file_path,
        content: a.content,
        fileExists,
        oldContent,
      }
    }

    return {
      title,
      subtitle: formatSubtitle(a.file_path, remoteWorkspace),
      question: {
        kind: 'file-action',
        verbPhrase: verb,
        fileName: formatFileName(a.file_path, remoteWorkspace),
      },
      content,
      contentWithheld,
    }
  }

  if (tool === NotebookEditTool) {
    const a = toolInput as NotebookPermissionPreviewInput
    const preview = await buildNotebookPermissionPreview({
      ...a,
      remoteWorkspace,
      remoteOldContent,
    })
    const editMode = a.edit_mode
    const verbPhrase =
      editMode === 'insert'
        ? 'insert this cell into'
        : editMode === 'delete'
          ? 'delete this cell from'
          : 'make this edit to'
    if (preview.kind === 'no-changes') {
      return {
        title: 'Edit notebook',
        subtitle: undefined,
        question: {
          kind: 'file-action',
          verbPhrase,
          fileName: formatFileName(a.notebook_path, remoteWorkspace),
        },
        content: { kind: 'no-changes', message: preview.message },
        contentWithheld: true,
      }
    }
    return {
      title: 'Edit notebook',
      subtitle: undefined,
      question: {
        kind: 'file-action',
        verbPhrase,
        fileName: formatFileName(a.notebook_path, remoteWorkspace),
      },
      content: {
        kind: 'notebook-edit-diff',
        notebookPath: a.notebook_path,
        cellId: a.cell_id,
        newSource: a.new_source,
        cellType: a.cell_type,
        editMode: a.edit_mode,
        remoteOldContent: remoteOldContent ?? undefined,
        skipLocalRead: remoteWorkspace,
        oldCellSource: preview.oldCellSource,
      },
      contentWithheld: false,
    }
  }

  // Glob/Grep/Read fallback — densable default arm
  let operationRead = false
  try {
    operationRead = tool.isReadOnly(toolInput as never) === true
  } catch {
    operationRead = false
  }
  return {
    title: `${operationRead ? 'Read' : 'Edit'} file`,
    subtitle: undefined,
    question: { kind: 'plain', text: 'Do you want to proceed?' },
    content: { kind: 'tool-use-line' },
    contentWithheld: false,
  }
}

/** densable Lno */
export async function buildFilePermissionDescriptor(input: {
  confirm: ToolUseConfirm
  filePath: string
  remoteWorkspace?: boolean
  remoteOldContent?: string | null
  theme?: string
}): Promise<
  PermissionDescriptorBase & {
    title: string
    subtitle?: string
    question: FilePermissionQuestion
    content: FilePermissionContent
    contentWithheld: boolean
    filePath: string
    operationType: 'read' | 'write'
    symlinkTarget: string | null
  }
> {
  const { confirm, filePath, remoteWorkspace = false, remoteOldContent } = input
  if (!isFilePermissionTool(confirm.tool)) {
    throw new Error(
      `buildFilePermissionDescriptor called with non-file tool: ${confirm.tool.name}`,
    )
  }
  const base = buildPermissionDescriptorBase({
    confirm,
    theme: input.theme,
  })
  let operationType: 'read' | 'write' = 'write'
  try {
    if (confirm.tool.isReadOnly(confirm.input as never)) {
      operationType = 'read'
    }
  } catch {
    operationType = 'write'
  }
  const preview = await buildFilePermissionPreview({
    tool: confirm.tool,
    input: confirm.input,
    remoteWorkspace,
    remoteOldContent,
  })
  const symlinkTarget = resolveSymlinkTarget(
    filePath,
    operationType,
    remoteWorkspace,
  )
  return {
    ...base,
    ...preview,
    filePath,
    operationType,
    symlinkTarget,
  }
}
