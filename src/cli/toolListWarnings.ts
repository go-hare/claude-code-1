/**
 * Official 2.1.326 #2 (`Om`, `$l`, `Wl`) — startup warning when an
 * `--allowedTools`, `--disallowedTools` or `--tools` CLI value has an entry
 * that doesn't look like a complete rule or tool name.
 */
import { parseToolListFromCLI } from '../utils/permissions/permissionSetup.js'
import { permissionRuleValueFromString } from '../utils/permissions/permissionRuleParser.js'
import { truncateToWidth } from '../utils/truncate.js'

function countChar(text: string, ch: string): number {
  let count = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ch) count++
  }
  return count
}

/**
 * Official `Om(e)` — returns true when a parsed CLI rule entry looks malformed
 * or split across commas/parentheses.
 */
export function looksLikeIncompleteToolRule(entry: string): boolean {
  const trimmed = entry.trim()
  if (!trimmed) return false
  const openIdx = trimmed.indexOf('(')
  const closeIdx = trimmed.lastIndexOf(')')
  if (openIdx !== -1 || closeIdx !== -1) {
    // Missing closing paren, empty parens, closing paren before opening, or trailing text after ')'
    if (
      openIdx === -1 ||
      closeIdx === -1 ||
      closeIdx <= openIdx + 1 ||
      closeIdx !== trimmed.length - 1
    ) {
      return true
    }
    const toolPart = trimmed.slice(0, openIdx)
    // Empty tool name or space before '('
    if (!toolPart || /\s$/.test(toolPart) || /\s/.test(toolPart)) {
      return true
    }
    const parsed = permissionRuleValueFromString(trimmed)
    if (!parsed.toolName) {
      return true
    }
  }
  const unescaped = trimmed.replace(/\\[\s\S]/g, '')
  if (
    trimmed.includes(',') &&
    countChar(unescaped, '(') !== countChar(unescaped, ')')
  ) {
    return true
  }
  return false
}

/**
 * Plain tool name check for `--tools`: parentheses are never valid in `--tools`
 * (official `Wl` passes `--tools` through `Om` and also rejects `Tool(...)` rules).
 */
export function looksLikeInvalidToolsEntry(entry: string): boolean {
  const trimmed = entry.trim()
  if (!trimmed) return false
  if (trimmed.includes('(') || trimmed.includes(')')) {
    return true
  }
  return looksLikeIncompleteToolRule(trimmed)
}

function formatRuleHint(
  consequence: string,
  settingKey: 'allow' | 'deny',
): string {
  return `doesn't look like a complete rule, so ${consequence}. A rule looks like Bash or Bash(git *). Check for a missing ")", a space before "(", or text after ")". If a ")" belongs inside your rule, the list may have split there and the quoted text is only part of it: move the whole rule to permissions.${settingKey} in settings this session reads.`
}

function splitDisallowedPreservingParens(raw: readonly string[]): string[] {
  const out: string[] = []
  for (const item of raw) {
    let depth = 0
    let start = 0
    for (let i = 0; i < item.length; i++) {
      const ch = item[i]
      if (ch === '\\') {
        i++
        continue
      }
      if (ch === '(') depth++
      else if (ch === ')' && depth > 0) depth--
      else if (ch === ',' && depth === 0) {
        const piece = item.slice(start, i).trim()
        if (piece) out.push(piece)
        start = i + 1
      }
    }
    const tail = item.slice(start).trim()
    if (tail) out.push(tail)
  }
  return out
}

export type IncompleteCliToolListInput = {
  allowedTools: readonly string[]
  disallowedTools: readonly string[]
  tools: readonly string[]
}

/**
 * Official `Wl({ allowedTools, disallowedTools, tools })` — returns one
 * startup warning per CLI flag that contains entries looking like incomplete
 * permission rules (or non-tool-names for `--tools`).
 */
export function detectIncompleteCliToolListWarnings({
  allowedTools,
  disallowedTools,
  tools,
}: IncompleteCliToolListInput): string[] {
  const specs: Array<
    [
      flag: '--allowedTools' | '--disallowedTools' | '--tools',
      values: readonly string[],
      message: string,
    ]
  > = [
    [
      '--allowedTools',
      allowedTools,
      formatRuleHint(
        'this list may allow more or less than you meant',
        'allow',
      ),
    ],
    [
      '--disallowedTools',
      disallowedTools,
      formatRuleHint('a tool you meant to block may still run', 'deny'),
    ],
    [
      '--tools',
      tools,
      "doesn't look like a tool name, so this list may not give you the tools you meant. Use plain names such as Bash or Read, without parentheses.",
    ],
  ]

  // Official Wl: track entries in `--disallowedTools` that cleanly split
  // without embedded commas or escaped closing parens so valid compound rules
  // are not falsely flagged.
  const validDisallowedCounts = new Map<string, number>()
  for (const raw of disallowedTools) {
    for (const part of splitDisallowedPreservingParens([raw])) {
      if (
        !part.includes(',') &&
        !part.includes('\\)') &&
        !looksLikeIncompleteToolRule(part)
      ) {
        for (const token of parseToolListFromCLI([part])) {
          validDisallowedCounts.set(
            token,
            (validDisallowedCounts.get(token) ?? 0) + 1,
          )
        }
      }
    }
  }
  const validDisallowedKeys = new Set(validDisallowedCounts.keys())
  const consumeValidDisallowed = (token: string): boolean => {
    const remaining = validDisallowedCounts.get(token) ?? 0
    validDisallowedCounts.set(token, remaining - 1)
    return (
      remaining > 0 ||
      (validDisallowedKeys.has(token) && disallowedTools.includes(token))
    )
  }

  return specs.flatMap(([flag, values, message]) => {
    if (values.length === 0) return []
    const parsed = parseToolListFromCLI([...values])
    const bad = parsed.filter(entry => {
      if (flag === '--disallowedTools' && consumeValidDisallowed(entry)) {
        return false
      }
      return flag === '--tools'
        ? looksLikeInvalidToolsEntry(entry)
        : looksLikeIncompleteToolRule(entry)
    })
    const first = bad[0]
    if (first === undefined) return []
    const more =
      bad.length > 1 ? ` This list has ${bad.length - 1} more like it.` : ''
    const display = truncateToWidth(first, 64)
    return [`${flag}: "${display}" ${message}${more}`]
  })
}
