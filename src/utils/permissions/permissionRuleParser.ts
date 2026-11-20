import { feature } from 'bun:bundle'
import { AGENT_TOOL_NAME } from '@claude-code/builtin-tools/tools/AgentTool/constants.js'
import { TASK_OUTPUT_TOOL_NAME } from '@claude-code/builtin-tools/tools/TaskOutputTool/constants.js'
import { TASK_STOP_TOOL_NAME } from '@claude-code/builtin-tools/tools/TaskStopTool/prompt.js'
import type { PermissionRuleValue } from './PermissionRule.js'

// Dead code elimination: ant-only tool names are conditionally required so
// their strings don't leak into external builds. Static imports always bundle.
/* eslint-disable @typescript-eslint/no-require-imports */
const BRIEF_TOOL_NAME: string | null =
  feature('KAIROS') || feature('KAIROS_BRIEF')
    ? (
        require('@claude-code/builtin-tools/tools/BriefTool/prompt.js') as typeof import('@claude-code/builtin-tools/tools/BriefTool/prompt.js')
      ).BRIEF_TOOL_NAME
    : null
/* eslint-enable @typescript-eslint/no-require-imports */

// Maps legacy tool names to their current canonical names.
// When a tool is renamed, add old → new here so permission rules,
// hooks, and persisted wire names resolve to the canonical name.
// densable 2.1.224 #7: ListPeers → ListAgents (SEA compat table).
const LEGACY_TOOL_NAME_ALIASES: Record<string, string> = {
  Task: AGENT_TOOL_NAME,
  KillShell: TASK_STOP_TOOL_NAME,
  AgentOutputTool: TASK_OUTPUT_TOOL_NAME,
  BashOutputTool: TASK_OUTPUT_TOOL_NAME,
  ListPeers: 'ListAgents',
  ...((feature('KAIROS') || feature('KAIROS_BRIEF')) && BRIEF_TOOL_NAME
    ? { Brief: BRIEF_TOOL_NAME }
    : {}),
}

export function normalizeLegacyToolName(name: string): string {
  return LEGACY_TOOL_NAME_ALIASES[name] ?? name
}

export function getLegacyToolNames(canonicalName: string): string[] {
  const result: string[] = []
  for (const [legacy, canonical] of Object.entries(LEGACY_TOOL_NAME_ALIASES)) {
    if (canonical === canonicalName) result.push(legacy)
  }
  return result
}

/**
 * Escapes special characters in rule content for safe storage in permission rules.
 * Permission rules use the format "Tool(content)", so parentheses in content must be escaped.
 *
 * Escaping order matters:
 * 1. Escape existing backslashes first (\ -> \\)
 * 2. Then escape parentheses (( -> \(, ) -> \))
 *
 * @example
 * escapeRuleContent('psycopg2.connect()') // => 'psycopg2.connect\\(\\)'
 * escapeRuleContent('echo "test\\nvalue"') // => 'echo "test\\\\nvalue"'
 */
export function escapeRuleContent(content: string): string {
  return content
    .replace(/\\/g, '\\\\') // Escape backslashes first
    .replace(/\(/g, '\\(') // Escape opening parentheses
    .replace(/\)/g, '\\)') // Escape closing parentheses
}

/**
 * Unescapes special characters in rule content after parsing from permission rules.
 * This reverses the escaping done by escapeRuleContent.
 *
 * Unescaping order matters (reverse of escaping):
 * 1. Unescape parentheses first (\( -> (, \) -> ))
 * 2. Then unescape backslashes (\\ -> \)
 *
 * @example
 * unescapeRuleContent('psycopg2.connect\\(\\)') // => 'psycopg2.connect()'
 * unescapeRuleContent('echo "test\\\\nvalue"') // => 'echo "test\\nvalue"'
 */
export function unescapeRuleContent(content: string): string {
  return content
    .replace(/\\\(/g, '(') // Unescape opening parentheses
    .replace(/\\\)/g, ')') // Unescape closing parentheses
    .replace(/\\\\/g, '\\') // Unescape backslashes last
}

/**
 * Parses a permission rule string into its components.
 * Handles escaped parentheses in the content portion.
 *
 * Format: "ToolName" or "ToolName(content)"
 * Content may contain escaped parentheses: \( and \)
 *
 * @example
 * permissionRuleValueFromString('Bash') // => { toolName: 'Bash' }
 * permissionRuleValueFromString('Bash(npm install)') // => { toolName: 'Bash', ruleContent: 'npm install' }
 * permissionRuleValueFromString('Bash(python -c "print\\(1\\)")') // => { toolName: 'Bash', ruleContent: 'python -c "print(1)"' }
 */
export function permissionRuleValueFromString(
  ruleString: string,
): PermissionRuleValue {
  // Find the first unescaped opening parenthesis
  const openParenIndex = findFirstUnescapedChar(ruleString, '(')
  if (openParenIndex === -1) {
    // No parenthesis found - this is just a tool name
    return { toolName: normalizeLegacyToolName(ruleString) }
  }

  // Find the last unescaped closing parenthesis
  const closeParenIndex = findLastUnescapedChar(ruleString, ')')
  if (closeParenIndex === -1 || closeParenIndex <= openParenIndex) {
    // No matching closing paren or malformed - treat as tool name
    return { toolName: normalizeLegacyToolName(ruleString) }
  }

  // Ensure the closing paren is at the end
  if (closeParenIndex !== ruleString.length - 1) {
    // Content after closing paren - treat as tool name
    return { toolName: normalizeLegacyToolName(ruleString) }
  }

  const toolName = ruleString.substring(0, openParenIndex)
  const rawContent = ruleString.substring(openParenIndex + 1, closeParenIndex)

  // Missing toolName (e.g., "(foo)") is malformed - treat whole string as tool name
  if (!toolName) {
    return { toolName: normalizeLegacyToolName(ruleString) }
  }

  // Empty content (e.g., "Bash()") or standalone wildcard (e.g., "Bash(*)")
  // should be treated as just the tool name (tool-wide rule)
  if (rawContent === '' || rawContent === '*') {
    return { toolName: normalizeLegacyToolName(toolName) }
  }

  // Unescape the content
  const ruleContent = unescapeRuleContent(rawContent)
  return { toolName: normalizeLegacyToolName(toolName), ruleContent }
}

/**
 * Converts a permission rule value to its string representation.
 * Escapes parentheses in the content to prevent parsing issues.
 *
 * @example
 * permissionRuleValueToString({ toolName: 'Bash' }) // => 'Bash'
 * permissionRuleValueToString({ toolName: 'Bash', ruleContent: 'npm install' }) // => 'Bash(npm install)'
 * permissionRuleValueToString({ toolName: 'Bash', ruleContent: 'python -c "print(1)"' }) // => 'Bash(python -c "print\\(1\\)")'
 */
export function permissionRuleValueToString(
  ruleValue: PermissionRuleValue,
): string {
  if (!ruleValue.ruleContent) {
    return ruleValue.toolName
  }
  const escapedContent = escapeRuleContent(ruleValue.ruleContent)
  return `${ruleValue.toolName}(${escapedContent})`
}

/**
 * Find the index of the first unescaped occurrence of a character.
 * A character is escaped if preceded by an odd number of backslashes.
 */
function findFirstUnescapedChar(str: string, char: string): number {
  for (let i = 0; i < str.length; i++) {
    if (str[i] === char) {
      // Count preceding backslashes
      let backslashCount = 0
      let j = i - 1
      while (j >= 0 && str[j] === '\\') {
        backslashCount++
        j--
      }
      // If even number of backslashes, the char is unescaped
      if (backslashCount % 2 === 0) {
        return i
      }
    }
  }
  return -1
}

/**
 * Find the index of the last unescaped occurrence of a character.
 * A character is escaped if preceded by an odd number of backslashes.
 */
function findLastUnescapedChar(str: string, char: string): number {
  for (let i = str.length - 1; i >= 0; i--) {
    if (str[i] === char) {
      // Count preceding backslashes
      let backslashCount = 0
      let j = i - 1
      while (j >= 0 && str[j] === '\\') {
        backslashCount++
        j--
      }
      // If even number of backslashes, the char is unescaped
      if (backslashCount % 2 === 0) {
        return i
      }
    }
  }
  return -1
}

/**
 * Official 2.1.327 (#384, SEA `TM`): classify a permission rule string into
 * bare tool name, valid `Tool(content)` call, or malformed.
 */
export function parsePermissionRuleShape(
  ruleString: string,
):
  | { kind: 'bare' }
  | { kind: 'malformed' }
  | { kind: 'call'; toolName: string; rawContent: string } {
  if (!ruleString.includes('(') && !ruleString.includes(')')) {
    return { kind: 'bare' }
  }
  const openIdx = findFirstUnescapedChar(ruleString, '(')
  const closeIdx = findLastUnescapedChar(ruleString, ')')
  if (openIdx === -1 && closeIdx === -1) {
    return { kind: 'bare' }
  }
  const toolName = ruleString.substring(0, openIdx)
  if (
    openIdx === -1 ||
    closeIdx <= openIdx ||
    closeIdx !== ruleString.length - 1 ||
    /[()]/.test(toolName)
  ) {
    return { kind: 'malformed' }
  }
  return {
    kind: 'call',
    toolName,
    rawContent: ruleString.substring(openIdx + 1, closeIdx),
  }
}

/**
 * Official 2.1.327 (#384, SEA `m`): split a CLI tool-rule string on commas and
 * spaces only at parenthesis depth 0 (honoring backslash escapes), so rules
 * whose content contains nested parentheses like `Bash(foo(bar) baz)` stay
 * intact instead of splitting at the inner `)`.
 */
export function splitToolListBalanced(str: string): string[] {
  const result: string[] = []
  let start = 0
  let depth = 0
  let sawUnmatchedClose = false
  for (let i = 0; i <= str.length; i++) {
    const ch = str[i]
    if (ch === '\\') {
      i++
    } else if (ch === '(') {
      depth++
    } else if (ch === ')') {
      if (depth === 0) sawUnmatchedClose = true
      depth = Math.max(depth - 1, 0)
    } else if (
      i === str.length ||
      (depth === 0 && (ch === ',' || ch === ' '))
    ) {
      if (depth === 0 && !sawUnmatchedClose) {
        const piece = str.slice(start, i).trim()
        if (piece) result.push(piece)
      }
      start = i + 1
      sawUnmatchedClose = false
    }
  }
  return result
}

/**
 * Official 2.1.327 (#384, SEA `mf`): legacy flat-paren splitter.
 */
function splitToolListLegacy(tools: readonly string[]): string[] {
  if (tools.length === 0) return []
  const result: string[] = []
  for (const toolString of tools) {
    if (!toolString) continue
    let current = ''
    let inParens = false
    for (const ch of toolString) {
      switch (ch) {
        case '(':
          inParens = true
          current += ch
          break
        case ')':
          inParens = false
          current += ch
          break
        case ',':
          if (inParens) {
            current += ch
          } else {
            if (current.trim()) result.push(current.trim())
            current = ''
          }
          break
        case ' ':
          if (inParens) {
            current += ch
          } else if (current.trim()) {
            result.push(current.trim())
            current = ''
          }
          break
        default:
          if (current || ch.trim()) current += ch
      }
    }
    if (current.trim()) result.push(current.trim())
  }
  return result
}

/**
 * Official 2.1.327 (#384, SEA `hbr`): recover `--disallowedTools` rules whose
 * content contains parentheses followed by a space or comma (e.g.
 * `Bash(foo(bar) baz)`) that the flat-paren splitter broke apart.
 */
export function extractParenthesizedDisallowedRules(
  tools: readonly string[],
): string[] {
  const legacySet = new Set(splitToolListLegacy(tools))
  const recovered = tools
    .flatMap(entry => (entry ? splitToolListBalanced(entry) : []))
    .filter(rule => {
      const shape = parsePermissionRuleShape(rule)
      if (
        shape.kind !== 'call' ||
        shape.toolName === '' ||
        !/\)[ ,]/.test(shape.rawContent) ||
        /^[\s\uFEFF./~\\]*!/.test(shape.rawContent)
      ) {
        return false
      }
      const firstLegacy = splitToolListLegacy([rule])[0]
      return (
        firstLegacy !== undefined &&
        legacySet.has(firstLegacy) &&
        parsePermissionRuleShape(firstLegacy).kind === 'call'
      )
    })
  return Array.from(new Set(recovered))
}

/**
 * Official 2.1.327 (#384, SEA `gbr`): parse `--disallowedTools` preserving both
 * legacy tokens and balanced rules containing nested parentheses in their content.
 */
export function parseDisallowedToolListFromCLI(
  tools: readonly string[],
): string[] {
  return [
    ...splitToolListLegacy(tools),
    ...extractParenthesizedDisallowedRules(tools),
  ]
}
