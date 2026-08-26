/**
 * Frontmatter parser for markdown files
 * Extracts and parses YAML frontmatter between --- delimiters
 */

import { logForDebugging } from './debug.js'
import type { HooksSettings } from './settings/types.js'
import { parseYaml } from './yaml.js'

export type FrontmatterData = {
  // YAML can return null for keys with no value (e.g., "key:" with nothing after)
  'allowed-tools'?: string | string[] | null
  'disallowed-tools'?: string | string[] | null
  description?: string | null
  // Memory type: 'user', 'feedback', 'project', or 'reference'
  // Only applicable to memory files; narrowed via parseMemoryType() in src/memdir/memoryTypes.ts
  type?: string | null
  'argument-hint'?: string | null
  when_to_use?: string | null
  version?: string | null
  // Only applicable to slash commands -- a string similar to a boolean env var
  // to determine whether to make them visible to the SlashCommand tool.
  'hide-from-slash-command-tool'?: string | null
  // Model alias or name (e.g., 'haiku', 'sonnet', 'opus', or specific model names)
  // Use 'inherit' for commands to use the parent model
  model?: string | null
  // Comma-separated list of skill names to preload (only applicable to agents)
  skills?: string | null
  // Whether users can invoke this skill by typing /skill-name
  // 'true' = user can type /skill-name to invoke
  // 'false' = only model can invoke via Skill tool
  // Default depends on source: commands/ defaults to true, skills/ defaults to false
  'user-invocable'?: string | null
  // Hooks to register when this skill is invoked
  // Keys are hook events (PreToolUse, PostToolUse, Stop, etc.)
  // Values are arrays of matcher configurations with hooks
  // Validated by HooksSchema in loadSkillsDir.ts
  hooks?: HooksSettings | null
  // Effort level for agents (e.g., 'low', 'medium', 'high', 'xhigh', 'max', or an integer)
  // Controls the thinking effort used by the agent's model
  effort?: string | null
  // Execution context for skills: 'inline' (default) or 'fork' (run as sub-agent)
  // 'inline' = skill content expands into the current conversation
  // 'fork' = skill runs in a sub-agent with separate context and token budget
  context?: 'inline' | 'fork' | null
  // Agent type to use when forked (e.g., 'Bash', 'general-purpose')
  // Only applicable when context is 'fork'
  agent?: string | null
  // Glob patterns for file paths this skill applies to. Accepts either a
  // comma-separated string or a YAML list of strings.
  // When set, the skill is only activated when the model touches matching files
  // Uses the same format as CLAUDE.md paths frontmatter
  paths?: string | string[] | null
  // Shell to use for !`cmd` and ```! blocks in skill/command .md content.
  // 'bash' (default) or 'powershell'. File-scoped — applies to all !-blocks.
  // Never consults settings.defaultShell: skills are portable across platforms,
  // so the author picks the shell, not the reader. See docs/design/ps-shell-selection.md §5.3.
  shell?: string | null
  [key: string]: unknown
}

export type ParsedMarkdown = {
  frontmatter: FrontmatterData
  content: string
}

// Characters that require quoting in YAML values (when unquoted)
// - { } are flow mapping indicators
// - * is anchor/alias indicator
// - [ ] are flow sequence indicators
// - ': ' (colon followed by space) is key indicator — causes 'Nested mappings
//   are not allowed in compact mappings' when it appears mid-value. Match the
//   pattern rather than bare ':' so '12:34' times and 'https://' URLs stay unquoted.
// - # is comment indicator
// - & is anchor indicator
// - ! is tag indicator
// - | > are block scalar indicators (only at start)
// - % is directive indicator (only at start)
// - @ ` are reserved
const YAML_SPECIAL_CHARS = /[{}[\]*&#!|>%@`]|: /

/**
 * Pre-processes frontmatter text to quote values that contain special YAML characters.
 * This allows glob patterns like **\/*.{ts,tsx} to be parsed correctly.
 */
function quoteProblematicValues(frontmatterText: string): string {
  const lines = frontmatterText.split('\n')
  const result: string[] = []

  for (const line of lines) {
    // Match simple key: value lines (not indented, not list items, not block scalars)
    const match = line.match(/^([a-zA-Z_-]+):\s+(.+)$/)
    if (match) {
      const [, key, value] = match
      if (!key || !value) {
        result.push(line)
        continue
      }

      // Skip if already quoted
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        result.push(line)
        continue
      }

      // Quote if contains special YAML characters
      if (YAML_SPECIAL_CHARS.test(value)) {
        // Use double quotes and escape any existing double quotes
        const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        result.push(`${key}: "${escaped}"`)
        continue
      }
    }

    result.push(line)
  }

  return result.join('\n')
}

export const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)---\s*\n?/

/** densable HG — UTF-8 BOM so `^---` still matches agents/skills/commands .md */
export function stripUtf8Bom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * Parses markdown content to extract frontmatter and content
 * @param markdown The raw markdown content
 * @returns Object containing parsed frontmatter and content without frontmatter
 */
export function parseFrontmatter(
  markdown: string,
  sourcePath?: string,
): ParsedMarkdown {
  // densable bf: n=e; e=HG(e); match Dme; no match → content stays n (BOM kept)
  const raw = markdown
  const stripped = stripUtf8Bom(markdown)
  const match = stripped.match(FRONTMATTER_REGEX)

  if (!match) {
    // No frontmatter found
    return {
      frontmatter: {},
      content: raw,
    }
  }

  const frontmatterText = match[1] || ''
  const content = stripped.slice(match[0].length)

  let frontmatter: FrontmatterData = {}
  try {
    const parsed = parseYaml(frontmatterText) as FrontmatterData | null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      frontmatter = parsed
    }
  } catch {
    // YAML parsing failed - try again after quoting problematic values
    try {
      const quotedText = quoteProblematicValues(frontmatterText)
      const parsed = parseYaml(quotedText) as FrontmatterData | null
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        frontmatter = parsed
      }
    } catch (retryError) {
      // Still failed - log for debugging so users can diagnose broken frontmatter
      const location = sourcePath ? ` in ${sourcePath}` : ''
      logForDebugging(
        `Failed to parse YAML frontmatter${location}: ${retryError instanceof Error ? retryError.message : retryError}`,
        { level: 'warn' },
      )
    }
  }

  return {
    frontmatter,
    content,
  }
}

/**
 * densable Xug / Jug — brace expansion budget (2.1.217 #13).
 * Over budget → warn + return unexpanded original pattern (Qug).
 */
export const BRACE_EXPANSION_MAX_RESULTS = 1000
export const BRACE_EXPANSION_MAX_BYTES = 4_194_304

type BraceBudget = { results: number; bytes: number }

/**
 * densable yJn / G6c — split comma-separated paths + budgeted brace expand.
 * Commas inside braces are not treated as separators.
 * Also accepts a YAML list (string array) for ergonomic frontmatter.
 * @param input - Comma-separated string, or array of strings, with optional brace patterns
 * @returns Array of expanded strings
 * @example
 * splitPathInFrontmatter("a, b") // returns ["a", "b"]
 * splitPathInFrontmatter("a, src/*.{ts,tsx}") // returns ["a", "src/*.ts", "src/*.tsx"]
 * splitPathInFrontmatter("{a,b}/{c,d}") // returns ["a/c", "a/d", "b/c", "b/d"]
 * splitPathInFrontmatter(["a", "src/*.{ts,tsx}"]) // returns ["a", "src/*.ts", "src/*.tsx"]
 */
export function splitPathInFrontmatter(input: string | string[]): string[] {
  // densable yJn → G6c(e, {results:Xug, bytes:Jug})
  return expandPathFrontmatter(input, {
    results: BRACE_EXPANSION_MAX_RESULTS,
    bytes: BRACE_EXPANSION_MAX_BYTES,
  })
}

function expandPathFrontmatter(
  input: string | string[],
  budget: BraceBudget,
): string[] {
  if (Array.isArray(input)) {
    return input.flatMap(item => expandPathFrontmatter(item, budget))
  }
  if (typeof input !== 'string') {
    return []
  }
  // densable G6c: split by comma while respecting braces
  const parts: string[] = []
  let current = ''
  let braceDepth = 0

  for (let i = 0; i < input.length; i++) {
    const char = input[i]

    if (char === '{') {
      braceDepth++
      current += char
    } else if (char === '}') {
      braceDepth--
      current += char
    } else if (char === ',' && braceDepth === 0) {
      const trimmed = current.trim()
      if (trimmed) {
        parts.push(trimmed)
      }
      current = ''
    } else {
      current += char
    }
  }

  const trimmed = current.trim()
  if (trimmed) {
    parts.push(trimmed)
  }

  return parts
    .filter(p => p.length > 0)
    .flatMap(pattern => expandBracesBudgeted(pattern, budget))
}

/**
 * densable Qug — budget-bounded brace expansion.
 * Over budget: warn + return [original] unexpanded.
 * @example
 * expandBracesBudgeted("src/*.{ts,tsx}", budget) // ["src/*.ts", "src/*.tsx"]
 * expandBracesBudgeted("{a,b}/{c,d}", budget) // ["a/c", "a/d", "b/c", "b/d"]
 */
function expandBracesBudgeted(pattern: string, budget: BraceBudget): string[] {
  if (!pattern.includes('{')) {
    return [pattern]
  }

  const results: string[] = []
  const stack: string[] = [pattern]

  for (let cur = stack.pop(); cur !== undefined; cur = stack.pop()) {
    const braceMatch = cur.match(/^([^{]*)\{([^}]+)\}(.*)$/)
    if (!braceMatch) {
      results.push(cur)
      continue
    }

    const prefix = braceMatch[1] || ''
    const alternatives = braceMatch[2] || ''
    const suffix = braceMatch[3] || ''
    const parts = alternatives.split(',').map(alt => alt.trim())

    // densable: t.bytes -= o.length; u = r.length + n.length + c.length
    budget.bytes -= cur.length
    const projected = results.length + stack.length + parts.length
    if (
      budget.bytes < 0 ||
      projected > budget.results ||
      projected * pattern.length > budget.bytes
    ) {
      const preview =
        pattern.length > 256 ? `${pattern.slice(0, 256)}…` : pattern
      logForDebugging(
        `Brace pattern expansion exceeds the budget; using it unexpanded: ${preview}`,
        { level: 'warn' },
      )
      return [pattern]
    }

    // densable: push alternatives in reverse so pop order is left-to-right
    for (let d = parts.length - 1; d >= 0; d--) {
      stack.push(prefix + (parts[d] ?? '') + suffix)
    }
  }

  // densable: t.results -= r.length; t.bytes -= r.length * e.length
  budget.results -= results.length
  budget.bytes -= results.length * pattern.length
  return results
}

/**
 * Parses a positive integer value from frontmatter.
 * Handles both number and string representations.
 *
 * @param value The raw value from frontmatter (could be number, string, or undefined)
 * @returns The parsed positive integer, or undefined if invalid or not provided
 */
export function parsePositiveIntFromFrontmatter(
  value: unknown,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  const parsed = typeof value === 'number' ? value : parseInt(String(value), 10)

  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed
  }

  return undefined
}

/**
 * Validate and coerce a description value from frontmatter.
 *
 * Strings are returned as-is (trimmed). Primitive values (numbers, booleans)
 * are coerced to strings via String(). Non-scalar values (arrays, objects)
 * are invalid and are logged then omitted. Null, undefined, and
 * empty/whitespace-only strings return null so callers can fall back to
 * a default.
 *
 * @param value - The raw frontmatter description value
 * @param componentName - The skill/command/agent/style name for log messages
 * @param pluginName - The plugin name, if this came from a plugin
 */
export function coerceDescriptionToString(
  value: unknown,
  componentName?: string,
  pluginName?: string,
): string | null {
  if (value == null) {
    return null
  }
  if (typeof value === 'string') {
    return value.trim() || null
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  // Non-scalar descriptions (arrays, objects) are invalid — log and omit
  const source = pluginName
    ? `${pluginName}:${componentName}`
    : (componentName ?? 'unknown')
  logForDebugging(`Description invalid for ${source} - omitting`, {
    level: 'warn',
  })
  return null
}

/**
 * densable 2.1.218 #35 — accepted skill/plugin frontmatter boolean literals.
 * SEA error copy for invalid values: `" is not a boolean (use true/false, 1/0, yes/no, on/off)"`.
 */
export const FRONTMATTER_BOOLEAN_HINT =
  'true/false, 1/0, yes/no, on/off' as const

/** densable plugin/config invalid-boolean message suffix (includes leading quote). */
export function formatFrontmatterBooleanError(raw: string): string {
  return `"${raw}" is not a boolean (use ${FRONTMATTER_BOOLEAN_HINT})`
}

/**
 * Parse a boolean frontmatter value (densable 2.1.218).
 * Accepts true/false, 1/0, yes/no, on/off (case-insensitive strings),
 * alongside boolean literals and numeric 1/0.
 * Unrecognized values return false (callers that need strict validation use
 * `tryParseBooleanFrontmatter` / `formatFrontmatterBooleanError`).
 */
export function parseBooleanFrontmatter(value: unknown): boolean {
  return tryParseBooleanFrontmatter(value) ?? false
}

/**
 * Strict parse: recognized densable literals → boolean; else undefined.
 */
export function tryParseBooleanFrontmatter(
  value: unknown,
): boolean | undefined {
  if (value === true || value === 1) return true
  if (value === false || value === 0) return false
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase()
    if (v === 'true' || v === 'yes' || v === 'on' || v === '1') return true
    if (v === 'false' || v === 'no' || v === 'off' || v === '0') return false
  }
  return undefined
}

/**
 * Shell values accepted in `shell:` frontmatter for .md `!`-block execution.
 */
export type FrontmatterShell = 'bash' | 'powershell'

const FRONTMATTER_SHELLS: readonly FrontmatterShell[] = ['bash', 'powershell']

/**
 * Parse and validate the `shell:` frontmatter field.
 *
 * Returns undefined for absent/null/empty (caller defaults to bash).
 * Logs a warning and returns undefined for unrecognized values — we fall
 * back to bash rather than failing the skill load, matching how `effort`
 * and other fields degrade.
 */
export function parseShellFrontmatter(
  value: unknown,
  source: string,
): FrontmatterShell | undefined {
  if (value == null) {
    return undefined
  }
  const normalized = String(value).trim().toLowerCase()
  if (normalized === '') {
    return undefined
  }
  if ((FRONTMATTER_SHELLS as readonly string[]).includes(normalized)) {
    return normalized as FrontmatterShell
  }
  logForDebugging(
    `Frontmatter 'shell: ${value}' in ${source} is not recognized. Valid values: ${FRONTMATTER_SHELLS.join(', ')}. Falling back to bash.`,
    { level: 'warn' },
  )
  return undefined
}
