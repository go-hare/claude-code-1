import type { ZodError, ZodIssue } from 'zod/v4'
import { AbortError, ShellError } from './errors.js'
import { INTERRUPT_MESSAGE_FOR_TOOL_USE } from './messages.js'

type UnionIssue = ZodIssue & {
  code: 'invalid_union'
  errors: ZodIssue[][]
}

function isUnionIssue(issue: ZodIssue): issue is UnionIssue {
  return (
    issue.code === 'invalid_union' &&
    'errors' in issue &&
    Array.isArray((issue as UnionIssue).errors)
  )
}

function flattenIssues(issues: readonly ZodIssue[]): ZodIssue[] {
  const out: ZodIssue[] = []
  for (const issue of issues) {
    if (isUnionIssue(issue)) {
      out.push(...pickClosestUnionBranch(issue.errors))
    } else {
      out.push(issue)
    }
  }
  return out
}

function pickClosestUnionBranch(branches: ZodIssue[][]): ZodIssue[] {
  if (branches.length === 0) return []
  let best = flattenIssues(branches[0] ?? [])
  let bestScore = scoreUnionBranch(best)
  for (let i = 1; i < branches.length; i++) {
    const candidate = flattenIssues(branches[i] ?? [])
    const score = scoreUnionBranch(candidate)
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return best
}

/**
 * Prefer a branch that is "missing required fields" over a discriminator
 * mismatch (`invalid_value` on `action`). Empty Artifact `{}` then reports
 * `file_path` instead of dumping all 20 union arms.
 */
function scoreUnionBranch(issues: readonly ZodIssue[]): number {
  if (issues.length === 0) return Number.NEGATIVE_INFINITY
  const missing = issues.filter(
    issue =>
      issue.code === 'invalid_type' &&
      issue.message.includes('received undefined'),
  )
  const discriminators = issues.filter(issue => issue.code === 'invalid_value')
  let score = 1000 - issues.length * 10
  if (missing.length === issues.length) score += 200
  else if (missing.length > 0) score += 50
  if (discriminators.length === issues.length) score -= 80
  return score
}

export function formatError(error: unknown): string {
  if (error instanceof AbortError) {
    return error.message || INTERRUPT_MESSAGE_FOR_TOOL_USE
  }
  if (!(error instanceof Error)) {
    return String(error)
  }
  const parts = getErrorParts(error)
  const fullMessage =
    parts.filter(Boolean).join('\n').trim() || 'Command failed with no output'
  if (fullMessage.length <= 10000) {
    return fullMessage
  }
  const halfLength = 5000
  const start = fullMessage.slice(0, halfLength)
  const end = fullMessage.slice(-halfLength)
  return `${start}\n\n... [${fullMessage.length - 10000} characters truncated] ...\n\n${end}`
}

export function getErrorParts(error: Error): string[] {
  if (error instanceof ShellError) {
    return [
      `Exit code ${error.code}`,
      error.interrupted ? INTERRUPT_MESSAGE_FOR_TOOL_USE : '',
      error.stderr,
      error.stdout,
    ]
  }
  const parts = [error.message]
  if ('stderr' in error && typeof error.stderr === 'string') {
    parts.push(error.stderr)
  }
  if ('stdout' in error && typeof error.stdout === 'string') {
    parts.push(error.stdout)
  }
  return parts
}

/**
 * Formats a Zod validation path into a readable string
 * e.g., ['todos', 0, 'activeForm'] => 'todos[0].activeForm'
 */
function formatValidationPath(path: PropertyKey[]): string {
  if (path.length === 0) return ''

  return path.reduce((acc, segment, index) => {
    const segmentStr = String(segment)
    if (typeof segment === 'number') {
      return `${String(acc)}[${segmentStr}]`
    }
    return index === 0 ? segmentStr : `${String(acc)}.${segmentStr}`
  }, '') as string
}

/**
 * Converts Zod validation errors into a human-readable and LLM friendly error message
 *
 * @param toolName The name of the tool that failed validation
 * @param error The Zod error object
 * @returns A formatted error message string
 */
export function formatZodValidationError(
  toolName: string,
  error: ZodError,
): string {
  const issues = flattenIssues(error.issues)

  const missingParams = issues
    .filter(
      err =>
        err.code === 'invalid_type' &&
        err.message.includes('received undefined'),
    )
    .map(err => formatValidationPath(err.path))
    .filter(param => param.length > 0)

  const unexpectedParams = issues
    .filter(err => err.code === 'unrecognized_keys')
    .flatMap(err => err.keys)

  const typeMismatchParams = issues
    .filter(err => {
      if (
        err.code === 'invalid_type' &&
        !err.message.includes('received undefined')
      ) {
        return true
      }
      return err.code === 'invalid_value'
    })
    .map(err => {
      const path = formatValidationPath(err.path)
      if (err.code === 'invalid_value') {
        const values = (err as { values?: unknown[] }).values
        const expected = Array.isArray(values)
          ? values.map(v => JSON.stringify(v)).join('|')
          : 'literal'
        return { param: path, expected, received: 'undefined' }
      }
      const typeErr = err as { expected: string }
      const receivedMatch = err.message.match(/received (\w+)/)
      const received = receivedMatch ? receivedMatch[1] : 'unknown'
      return {
        param: path,
        expected: typeErr.expected,
        received,
      }
    })
    .filter(item => item.param.length > 0)

  // Default to original error message if we can't create a better one
  let errorContent = error.message

  // Build a human-readable error message
  const errorParts = []

  if (missingParams.length > 0) {
    const missingParamErrors = missingParams.map(
      param => `The required parameter \`${param}\` is missing`,
    )
    errorParts.push(...missingParamErrors)
  }

  if (unexpectedParams.length > 0) {
    const unexpectedParamErrors = unexpectedParams.map(
      param => `An unexpected parameter \`${param}\` was provided`,
    )
    errorParts.push(...unexpectedParamErrors)
  }

  if (typeMismatchParams.length > 0) {
    const typeErrors = typeMismatchParams.map(
      ({ param, expected, received }) =>
        `The parameter \`${param}\` type is expected as \`${expected}\` but provided as \`${received}\``,
    )
    errorParts.push(...typeErrors)
  }

  if (errorParts.length > 0) {
    errorContent = `${toolName} failed due to the following ${errorParts.length > 1 ? 'issues' : 'issue'}:\n${errorParts.join('\n')}`
  }

  return errorContent
}
