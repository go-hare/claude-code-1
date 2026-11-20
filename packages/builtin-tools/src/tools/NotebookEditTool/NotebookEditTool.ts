import { feature } from 'bun:bundle'
import { readFileSync } from 'fs'
import { extname, isAbsolute, resolve } from 'path'
import {
  detectBufferTextEncoding,
  formatNonTextFileRefusal,
} from '../FileEditTool/FileEditTool.js'
import {
  fileHistoryEnabled,
  fileHistoryTrackEdit,
} from 'src/utils/fileHistory.js'
import { z } from 'zod/v4'
import { buildTool, type ToolDef, type ToolUseContext } from 'src/Tool.js'
import type { NotebookCell, NotebookContent } from 'src/types/notebook.js'
import { getCwd } from 'src/utils/cwd.js'
import { checkBgIsolationWriteBlock } from 'src/utils/bgIsolationContainment.js'
import { isENOENT } from 'src/utils/errors.js'
import { getFileModificationTime, writeTextContent } from 'src/utils/file.js'
import {
  noteApprovedFileToolPath,
  openApprovedWrite,
  takeApprovedFileToolPath,
} from 'src/utils/fileToolApprovedOpen.js'
import { readFileSyncWithMetadata } from 'src/utils/fileRead.js'
import { safeParseJSON } from 'src/utils/json.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { parseCellId } from 'src/utils/notebook.js'
import {
  checkBlockWritesOutsideWorkingDirectories,
  checkWritePermissionForTool,
} from 'src/utils/permissions/filesystem.js'
import type { PermissionDecision } from 'src/utils/permissions/PermissionResult.js'
import { jsonParse, jsonStringify } from 'src/utils/slowOperations.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseRejectedMessage,
} from './UI.js'

export const inputSchema = lazySchema(() =>
  z.strictObject({
    notebook_path: z
      .string()
      .describe(
        'The absolute path to the Jupyter notebook file to edit (must be absolute, not relative)',
      ),
    cell_id: z
      .string()
      .optional()
      .describe(
        'The ID of the cell to edit. When inserting a new cell, the new cell will be inserted after the cell with this ID, or at the beginning if not specified.',
      ),
    new_source: z.string().describe('The new source for the cell'),
    cell_type: z
      .enum(['code', 'markdown'])
      .optional()
      .describe(
        'The type of the cell (code or markdown). If not specified, it defaults to the current cell type. If using edit_mode=insert, this is required.',
      ),
    edit_mode: z
      .enum(['replace', 'insert', 'delete'])
      .optional()
      .describe(
        'The type of edit to make (replace, insert, delete). Defaults to replace.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export const outputSchema = lazySchema(() =>
  z.object({
    new_source: z
      .string()
      .describe('The new source code that was written to the cell'),
    cell_id: z
      .string()
      .optional()
      .describe('The ID of the cell that was edited'),
    cell_type: z.enum(['code', 'markdown']).describe('The type of the cell'),
    language: z.string().describe('The programming language of the notebook'),
    edit_mode: z.string().describe('The edit mode that was used'),
    error: z
      .string()
      .optional()
      .describe('Error message if the operation failed'),
    // Fields for attribution tracking
    notebook_path: z.string().describe('The path to the notebook file'),
    original_file: z
      .string()
      .describe('The original notebook content before modification'),
    updated_file: z
      .string()
      .describe('The updated notebook content after modification'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

/**
 * Official 2.1.321 #1914 (`uT` / ToolExecutionError): thrown on all
 * NotebookEditTool failures so hooks & telemetry accurately see a failed call.
 */
export class NotebookEditExecutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolExecutionError'
  }
}

/**
 * Official 2.1.321 #1854 (`Crn`):
 * Validate and resolve target cell index for `NotebookEdit`.
 * Never defaults to index 0 when `cell_id` is omitted for `delete` or `replace`
 * (preventing network-path calls from deleting/overwriting cell 0).
 */
export function resolveNotebookCellIndex(
  cells: readonly NotebookCell[],
  cell_id: string | undefined,
  edit_mode: 'replace' | 'insert' | 'delete' = 'replace',
): number | { message: string; errorCode: number } {
  const isInsert = edit_mode === 'insert'
  if (!cell_id) {
    return isInsert
      ? 0
      : {
          message: 'Cell ID must be specified when not inserting a new cell.',
          errorCode: 7,
        }
  }
  let idx = cells.findIndex(cell => cell.id === cell_id)
  if (idx === -1) {
    const parsedCellIndex = parseCellId(cell_id)
    if (parsedCellIndex === undefined) {
      return {
        message: `Cell with ID "${cell_id}" not found in notebook.`,
        errorCode: 8,
      }
    }
    if (!cells[parsedCellIndex]) {
      return {
        message: `Cell with index ${parsedCellIndex} does not exist in notebook.`,
        errorCode: 7,
      }
    }
    idx = parsedCellIndex
  }
  return isInsert ? idx + 1 : idx
}

export const NotebookEditTool = buildTool({
  name: NOTEBOOK_EDIT_TOOL_NAME,
  searchHint: 'edit Jupyter notebook cells (.ipynb)',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  userFacingName() {
    return 'Edit Notebook'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Editing notebook ${summary}` : 'Editing notebook'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  toAutoClassifierInput(input) {
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      const mode = input.edit_mode ?? 'replace'
      // Official xXn: when editRemovalVisibility is on, project structured
      // notebook edit (mode/cell/adds) instead of only new_source text.
      const { resolveEditRemovalVisibility } =
        require('src/utils/permissions/autoModeFlags.js') as typeof import('src/utils/permissions/autoModeFlags.js')
      if (!resolveEditRemovalVisibility().value) {
        return `${input.notebook_path} ${mode}: ${input.new_source}`
      }
      return {
        notebook_path: input.notebook_path,
        mode,
        ...(input.cell_id !== undefined ? { cell_id: input.cell_id } : {}),
        ...(mode !== 'delete' && input.cell_type !== undefined
          ? { cell_type: input.cell_type }
          : {}),
        ...(mode === 'delete'
          ? { ignored_source: input.new_source }
          : { adds: input.new_source }),
      }
    }
    return ''
  },
  getPath(input): string {
    return input.notebook_path
  },
  async preparePermissionMatcher({ notebook_path }) {
    // densable hqe: allow-style single-segment dir/** is cwd-only (#44)
    const { matchesPathRule } =
      require('src/utils/permissions/filesystem.js') as typeof import('src/utils/permissions/filesystem.js')
    return (pattern: string) => matchesPathRule(pattern, notebook_path)
  },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    noteApprovedFileToolPath(input.notebook_path, context.toolUseId)
    const appState = context.getAppState()
    return checkWritePermissionForTool(
      NotebookEditTool,
      input,
      appState.toolPermissionContext,
    )
  },
  mapToolResultToToolResultBlockParam(
    { cell_id, edit_mode, new_source, error },
    toolUseID,
  ) {
    if (error) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: error,
        is_error: true,
      }
    }
    switch (edit_mode) {
      case 'replace':
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: `Updated cell ${cell_id} with ${new_source}`,
        }
      case 'insert':
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: `Inserted cell ${cell_id} with ${new_source}`,
        }
      case 'delete':
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: `Deleted cell ${cell_id}`,
        }
      default:
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: 'Unknown edit mode',
        }
    }
  },
  renderToolUseMessage,
  renderToolUseRejectedMessage,
  renderToolUseErrorMessage,
  renderToolResultMessage,
  async validateInput(
    { notebook_path, cell_type, cell_id, edit_mode = 'replace' },
    toolUseContext: ToolUseContext,
  ) {
    const fullPath = isAbsolute(notebook_path)
      ? notebook_path
      : resolve(getCwd(), notebook_path)

    // densable 2.1.217 #5 hsr — bg / worktree isolation containment (errorCode 12)
    const isolationBlock = checkBgIsolationWriteBlock(fullPath, {
      agentId: toolUseContext.agentId,
      agentWorktree: toolUseContext.agentWorktree,
    })
    if (isolationBlock) {
      return { result: false, message: isolationBlock, errorCode: 12 }
    }

    // SECURITY: Skip filesystem operations for UNC paths to prevent NTLM credential leaks.
    if (fullPath.startsWith('\\\\') || fullPath.startsWith('//')) {
      return { result: true }
    }

    if (extname(fullPath) !== '.ipynb') {
      return {
        result: false,
        message:
          'File must be a Jupyter notebook (.ipynb file). For editing other file types, use the FileEdit tool.',
        errorCode: 2,
      }
    }

    if (
      edit_mode !== 'replace' &&
      edit_mode !== 'insert' &&
      edit_mode !== 'delete'
    ) {
      return {
        result: false,
        message: 'Edit mode must be replace, insert, or delete.',
        errorCode: 4,
      }
    }

    if (edit_mode === 'insert' && !cell_type) {
      return {
        result: false,
        message: 'Cell type is required when using edit_mode=insert.',
        errorCode: 5,
      }
    }

    // Require Read-before-Edit (matches FileEditTool/FileWriteTool). Without
    // this, the model could edit a notebook it never saw, or edit against a
    // stale view after an external change — silent data loss.
    const readTimestamp = toolUseContext.readFileState.get(fullPath)
    if (!readTimestamp) {
      return {
        result: false,
        message:
          'File has not been read yet. Read it first before writing to it.',
        errorCode: 9,
      }
    }
    if (getFileModificationTime(fullPath) > readTimestamp.timestamp) {
      return {
        result: false,
        message:
          'File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.',
        errorCode: 10,
      }
    }

    let content: string
    try {
      const rawBytes = readFileSync(fullPath)
      const detected = detectBufferTextEncoding(rawBytes)
      if (detected.notText) {
        return {
          result: false,
          message: formatNonTextFileRefusal(detected.notText),
          errorCode: 15,
        }
      }
      content = readFileSyncWithMetadata(fullPath).content
    } catch (e) {
      if (isENOENT(e)) {
        return {
          result: false,
          message: 'Notebook file does not exist.',
          errorCode: 1,
        }
      }
      throw e
    }
    const notebook = safeParseJSON(content) as NotebookContent | null
    if (!notebook) {
      return {
        result: false,
        message: 'Notebook is not valid JSON.',
        errorCode: 6,
      }
    }
    if (!cell_id) {
      if (edit_mode !== 'insert') {
        return {
          result: false,
          message: 'Cell ID must be specified when not inserting a new cell.',
          errorCode: 7,
        }
      }
    } else {
      // First try to find the cell by its actual ID
      const cellIndex = notebook.cells.findIndex(
        (cell: NotebookCell) => cell.id === cell_id,
      )

      if (cellIndex === -1) {
        // If not found, try to parse as a numeric index (cell-N format)
        const parsedCellIndex = parseCellId(cell_id)
        if (parsedCellIndex !== undefined) {
          if (!notebook.cells[parsedCellIndex]) {
            return {
              result: false,
              message: `Cell with index ${parsedCellIndex} does not exist in notebook.`,
              errorCode: 7,
            }
          }
        } else {
          return {
            result: false,
            message: `Cell with ID "${cell_id}" not found in notebook.`,
            errorCode: 8,
          }
        }
      }
    }

    return { result: true }
  },
  async call(
    {
      notebook_path,
      new_source,
      cell_id,
      cell_type,
      edit_mode: originalEditMode,
    },
    toolUseContext: ToolUseContext,
    _,
    parentMessage,
  ) {
    const { readFileState, updateFileHistoryState } = toolUseContext
    const fullPath = isAbsolute(notebook_path)
      ? notebook_path
      : resolve(getCwd(), notebook_path)
    const outsideWriteBlock = checkBlockWritesOutsideWorkingDirectories(
      fullPath,
      toolUseContext.getAppState().toolPermissionContext,
    )
    if (outsideWriteBlock !== undefined) {
      throw new Error(outsideWriteBlock)
    }
    const approved = takeApprovedFileToolPath(
      fullPath,
      toolUseContext.toolUseId,
      'write',
    )
    const openedWrite = await openApprovedWrite(fullPath, approved, {
      createParents: true,
      leaf: 'replace',
    })

    try {
      if (fileHistoryEnabled()) {
        await fileHistoryTrackEdit(
          updateFileHistoryState,
          fullPath,
          parentMessage.uuid,
        )
      }

      // readFileSyncWithMetadata gives content + encoding + line endings in
      // one safeResolvePath + readFileSync pass, replacing the previous
      // detectFileEncoding + readFile + detectLineEndings chain.
      let rawBytes: Buffer
      try {
        rawBytes = readFileSync(openedWrite.ioPath)
      } catch (readErr) {
        const msg = readErr instanceof Error ? readErr.message : String(readErr)
        if ((readErr as NodeJS.ErrnoException)?.code === 'ENOENT') {
          throw new NotebookEditExecutionError('Notebook file does not exist.')
        }
        throw new NotebookEditExecutionError(msg)
      }
      const detected = detectBufferTextEncoding(rawBytes)
      if (detected.notText) {
        throw new NotebookEditExecutionError(
          formatNonTextFileRefusal(detected.notText),
        )
      }
      const { content, encoding, lineEndings } = readFileSyncWithMetadata(
        openedWrite.ioPath,
      )
      const currentMtime = getFileModificationTime(openedWrite.ioPath)

      // Must use non-memoized jsonParse here: safeParseJSON caches by content
      // string and returns a shared object reference, but we mutate the
      // notebook in place below (cells.splice, targetCell.source = ...).
      let notebook: NotebookContent
      try {
        notebook = jsonParse(content) as NotebookContent
      } catch {
        throw new NotebookEditExecutionError('Notebook is not valid JSON.')
      }
      if (!notebook || !Array.isArray(notebook.cells)) {
        throw new NotebookEditExecutionError(
          'Notebook file is not a valid Jupyter notebook (top-level "cells" must be an array of cell objects, each with a string or string-array "source").',
        )
      }

      // Official 2.1.319 #1744: re-check mtime in call() after any permission
      // prompt so a concurrent edit while the prompt was open cannot target
      // the wrong cell.
      const lastRead = readFileState.get(fullPath)
      if (lastRead !== undefined && currentMtime > lastRead.timestamp) {
        throw new NotebookEditExecutionError(
          'File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.',
        )
      }

      // Official 2.1.321 #1854 (`Crn`): validate cell_id in call() as well as
      // validateInput() so network-path calls never default to cell 0 on
      // delete/replace when cell_id is omitted or invalid.
      const resolvedIndex = resolveNotebookCellIndex(
        notebook.cells,
        cell_id,
        originalEditMode ?? 'replace',
      )
      if (typeof resolvedIndex !== 'number') {
        throw new NotebookEditExecutionError(resolvedIndex.message)
      }
      const cellIndex = resolvedIndex
      const edit_mode = originalEditMode ?? 'replace'

      const language = notebook.metadata?.language_info?.name ?? 'python'
      let new_cell_id: string | undefined
      if (
        (notebook.nbformat ?? 4) > 4 ||
        ((notebook.nbformat ?? 4) === 4 && (notebook.nbformat_minor ?? 0) >= 5)
      ) {
        if (edit_mode === 'insert') {
          new_cell_id = Math.random().toString(36).substring(2, 15)
        } else if (cell_id !== null) {
          new_cell_id = cell_id
        }
      }

      if (edit_mode === 'delete') {
        notebook.cells.splice(cellIndex, 1)
      } else if (edit_mode === 'insert') {
        let new_cell: NotebookCell
        if (cell_type === 'markdown') {
          new_cell = {
            cell_type: 'markdown',
            id: new_cell_id,
            source: new_source,
            metadata: {},
          }
        } else {
          new_cell = {
            cell_type: 'code',
            id: new_cell_id,
            source: new_source,
            metadata: {},
            execution_count: null,
            outputs: [],
          }
        }
        notebook.cells.splice(cellIndex, 0, new_cell)
      } else {
        const targetCell = notebook.cells[cellIndex]
        if (!targetCell) {
          throw new NotebookEditExecutionError(
            `Cell with index ${cellIndex} does not exist in notebook.`,
          )
        }
        targetCell.source = new_source
        if (targetCell.cell_type === 'code') {
          targetCell.execution_count = null
          targetCell.outputs = []
        }
        if (cell_type && cell_type !== targetCell.cell_type) {
          targetCell.cell_type = cell_type
        }
      }
      // Write back to file, preserving the original trailing newline (#416).
      const IPYNB_INDENT = 1
      const updatedContent =
        jsonStringify(notebook, null, IPYNB_INDENT) +
        (content.endsWith('\n') ? '\n' : '')
      await openedWrite.recheckBeforeWrite()
      writeTextContent(
        openedWrite.ioPath,
        updatedContent,
        encoding,
        lineEndings,
      )
      readFileState.set(fullPath, {
        content: updatedContent,
        timestamp: getFileModificationTime(fullPath),
        offset: undefined,
        limit: undefined,
      })
      const data = {
        new_source,
        cell_type: cell_type ?? 'code',
        language,
        edit_mode,
        cell_id: new_cell_id || undefined,
        error: '',
        notebook_path: fullPath,
        original_file: content,
        updated_file: updatedContent,
      }
      return {
        data,
      }
    } catch (error) {
      // Official 2.1.321 #1914: throw ToolExecutionError on all failures rather
      // than returning a success payload with `error` set.
      if (error instanceof NotebookEditExecutionError) {
        throw error
      }
      if (error instanceof Error) {
        const msg =
          openedWrite.ioPath !== fullPath
            ? error.message.split(openedWrite.ioPath).join(fullPath)
            : error.message
        throw new NotebookEditExecutionError(msg)
      }
      throw new NotebookEditExecutionError(
        'Unknown error occurred while editing notebook',
      )
    } finally {
      await openedWrite.close()
    }
  },
} satisfies ToolDef<InputSchema, Output>)
