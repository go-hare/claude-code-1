import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { shouldUseSimpleSystemPrompt } from 'src/utils/simpleSystemPrompt.js'
import { FILE_READ_TOOL_NAME } from '../FileReadTool/prompt.js'

function isTabReadSepEnabled(): boolean {
  try {
    return getFeatureValue_CACHED_MAY_BE_STALE('tengu_tab_read_sep', false)
  } catch {
    return false
  }
}

function getPreReadInstruction(): string {
  return `\n- You must use your \`${FILE_READ_TOOL_NAME}\` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.`
}

export function getEditToolDescription(
  model?: string,
  leanPrompt?: boolean,
): string {
  return getDefaultEditDescription(model, leanPrompt)
}

function getDefaultEditDescription(
  model?: string,
  leanPrompt?: boolean,
): string {
  const tabSep = isTabReadSepEnabled()
  const isLean = leanPrompt ?? shouldUseSimpleSystemPrompt({ model })
  if (isLean) {
    return `Performs exact string replacement in a file.

- You must ${FILE_READ_TOOL_NAME} the file in this conversation before editing, or the call will fail.
- \`old_string\` must match the file exactly, including indentation, and be unique — the edit fails otherwise. Strip the Read line prefix (${tabSep ? 'line number + a single tab or `:`' : 'line number + tab'}) before matching.
- \`replace_all: true\` replaces every occurrence instead.`
  }
  const prefixFormat = tabSep
    ? 'line number + a single separator character (a tab or `:`)'
    : 'line number + tab'
  const minimalAnchor = (() => {
    try {
      return getFeatureValue_CACHED_MAY_BE_STALE(
        'tengu_edit_minimalanchor_jrn',
        false,
      )
    } catch {
      return false
    }
  })()
  const uniquenessBullet = minimalAnchor
    ? '\n- Keep `old_string` minimal — usually 1-3 lines, only enough to be unique in the file. Including excess context wastes tokens and is an error.\n- The edit will FAIL if `old_string` is not unique in the file. In that case, add the minimum extra context needed for uniqueness, or use `replace_all` to change every instance.'
    : '\n- The edit will FAIL if `old_string` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use `replace_all` to change every instance of `old_string`.'
  return `Performs exact string replacements in files.

Usage:${getPreReadInstruction()}
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: ${prefixFormat}. Everything after that is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.${uniquenessBullet}
- Use \`replace_all\` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.`
}
