import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { isCompactLinePrefixEnabled } from 'src/utils/file.js'
import { shouldUseSimpleSystemPrompt } from 'src/utils/simpleSystemPrompt.js'
import { FILE_READ_TOOL_NAME } from '../FileReadTool/prompt.js'

function getPreReadInstruction(): string {
  return `\n- You must use your \`${FILE_READ_TOOL_NAME}\` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.`
}

/**
 * densable yRt / tengu_tab_read_sep — when true, Read line prefixes may use
 * either a tab or `:` as the separator after the line number (prompt text only).
 */
function isTabReadSepEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_tab_read_sep', false)
}

function linePrefixDescription(): string {
  if (!isCompactLinePrefixEnabled()) {
    return 'spaces + line number + arrow'
  }
  // densable jCg: tab_read_sep widens separator language for compact prefixes.
  return isTabReadSepEnabled()
    ? 'line number + a single separator character (a tab or `:`)'
    : 'line number + tab'
}

function leanLinePrefixStripHint(): string {
  return isTabReadSepEnabled()
    ? 'line number + a single tab or `:`'
    : 'line number + tab'
}

/**
 * densable jCg / Eyu — model-aware Edit tool description.
 * Lean simple-prompt path (vT) gets a shorter body; dense path keeps Usage: form.
 * Optional tengu_edit_minimalanchor_jrn tightens uniqueness guidance.
 */
export function getEditToolDescription(model?: string): string {
  const lean = shouldUseSimpleSystemPrompt({ model })
  if (lean) {
    return `Performs exact string replacement in a file.

- You must ${FILE_READ_TOOL_NAME} the file in this conversation before editing, or the call will fail.
- \`old_string\` must match the file exactly, including indentation, and be unique — the edit fails otherwise. Strip the Read line prefix (${leanLinePrefixStripHint()}) before matching.
- \`replace_all: true\` replaces every occurrence instead.`
  }
  return getDefaultEditDescription()
}

function getDefaultEditDescription(): string {
  const prefixFormat = linePrefixDescription()
  // densable n=et("tengu_edit_minimalanchor_jrn") uniqueness guidance branch.
  const failIfNotUnique =
    '\n- The edit will FAIL if `old_string` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use `replace_all` to change every instance of `old_string`.'
  const minimalUniquenessHint = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_edit_minimalanchor_jrn',
    false,
  )
    ? `\n- Keep \`old_string\` minimal — usually 1-3 lines, only enough to be unique in the file. Including excess context wastes tokens and is an error.\n- The edit will FAIL if \`old_string\` is not unique in the file. In that case, add the minimum extra context needed for uniqueness, or use \`replace_all\` to change every instance.`
    : process.env.USER_TYPE === 'ant'
      ? `\n- Use the smallest old_string that's clearly unique — usually 2-4 adjacent lines is sufficient. Avoid including 10+ lines of context when less uniquely identifies the target.${failIfNotUnique}`
      : failIfNotUnique

  return `Performs exact string replacements in files.

Usage:${getPreReadInstruction()}
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: ${prefixFormat}. Everything after that is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.${minimalUniquenessHint}
- Use \`replace_all\` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.
- The file_path must be a file path, not a directory path. If the path resolves to an existing directory, the tool will reject it. Use a path that points to an existing file.`
}
