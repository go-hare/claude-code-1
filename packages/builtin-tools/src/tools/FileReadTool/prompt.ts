import { isPDFSupported } from 'src/utils/pdfUtils.js'
import { shouldUseSimpleSystemPrompt } from 'src/utils/simpleSystemPrompt.js'
import { FILE_READ_TOOL_NAME } from './constants.js'

export { FILE_READ_TOOL_NAME }

export const FILE_UNCHANGED_STUB =
  'File unchanged since last read. The content from the earlier Read tool_result in this conversation is still current — refer to that instead of re-reading.'

export const WASTED_FILE_UNCHANGED_STUB =
  'Wasted call — file unchanged since your last Read. Refer to that earlier tool_result instead.'

export function getFileUnchangedStub(): string {
  return WASTED_FILE_UNCHANGED_STUB
}

export const NO_REREAD_AFTER_EDIT_INSTRUCTION =
  '\n- Do NOT re-read a file you just edited to verify — Edit/Write would have errored if the change failed, and the harness tracks file state for you.'

export const MAX_LINES_TO_READ = 2000

export const DESCRIPTION = 'Read a file from the local filesystem.'

export const LINE_FORMAT_INSTRUCTION =
  '- Results are returned using cat -n format, with line numbers starting at 1'

export const LINE_FORMAT_INSTRUCTION_SEP =
  LINE_FORMAT_INSTRUCTION +
  '. Each line is the line number, a single separator (a tab or `:`), then the verbatim file content (including any leading whitespace).'

export const OFFSET_INSTRUCTION_TARGETED =
  '- When you already know which part of the file you need, only read that part. This can be important for larger files.'

export const OFFSET_INSTRUCTION_DEFAULT = OFFSET_INSTRUCTION_TARGETED

function isPdfSupportedForModel(model?: string): boolean {
  if (model !== undefined) {
    return !model.toLowerCase().includes('claude-3-haiku')
  }
  return isPDFSupported()
}

/**
 * Official `$qo(model, lineFormatInstruction, leanPrompt)`.
 */
export function getReadToolPrompt(
  model?: string,
  lineFormatInstruction: string = LINE_FORMAT_INSTRUCTION,
  leanPrompt?: boolean,
): string {
  const isLean = leanPrompt ?? shouldUseSimpleSystemPrompt({ model })
  const pdfSupported = isPdfSupportedForModel(model)
  if (isLean) {
    return `Reads a file from the local filesystem.

- \`file_path\` must be an absolute path.
- Reads up to ${MAX_LINES_TO_READ} lines by default.
${OFFSET_INSTRUCTION_TARGETED}
${lineFormatInstruction}
- Reads images (PNG, JPG, …) and presents them visually.${
      pdfSupported
        ? ' Reads PDFs via the `pages` parameter (e.g. "1-5", max 20 pages/request; required for PDFs over 10 pages).'
        : ''
    } Reads Jupyter notebooks (.ipynb) as cells with outputs.
- Reading a directory, a missing file, or an empty file returns an error or system reminder rather than content.${NO_REREAD_AFTER_EDIT_INSTRUCTION}`
  }
  return `Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to ${MAX_LINES_TO_READ} lines starting from the beginning of the file
${OFFSET_INSTRUCTION_TARGETED}
${lineFormatInstruction}
- This tool allows Claude Code to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Claude Code is a multimodal LLM.${
    pdfSupported
      ? '\n- This tool can read PDF files (.pdf). For large PDFs (more than 10 pages), you MUST provide the pages parameter to read specific page ranges (e.g., pages: "1-5"). Reading a large PDF without the pages parameter will fail. Maximum 20 pages per request.'
      : ''
  }
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To list files in a directory, use the registered shell tool.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.${NO_REREAD_AFTER_EDIT_INSTRUCTION}`
}

/**
 * Renders the Read tool prompt template. Supports both the official
 * `$qo(model, lineFormatInstruction, leanPrompt)` signature and the
 * legacy `(lineFormat, maxSizeInstruction, offsetInstruction)` signature.
 */
export function renderPromptTemplate(
  lineFormatOrModel?: string,
  maxSizeOrLineFormat: string = '',
  offsetOrLean?: string | boolean,
  leanPrompt?: boolean,
): string {
  if (
    typeof offsetOrLean === 'boolean' ||
    maxSizeOrLineFormat.startsWith('- Results are returned')
  ) {
    return getReadToolPrompt(
      lineFormatOrModel,
      maxSizeOrLineFormat || LINE_FORMAT_INSTRUCTION,
      typeof offsetOrLean === 'boolean' ? offsetOrLean : leanPrompt,
    )
  }
  const lineFormat = lineFormatOrModel ?? LINE_FORMAT_INSTRUCTION
  const maxSizeInstruction = maxSizeOrLineFormat
  const offsetInstruction =
    typeof offsetOrLean === 'string' && offsetOrLean.length > 0
      ? offsetOrLean
      : OFFSET_INSTRUCTION_TARGETED
  if (leanPrompt === true) {
    return getReadToolPrompt(undefined, lineFormat, true)
  }
  return `Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to ${MAX_LINES_TO_READ} lines starting from the beginning of the file${maxSizeInstruction}
${offsetInstruction}
${lineFormat}
- This tool allows Claude Code to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Claude Code is a multimodal LLM.${
    isPDFSupported()
      ? '\n- This tool can read PDF files (.pdf). For large PDFs (more than 10 pages), you MUST provide the pages parameter to read specific page ranges (e.g., pages: "1-5"). Reading a large PDF without the pages parameter will fail. Maximum 20 pages per request.'
      : ''
  }
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To list files in a directory, use the registered shell tool.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.${NO_REREAD_AFTER_EDIT_INSTRUCTION}`
}
