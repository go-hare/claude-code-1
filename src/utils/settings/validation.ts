import type { ConfigScope } from 'src/services/mcp/types.js'
import type { ZodError, ZodIssue } from 'zod/v4'
import { logForDebugging } from '../debug.js'
import { jsonParse } from '../slowOperations.js'
import { plural } from '../stringUtils.js'
import { validatePermissionRule } from './permissionValidation.js'
import { generateSettingsJSONSchema } from './schemaOutput.js'
import { applySettingsKeyAliases } from './settingsAliases.js'
import type { SettingsJson } from './types.js'
import { SettingsSchema } from './types.js'
import { getValidationTip } from './validationTips.js'

/**
 * Helper type guards for specific Zod v4 issue types
 * In v4, issue types have different structures than v3
 */
function isInvalidTypeIssue(issue: ZodIssue): issue is ZodIssue & {
  code: 'invalid_type'
  expected: string
  input: unknown
} {
  return issue.code === 'invalid_type'
}

function isInvalidValueIssue(issue: ZodIssue): issue is ZodIssue & {
  code: 'invalid_value'
  values: unknown[]
  input: unknown
} {
  return issue.code === 'invalid_value'
}

function isUnrecognizedKeysIssue(
  issue: ZodIssue,
): issue is ZodIssue & { code: 'unrecognized_keys'; keys: string[] } {
  return issue.code === 'unrecognized_keys'
}

function isTooSmallIssue(issue: ZodIssue): issue is ZodIssue & {
  code: 'too_small'
  minimum: number | bigint
  origin: string
} {
  return issue.code === 'too_small'
}

/** Field path in dot notation (e.g., "permissions.defaultMode", "env.DEBUG") */
export type FieldPath = string

export type ValidationError = {
  /** Relative file path */
  file?: string
  /** Field path in dot notation */
  path: FieldPath
  /** Human-readable error message */
  message: string
  /** 1-based line number for JSON syntax errors (Official 2.1.326 #261) */
  line?: number
  /** 1-based column number for JSON syntax errors (Official 2.1.326 #261) */
  column?: number
  /** Expected value or type */
  expected?: string
  /** The actual invalid value that was provided */
  invalidValue?: unknown
  /**
   * densable 2.1.247 `ri` — `severity === "warning"` is dropped by Z$/Cs.
   * Alias both-keys-set warnings carry `"warning"`.
   */
  severity?: 'warning' | 'fatal' | string
  /** Official 2.1.321 (#1903): cause when managed settings (e.g. MDM) could not be read */
  unreadCause?:
    | 'timeout'
    | 'killed'
    | 'spawn_busy'
    | 'spawn_error'
    | 'oversize'
    | 'unconvertible'
    | 'lint_unfinished'
  /** Suggestion for fixing the error */
  suggestion?: string
  /** Link to relevant documentation */
  docLink?: string
  /** MCP-specific metadata - only present for MCP configuration errors */
  mcpErrorMetadata?: {
    /** Which configuration scope this error came from */
    scope: ConfigScope
    /** The server name if error is specific to a server */
    serverName?: string
    /** Severity of the error */
    severity?: 'fatal' | 'warning'
    /**
     * densable 2.1.219 #4 — per-entry soft-skip category from --mcp-config.
     * Stable set: unknown_type | url_missing_type | invalid_config | reserved_name.
     * Open set — treat unrecognized values as a generic skip.
     */
    skipReason?: string
  }
}

export type SettingsWithErrors = {
  settings: SettingsJson
  errors: ValidationError[]
}

/**
 * Format a Zod validation error into human-readable validation errors
 */
/**
 * Get the type string for an unknown value (for error messages)
 */
function getReceivedType(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function extractReceivedFromMessage(msg: string): string | undefined {
  const match = msg.match(/received (\w+)/)
  return match ? match[1] : undefined
}

export function formatZodError(
  error: ZodError,
  filePath: string,
): ValidationError[] {
  return error.issues.map((issue): ValidationError => {
    const path = issue.path.map(String).join('.')
    let message = issue.message
    let expected: string | undefined

    let enumValues: string[] | undefined
    let expectedValue: string | undefined
    let receivedValue: unknown
    let invalidValue: unknown

    if (isInvalidValueIssue(issue)) {
      enumValues = issue.values.map(v => String(v))
      expectedValue = enumValues.join(' | ')
      receivedValue = undefined
      invalidValue = undefined
    } else if (isInvalidTypeIssue(issue)) {
      expectedValue = issue.expected
      const receivedType = extractReceivedFromMessage(issue.message)
      receivedValue = receivedType ?? getReceivedType(issue.input)
      invalidValue = receivedType ?? getReceivedType(issue.input)
    } else if (isTooSmallIssue(issue)) {
      expectedValue = String(issue.minimum)
    } else if (issue.code === 'custom' && 'params' in issue) {
      const params = issue.params as { received?: unknown }
      receivedValue = params.received
      invalidValue = receivedValue
    }

    const tip = getValidationTip({
      path,
      code: issue.code,
      expected: expectedValue,
      received: receivedValue,
      enumValues,
      message: issue.message,
      value: receivedValue,
    })

    if (isInvalidValueIssue(issue)) {
      expected = enumValues?.map(v => `"${v}"`).join(', ')
      message = `Invalid value. Expected one of: ${expected}`
    } else if (isInvalidTypeIssue(issue)) {
      const receivedType =
        extractReceivedFromMessage(issue.message) ??
        getReceivedType(issue.input)
      if (
        issue.expected === 'object' &&
        receivedType === 'null' &&
        path === ''
      ) {
        message = 'Invalid or malformed JSON'
      } else {
        message = `Expected ${issue.expected}, but received ${receivedType}`
      }
    } else if (isUnrecognizedKeysIssue(issue)) {
      const keys = issue.keys.join(', ')
      message = `Unrecognized ${plural(issue.keys.length, 'field')}: ${keys}`
    } else if (isTooSmallIssue(issue)) {
      message = `Number must be greater than or equal to ${issue.minimum}`
      expected = String(issue.minimum)
    }

    return {
      file: filePath,
      path,
      message,
      expected,
      invalidValue,
      suggestion: tip?.suggestion,
      docLink: tip?.docLink,
    }
  })
}

/**
 * Official 2.1.326 (#261) `a_o`: determine the 1-based line and column of a JSON
 * syntax error in raw text so broken settings.json / .mcp.json files tell the
 * user exactly where the error is.
 */
export function findJsonSyntaxErrorLocation(
  raw: string,
): { line: number; column: number } | undefined {
  try {
    JSON.parse(raw)
    return undefined
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Bun / V8 format: "... (line 3 column 5)" or "line 3, column 5"
    const lineColMatch = msg.match(/line\s+(\d+)[,\s]+col(?:umn)?\s+(\d+)/i)
    if (lineColMatch) {
      const line = Number(lineColMatch[1])
      const column = Number(lineColMatch[2])
      if (
        Number.isFinite(line) &&
        Number.isFinite(column) &&
        line >= 1 &&
        column >= 1
      ) {
        return { line, column }
      }
    }
    // V8 position format: "... at position 42"
    const posMatch = msg.match(/position\s+(\d+)/i)
    if (posMatch) {
      const offset = Math.min(Number(posMatch[1]), raw.length)
      return offsetToLineCol(raw, offset)
    }
    // Fallback deterministic JSON lexer scan to locate the first syntax error offset
    let offset: number | undefined
    try {
      offset = locateFirstJsonSyntaxErrorOffset(raw)
    } catch {
      return undefined
    }
    if (offset !== undefined) {
      return offsetToLineCol(raw, offset)
    }
    return undefined
  }
}

function offsetToLineCol(
  text: string,
  offset: number,
): { line: number; column: number } {
  let line = 1
  let column = 1
  const limit = Math.max(0, Math.min(offset, text.length))
  for (let i = 0; i < limit; i++) {
    const ch = text.charCodeAt(i)
    if (ch === 10) {
      line++
      column = 1
    } else if (ch === 13) {
      if (i + 1 < limit && text.charCodeAt(i + 1) === 10) {
        i++
      }
      line++
      column = 1
    } else {
      column++
    }
  }
  return { line, column }
}

const MAX_JSON_LEXER_DEPTH = 512

export function locateFirstJsonSyntaxErrorOffset(
  raw: string,
  maxDepth: number = MAX_JSON_LEXER_DEPTH,
): number | undefined {
  let pos = 0
  const len = raw.length
  let depthExceeded = false
  const skipWs = (): void => {
    while (pos < len) {
      const c = raw.charCodeAt(pos)
      if (c === 32 || c === 9 || c === 10 || c === 13) pos++
      else break
    }
  }
  const parseValue = (depth: number): number | undefined => {
    if (depth > maxDepth) {
      depthExceeded = true
      return undefined
    }
    skipWs()
    if (pos >= len) return pos
    const ch = raw[pos]
    if (ch === '{') {
      pos++
      skipWs()
      if (pos < len && raw[pos] === '}') {
        pos++
        return undefined
      }
      while (pos < len) {
        skipWs()
        if (raw[pos] !== '"') return pos
        const strErr = parseString()
        if (strErr !== undefined) return strErr
        skipWs()
        if (raw[pos] !== ':') return pos
        pos++
        const valErr = parseValue(depth + 1)
        if (depthExceeded) return undefined
        if (valErr !== undefined) return valErr
        skipWs()
        if (raw[pos] === ',') {
          pos++
          skipWs()
          if (raw[pos] === '}') return pos
          continue
        }
        if (raw[pos] === '}') {
          pos++
          return undefined
        }
        return pos
      }
      return pos
    }
    if (ch === '[') {
      pos++
      skipWs()
      if (pos < len && raw[pos] === ']') {
        pos++
        return undefined
      }
      while (pos < len) {
        const valErr = parseValue(depth + 1)
        if (depthExceeded) return undefined
        if (valErr !== undefined) return valErr
        skipWs()
        if (raw[pos] === ',') {
          pos++
          skipWs()
          if (raw[pos] === ']') return pos
          continue
        }
        if (raw[pos] === ']') {
          pos++
          return undefined
        }
        return pos
      }
      return pos
    }
    if (ch === '"') return parseString()
    if (ch === '-' || (ch !== undefined && ch >= '0' && ch <= '9')) {
      const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
        raw.slice(pos),
      )
      if (!m) return pos
      pos += m[0].length
      return undefined
    }
    if (raw.startsWith('true', pos)) {
      pos += 4
      return undefined
    }
    if (raw.startsWith('false', pos)) {
      pos += 5
      return undefined
    }
    if (raw.startsWith('null', pos)) {
      pos += 4
      return undefined
    }
    return pos
  }
  const parseString = (): number | undefined => {
    if (raw[pos] !== '"') return pos
    pos++
    while (pos < len) {
      const c = raw.charCodeAt(pos)
      if (c === 34) {
        pos++
        return undefined
      }
      if (c === 92) {
        pos++
        if (pos >= len) return pos
        const esc = raw[pos]
        if (
          esc === '"' ||
          esc === '\\' ||
          esc === '/' ||
          esc === 'b' ||
          esc === 'f' ||
          esc === 'n' ||
          esc === 'r' ||
          esc === 't'
        ) {
          pos++
        } else if (esc === 'u') {
          if (!/^[0-9a-fA-F]{4}/.test(raw.slice(pos + 1, pos + 5))) {
            return pos
          }
          pos += 5
        } else {
          return pos
        }
      } else if (c < 32) {
        return pos
      } else {
        pos++
      }
    }
    return pos
  }
  const err = parseValue(0)
  if (depthExceeded) return undefined
  if (err !== undefined) return err
  skipWs()
  if (pos < len) return pos
  return undefined
}

/** Official 2.1.326 (#19) `Et` — max nesting depth allowed in settings JSON. */
export const MAX_SETTINGS_NESTING_DEPTH = 64

/** Official 2.1.326 (#19) `QS` — upper bound on visited nodes to prevent DoS. */
const MAX_SETTINGS_OBJECT_VISITS = 2_000_000

export type DroppedDeepEntry = {
  key: string
  count: number
  path: string
}

function defineOwnDataProperty(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  // Official 2.1.326 (#18): use Object.defineProperty so keys like `__proto__`
  // never mutate the target's prototype chain.
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  })
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/**
 * Official 2.1.326 (#18 & #19) `c0e`: iteratively clone settings JSON while
 * (1) using `Object.defineProperty` so `__proto__` / `constructor` / `prototype`
 * keys never cause prototype pollution or merge crashes, and
 * (2) pruning any object/array nested deeper than `maxDepth` (default 64)
 * without blowing the JS call stack.
 */
export function pruneDeepSettings(
  raw: unknown,
  maxDepth = MAX_SETTINGS_NESTING_DEPTH,
): {
  value: unknown
  dropped: DroppedDeepEntry[]
  tooManyNodes: boolean
} {
  if (raw === null || typeof raw !== 'object') {
    return { value: raw, dropped: [], tooManyNodes: false }
  }

  const droppedByTopKey = new Map<string, DroppedDeepEntry>()
  const recordDrop = (topKey: string, path: string): void => {
    const existing = droppedByTopKey.get(topKey)
    if (existing) {
      existing.count++
    } else {
      droppedByTopKey.set(topKey, { key: topKey, count: 1, path })
    }
  }

  const rootTarget: Record<string, unknown> | unknown[] = Array.isArray(raw)
    ? []
    : {}
  type Frame = {
    source: Record<string, unknown> | unknown[]
    target: Record<string, unknown> | unknown[]
    depth: number
    topKey: string
    path: string
  }
  const stack: Frame[] = [
    {
      source: raw as Record<string, unknown> | unknown[],
      target: rootTarget,
      depth: 0,
      topKey: '',
      path: '',
    },
  ]
  let visits = 0
  let tooManyNodes = false

  while (stack.length > 0) {
    const frame = stack.pop()!
    if (++visits > MAX_SETTINGS_OBJECT_VISITS) {
      tooManyNodes = true
      break
    }

    if (Array.isArray(frame.source)) {
      const targetArr = frame.target as unknown[]
      for (let i = 0; i < frame.source.length; i++) {
        const item = frame.source[i]
        const nextTopKey = frame.topKey || `[${i}]`
        const nextPath = frame.path ? `${frame.path}[${i}]` : `[${i}]`
        if (item !== null && typeof item === 'object') {
          if (frame.depth + 1 >= maxDepth) {
            recordDrop(nextTopKey, nextPath)
            targetArr.push(null)
            continue
          }
          const childTarget: Record<string, unknown> | unknown[] =
            Array.isArray(item) ? [] : {}
          targetArr.push(childTarget)
          stack.push({
            source: item as Record<string, unknown> | unknown[],
            target: childTarget,
            depth: frame.depth + 1,
            topKey: nextTopKey,
            path: nextPath,
          })
        } else {
          targetArr.push(item)
        }
      }
    } else if (isPlainRecord(frame.source)) {
      const targetObj = frame.target as Record<string, unknown>
      for (const key of Object.keys(frame.source)) {
        const val = frame.source[key]
        const nextTopKey = frame.topKey || key
        const nextPath = frame.path ? `${frame.path}.${key}` : key
        if (val !== null && typeof val === 'object') {
          if (frame.depth + 1 >= maxDepth) {
            recordDrop(nextTopKey, nextPath)
            // Omit deep plain-object children; replace arrays or non-plain objects with null
            if (Array.isArray(val)) {
              defineOwnDataProperty(targetObj, key, null)
            }
            continue
          }
          const childTarget: Record<string, unknown> | unknown[] =
            Array.isArray(val) ? [] : {}
          defineOwnDataProperty(targetObj, key, childTarget)
          stack.push({
            source: val as Record<string, unknown> | unknown[],
            target: childTarget,
            depth: frame.depth + 1,
            topKey: nextTopKey,
            path: nextPath,
          })
        } else {
          defineOwnDataProperty(targetObj, key, val)
        }
      }
    }
  }

  return {
    value: rootTarget,
    dropped: [...droppedByTopKey.values()],
    tooManyNodes,
  }
}

/**
 * Official 2.1.326 (#19) `Vt`: convert deep-nesting drops into ValidationError
 * warnings (or fatal when top-level `hooks` is deeply nested and cannot load).
 */
export function buildDeepNestingWarnings(
  dropped: DroppedDeepEntry[],
  filePath: string,
  maxDepth = MAX_SETTINGS_NESTING_DEPTH,
): ValidationError[] {
  return dropped.map(entry => {
    const subject =
      entry.count === 1
        ? `A value under "${entry.key}" is`
        : `${entry.count} values under "${entry.key}" are`
    const pronoun = entry.count === 1 ? 'it' : 'them'
    return {
      file: filePath,
      path: entry.path || entry.key,
      message: `${subject} nested more than ${maxDepth} levels deep, so Claude Code ignores ${pronoun}.`,
      severity: entry.key === 'hooks' ? 'fatal' : 'warning',
    }
  })
}

/**
 * Official 2.1.326 (#19) `JHi`: check whether settings content exceeds the
 * 64-level nesting limit (used by `validateSettingsFileContent`).
 */
export function checkDeepNestingError(
  raw: unknown,
  maxDepth = MAX_SETTINGS_NESTING_DEPTH,
): string | null {
  const { dropped, tooManyNodes } = pruneDeepSettings(raw, maxDepth)
  if (tooManyNodes) {
    return `Settings file contains too many nested objects or arrays to validate safely.`
  }
  if (dropped.length === 0) return null
  const keys = dropped.map(d => `"${d.key}"`).join(', ')
  const verb = dropped.length === 1 ? 'holds' : 'hold'
  return `${keys} ${verb} objects or arrays nested more than ${maxDepth} levels deep, which Claude Code ignores.`
}

/**
 * Official 2.1.326 (#122): guard against malformed or pathological glob
 * patterns that could hang regex/matcher compilation via catastrophic
 * backtracking or excessive brace/extglob nesting.
 */
const MAX_GLOB_PATTERN_LENGTH = 65_536
const MAX_GLOB_GROUP_DEPTH = 32
const MAX_GLOB_EXTGLOB_OPERATORS = 32

export function isSafeGlobPattern(
  pattern: string,
): { safe: true } | { safe: false; reason: string } {
  if (pattern.length > MAX_GLOB_PATTERN_LENGTH) {
    return {
      safe: false,
      reason: `Glob pattern exceeds maximum length of ${MAX_GLOB_PATTERN_LENGTH} characters`,
    }
  }
  let braceDepth = 0
  let parenDepth = 0
  let inCharClass = false
  let extglobCount = 0
  let escaped = false
  let consecutiveStars = 0

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!
    if (escaped) {
      escaped = false
      consecutiveStars = 0
      continue
    }
    if (ch === '\\') {
      escaped = true
      consecutiveStars = 0
      continue
    }
    if (inCharClass) {
      if (ch === ']') {
        inCharClass = false
      }
      continue
    }
    if (ch === '[') {
      inCharClass = true
      consecutiveStars = 0
      continue
    }
    if (ch === '*') {
      consecutiveStars++
      if (consecutiveStars > 16) {
        return {
          safe: false,
          reason: 'Glob pattern contains excessive consecutive wildcards',
        }
      }
      continue
    }
    consecutiveStars = 0

    if (ch === '{') {
      braceDepth++
      if (braceDepth > MAX_GLOB_GROUP_DEPTH) {
        return {
          safe: false,
          reason: `Glob pattern brace nesting exceeds ${MAX_GLOB_GROUP_DEPTH} levels`,
        }
      }
    } else if (ch === '}') {
      braceDepth--
      if (braceDepth < 0) {
        return {
          safe: false,
          reason: 'Unbalanced closing brace in glob pattern',
        }
      }
    } else if (ch === '(') {
      const prev = i > 0 ? pattern[i - 1] : ''
      if (
        prev === '@' ||
        prev === '!' ||
        prev === '?' ||
        prev === '+' ||
        prev === '*'
      ) {
        extglobCount++
        if (extglobCount > MAX_GLOB_EXTGLOB_OPERATORS) {
          return {
            safe: false,
            reason: `Glob pattern contains more than ${MAX_GLOB_EXTGLOB_OPERATORS} extglob groups`,
          }
        }
      }
      parenDepth++
      if (parenDepth > MAX_GLOB_GROUP_DEPTH) {
        return {
          safe: false,
          reason: `Glob pattern group nesting exceeds ${MAX_GLOB_GROUP_DEPTH} levels`,
        }
      }
    } else if (ch === ')') {
      parenDepth--
      if (parenDepth < 0) {
        return {
          safe: false,
          reason: 'Unbalanced closing parenthesis in glob pattern',
        }
      }
    }
  }

  if (inCharClass) {
    return {
      safe: false,
      reason: 'Unterminated character class in glob pattern',
    }
  }
  if (braceDepth !== 0) {
    return { safe: false, reason: 'Unbalanced braces in glob pattern' }
  }
  if (parenDepth !== 0) {
    return { safe: false, reason: 'Unbalanced parentheses in glob pattern' }
  }
  return { safe: true }
}

/**
 * Validates that settings file content conforms to the SettingsSchema.
 * This is used during file edits to ensure the resulting file is valid.
 */
export function validateSettingsFileContent(content: string):
  | {
      isValid: true
    }
  | {
      isValid: false
      error: string
      fullSchema: string
    } {
  try {
    // Parse the JSON first
    const rawJsonData = jsonParse(content)

    // Official 2.1.326 (#19) JHi: reject objects/arrays nested >64 levels deep
    const deepError = checkDeepNestingError(rawJsonData)
    if (deepError) {
      return {
        isValid: false,
        error: `Settings validation failed:\n- ${deepError}`,
        fullSchema: generateSettingsJSONSchema(),
      }
    }
    const { value: jsonData } = pruneDeepSettings(rawJsonData)

    // densable 2.1.232 #8 — alias → canonical before strict schema
    applySettingsKeyAliases(jsonData)

    // Validate against SettingsSchema in strict mode
    const result = SettingsSchema().strict().safeParse(jsonData)

    if (result.success) {
      return { isValid: true }
    }

    // Format the validation error in a helpful way
    const errors = formatZodError(result.error, 'settings')
    const errorMessage =
      'Settings validation failed:\n' +
      errors.map(err => `- ${err.path}: ${err.message}`).join('\n')

    return {
      isValid: false,
      error: errorMessage,
      fullSchema: generateSettingsJSONSchema(),
    }
  } catch (parseError) {
    const loc = findJsonSyntaxErrorLocation(content)
    const locSuffix = loc ? ` (line ${loc.line}, column ${loc.column})` : ''
    return {
      isValid: false,
      error: `Invalid JSON${locSuffix}: ${parseError instanceof Error ? parseError.message : 'Unknown parsing error'}`,
      fullSchema: generateSettingsJSONSchema(),
    }
  }
}

/**
 * Filters invalid permission rules from raw parsed JSON data before schema validation.
 * This prevents one bad rule from poisoning the entire settings file.
 * Returns warnings for each filtered rule.
 */
export function filterInvalidPermissionRules(
  data: unknown,
  filePath: string,
): ValidationError[] {
  if (!data || typeof data !== 'object') return []
  const obj = data as Record<string, unknown>
  if (!obj.permissions || typeof obj.permissions !== 'object') return []
  const perms = obj.permissions as Record<string, unknown>

  const warnings: ValidationError[] = []
  for (const key of ['allow', 'deny', 'ask'] as const) {
    const rules = perms[key]
    if (!Array.isArray(rules)) continue

    perms[key] = rules.filter(rule => {
      if (typeof rule !== 'string') {
        warnings.push({
          file: filePath,
          path: `permissions.${key}`,
          message: `Non-string value in ${key} array was removed`,
          severity: 'warning',
          invalidValue: rule,
        })
        return false
      }
      // PR-0a: pass behavior so vault whole-tool allow is rejected on the
      // allow array but the same rule under deny stays as a kill switch.
      const result = validatePermissionRule(rule, key)
      if (!result.valid) {
        let message = `Invalid permission rule "${rule}" was skipped`
        if (result.error) message += `: ${result.error}`
        if (result.suggestion) message += `. ${result.suggestion}`
        warnings.push({
          file: filePath,
          path: `permissions.${key}`,
          message,
          severity: 'warning',
          invalidValue: rule,
        })
        return false
      }
      // Official filter dump only `return!0` on valid. Keep the rule;
      // do not push validate().warning onto the settings-errors channel
      // (that opens InvalidSettingsDialog and can Exit the process).
      if (result.warning) {
        logForDebugging(
          `Permission rule "${rule}" in ${filePath}: ${result.warning}`,
        )
      }
      return true
    })
  }
  return warnings
}

/**
 * official iy / qr — withhold grants in a block when a restriction in the
 * same block is unreadable or had invalid entries trimmed.
 * Handles sandbox.network (deniedDomains → allowedDomains) and
 * sandbox.filesystem (denyWrite/denyRead → allowWrite/allowRead).
 */
export function filterAndWithholdSandboxRestrictions(
  data: unknown,
  filePath: string,
): ValidationError[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return []
  const root = data as Record<string, unknown>
  if (
    !root.sandbox ||
    typeof root.sandbox !== 'object' ||
    Array.isArray(root.sandbox)
  ) {
    return []
  }
  const sandbox = root.sandbox as Record<string, unknown>
  const warnings: ValidationError[] = []

  const blocks: Array<{
    blockName: 'network' | 'filesystem'
    restrictions: string[]
    grants: string[]
  }> = [
    {
      blockName: 'network',
      restrictions: ['deniedDomains'],
      grants: ['allowedDomains'],
    },
    {
      blockName: 'filesystem',
      restrictions: ['denyWrite', 'denyRead'],
      grants: ['allowWrite', 'allowRead'],
    },
  ]

  for (const { blockName, restrictions, grants } of blocks) {
    const block = sandbox[blockName]
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue
    const blockObj = block as Record<string, unknown>
    const badReasons: string[] = []

    for (const key of restrictions) {
      if (!(key in blockObj) || blockObj[key] === undefined) continue
      const val = blockObj[key]
      if (!Array.isArray(val)) {
        badReasons.push(`"${key}"`)
        delete blockObj[key]
        warnings.push({
          file: filePath,
          path: `sandbox.${blockName}.${key}`,
          message: `"${key}" was not an array and was ignored.`,
          invalidValue: val,
        })
        continue
      }
      const validEntries = val.filter(
        (entry): entry is string =>
          typeof entry === 'string' && entry.length > 0,
      )
      if (validEntries.length < val.length) {
        badReasons.push(`an entry of "${key}"`)
        blockObj[key] = validEntries
        warnings.push({
          file: filePath,
          path: `sandbox.${blockName}.${key}`,
          message: `Invalid entry in "${key}" was ignored.`,
        })
      }
    }

    if (badReasons.length === 0) continue
    const because = badReasons.join(' and ')
    for (const grantKey of grants) {
      if (blockObj[grantKey] === undefined) continue
      delete blockObj[grantKey]
      warnings.push({
        file: filePath,
        path: `sandbox.${blockName}.${grantKey}`,
        message: `"${grantKey}" was withheld because ${because} in the same block could not be read; it takes effect again once that is fixed.`,
        severity: 'warning',
      })
    }
  }

  return warnings
}
