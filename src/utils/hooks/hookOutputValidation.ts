import type { HookJSONOutput } from 'src/entrypoints/agentSdkTypes.js'
import { hookJSONOutputSchema } from '../../types/hooks.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { jsonParse, jsonStringify, slowLogging } from '../slowOperations.js'

/**
 * densable 2.1.248 Eve @186234668 — first-line prefix Swt/wwt share.
 * wwt strips this to emit `${event} hook output invalid: …`.
 */
export const Eve = 'Hook JSON output validation failed \u2014 '

const vNn = new Set(['async', 'hookEventName', 'behavior'])

type HookSchemaIssue = {
  path: ReadonlyArray<PropertyKey>
  message: string
  code?: string
  errors?: ReadonlyArray<ReadonlyArray<HookSchemaIssue>>
  unionErrors?: ReadonlyArray<{ issues: ReadonlyArray<HookSchemaIssue> }>
}

function _wt(path: ReadonlyArray<PropertyKey>): string {
  return path.map(String).join('.') || '(root)'
}

function Dz(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** densable 2.1.248 ywt — union-noise on async/hookEventName/behavior. */
function ywt(issue: HookSchemaIssue): boolean {
  const last = issue.path.at(-1)
  return (
    issue.code === 'invalid_value' && typeof last === 'string' && vNn.has(last)
  )
}

/** densable 2.1.248 bwt — flatten union issues onto one path/message. */
function bwt(
  issue: HookSchemaIssue,
  prefix: ReadonlyArray<PropertyKey>,
): { path: PropertyKey[]; message: string } {
  const path = [...prefix, ...issue.path]
  const branches: ReadonlyArray<ReadonlyArray<HookSchemaIssue>> =
    issue.errors ?? issue.unionErrors?.map(err => err.issues) ?? []
  if (issue.code !== 'invalid_union' || branches.length === 0) {
    return { path, message: issue.message.replace(/^Invalid input: /, '') }
  }
  const preferred = branches.find(
    branch => branch.length > 0 && !branch.some(ywt),
  )?.[0]
  if (preferred) {
    return bwt(preferred, path)
  }
  const noise = branches.flatMap(branch => branch.filter(ywt))
  const first = noise[0]
  if (first) {
    return bwt(first, path)
  }
  return { path, message: issue.message.replace(/^Invalid input: /, '') }
}

/**
 * densable 2.1.248 Swt @186235528 sha=7cd25b6ba6d5958a
 * PermissionRequest / legacy top-level decision first-line schema copy.
 */
export function Swt(
  parsed: unknown,
  error: { issues: ReadonlyArray<HookSchemaIssue> },
): string {
  const hookSpecific = Dz(parsed) ? parsed.hookSpecificOutput : undefined
  const issues = error.issues.map(issue => bwt(issue, []))
  const first = issues[0]
  let lead = first ? `${_wt(first.path)}: ${first.message}` : 'unknown error'
  if (Dz(hookSpecific) && !('hookEventName' in hookSpecific)) {
    lead = 'hookSpecificOutput is missing required field "hookEventName"'
  } else if (
    Dz(hookSpecific) &&
    hookSpecific.hookEventName === 'PermissionRequest' &&
    !Dz(hookSpecific.decision) &&
    first?.path[0] === 'hookSpecificOutput' &&
    first.path[1] === 'decision'
  ) {
    lead +=
      ' (PermissionRequest decision must be {"behavior": "allow"} or {"behavior": "deny", "message": "..."})'
  } else if (
    Dz(parsed) &&
    first?.path.length === 1 &&
    first.path[0] === 'decision' &&
    (parsed.decision === 'allow' ||
      parsed.decision === 'deny' ||
      parsed.decision === 'ask')
  ) {
    lead +=
      parsed.decision === 'ask'
        ? ' (top-level decision is the legacy approve|block field; for "ask" use hookSpecificOutput.permissionDecision in a PreToolUse hook)'
        : ` (top-level decision is the legacy approve|block field; for "${parsed.decision}" use hookSpecificOutput.permissionDecision in a PreToolUse hook, or hookSpecificOutput.decision: {"behavior": "${parsed.decision}"} in a PermissionRequest hook)`
  }
  const rest = issues
    .slice(1)
    .map(issue => `  - ${_wt(issue.path)}: ${issue.message}`)
    .join('\n')
  return `${Eve}${lead}${rest ? `\n${rest}` : ''}\n\nThe hook's output was: ${jsonStringify(parsed, null, 2)}`
}

/**
 * densable 2.1.248 wwt @186237955 sha=fba5d4f0b9ee6440
 * Agents-row copy: names the hook event + first-line schema/error.
 */
export function wwt(eventName: string, stderr: string): string {
  const first =
    stderr
      .split('\n')
      .map(line => line.trim())
      .find(line => line.length > 0) ?? ''
  if (first.startsWith(Eve)) {
    return `${eventName} hook output invalid: ${first.slice(Eve.length)}`
  }
  return first
    ? `${eventName} hook failed: ${first}`
    : `${eventName} hook failed to run`
}

/**
 * densable 2.1.248 Uct @186255693 — keep Eve on line 1; append command stderr.
 */
export function Uct(
  validationError: string,
  status: number,
  stderr: string,
): string {
  const trimmed = stderr.trim()
  return status !== 0 && trimmed
    ? `${validationError}\n\nHook exited ${status} with stderr:\n${trimmed}`
    : validationError
}

/**
 * Parse and validate a JSON string against the hook output Zod schema.
 * Returns the validated output or formatted validation errors.
 */
export function validateHookJson(
  jsonString: string,
): { json: HookJSONOutput } | { validationError: string } {
  const parsed = jsonParse(jsonString)
  const validation = hookJSONOutputSchema().safeParse(parsed)
  if (validation.success) {
    logForDebugging('Successfully parsed and validated hook JSON output')
    return { json: validation.data }
  }
  return {
    validationError: Swt(parsed, validation.error),
  }
}

/**
 * densable 2.1.248 $Nn — NDJSON where every non-empty line is JSON that
 * fails the hook schema or validates to an empty object.
 */
export function isSeveralJsonDocuments(text: string): boolean {
  const lines = text.split('\n').filter(line => line.trim() !== '')
  if (lines.length < 2) {
    return false
  }
  using _ = slowLogging`parseHookOutput: json lines (${lines.length})`
  return lines.every(line => {
    try {
      const parsed = hookJSONOutputSchema().safeParse(jsonParse(line.trim()))
      return !parsed.success || Object.keys(parsed.data).length === 0
    } catch {
      return false
    }
  })
}

export function parseHttpHookOutput(body: string): {
  json?: HookJSONOutput
  validationError?: string
} {
  const trimmed = body.trim()

  if (trimmed === '') {
    const validation = hookJSONOutputSchema().safeParse({})
    if (validation.success) {
      logForDebugging(
        'HTTP hook returned empty body, treating as empty JSON object',
      )
      return { json: validation.data }
    }
  }

  if (!trimmed.startsWith('{')) {
    const validationError = `HTTP hook must return JSON, but got non-JSON response body: ${trimmed.length > 200 ? trimmed.slice(0, 200) + '\u2026' : trimmed}`
    logForDebugging(validationError)
    return { validationError }
  }

  try {
    const result = validateHookJson(trimmed)
    if ('json' in result) {
      return result
    }
    logForDebugging(result.validationError)
    return result
  } catch (e) {
    const validationError = `HTTP hook must return valid JSON, but parsing failed: ${e}`
    logForDebugging(validationError)
    return { validationError }
  }
}
