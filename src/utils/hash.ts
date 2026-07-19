import { createHash } from 'crypto'

/**
 * densable bu — sha256 hex truncated to 12 chars for analytics
 * (errorDetailsHash / similar short fingerprints). Crypto-stable across
 * Bun/Node; not for content-addressed storage (use hashContent for that).
 */
export function shortSha256Hex12(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 12)
}

/**
 * densable Ho — unique values preserving first-seen order, then join.
 * Used for zodIssueCodes: Ho(issues.map(c => c.code)).join(",")
 */
export function uniqueJoin(values: ReadonlyArray<string>, sep = ','): string {
  return [...new Set(values)].join(sep)
}

/**
 * densable y2r — redact PII-ish tokens before hashing free-text error messages.
 * Truncates to 500 chars; replaces urls/emails/keys/paths/uuids/long hex (as
 * `<id>`), base64 blobs, IPv4 addresses, and long numbers.
 */
export function redactForErrorMessageHash(message: string): string {
  return message
    .slice(0, 500)
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/\b[\w.+-]+@[\w.-]+\.\w{2,}\b/g, '<email>')
    .replace(
      /\b(?:sk-ant|sk|pk|ghp|gho|ghs|ghu|github_pat|xox[bpoars])[-_][\w-]{8,}\b/gi,
      '<key>',
    )
    .replace(/[A-Za-z]:\\[^\s"']*/g, '<path>')
    .replace(/\\\\[^\s"']+/g, '<path>')
    .replace(/(?:[^\s"'\\]+\\){2,}[^\s"']+/g, '<path>')
    .replace(/(?:\/[^\s"':]+){2,}/g, '<path>')
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      '<id>',
    )
    // densable: long hex → <id> (not a separate <hex> token)
    .replace(/\b[0-9a-fA-F]{16,}\b/g, '<id>')
    .replace(/\b[A-Za-z0-9+/]{32,}={0,2}/g, '<b64>')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>')
    .replace(/\b\d{4,}\b/g, '<num>')
}

/**
 * densable L2h — safe String() for analytics (never throws).
 */
export function safeStringifyForAnalytics(value: unknown): string {
  try {
    return String(value)
  } catch {
    return '[unstringifiable]'
  }
}

/**
 * densable PC/bu thin slice for tool analytics: hash redacted free-text
 * validation messages into error_message_hash (12 hex chars).
 */
export function hashErrorMessageForAnalytics(message: unknown): string {
  const text =
    message instanceof Error
      ? safeStringifyForAnalytics(message.message)
      : safeStringifyForAnalytics(message)
  return shortSha256Hex12(redactForErrorMessageHash(text))
}

/**
 * densable zt/_p — Node errno-style codes only (ENOENT, EACCES, …).
 */
export function nodeErrnoCodeForAnalytics(error: unknown): string | undefined {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    const code = (error as { code: string }).code
    if (/^[A-Z][A-Z0-9_]{0,63}$/.test(code)) {
      return code
    }
  }
  return undefined
}

/**
 * densable K_t — Error constructor name if plain PascalCase identifier.
 */
export function errorConstructorForAnalytics(
  error: unknown,
): string | undefined {
  if (!(error instanceof Error)) {
    return undefined
  }
  const name = error.constructor?.name
  if (typeof name === 'string' && /^[A-Z][a-zA-Z]*$/.test(name)) {
    return name
  }
  return undefined
}

/**
 * densable O2h + vXa — stack function-name chain + top file:line:col frame.
 */
export function stackFramesForAnalytics(stack: string): {
  names: string[]
  topFrame?: string
} {
  const names: string[] = []
  let topFrame: string | undefined
  for (const line of stack.slice(0, 4000).split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('at ')) {
      continue
    }
    const rest = trimmed.slice(3)
    const paren = rest.indexOf(' (')
    if (topFrame === undefined) {
      const loc = (paren !== -1 ? rest.slice(paren + 2, -1) : rest).match(
        /([^/\\]+:\d+:\d+)\)?$/,
      )
      if (loc?.[1] && /^[^/\\]+:\d+:\d+$/.test(loc[1])) {
        topFrame = loc[1]
      }
    }
    let fn = paren !== -1 ? rest.slice(0, paren) : rest
    fn = fn.replace(/^async\s+/, '').replace(/^new\s+/, '')
    if (fn.includes('/') || fn.includes('\\') || /:\d/.test(fn)) {
      continue
    }
    if (fn) {
      names.push(fn)
    }
    if (names.length >= 5) {
      break
    }
  }
  return { names, topFrame }
}

/**
 * densable PC — structured error analytics for tool.call catch path.
 * Always includes error_message_hash; optionally error_code / error_constructor /
 * error_stack_hash / error_top_frame. Empty object on failure.
 */
export function errorAnalyticsFromThrown(error: unknown): {
  error_message_hash?: string
  error_code?: string
  error_constructor?: string
  error_stack_hash?: string
  error_top_frame?: string
} {
  try {
    const text =
      error instanceof Error
        ? safeStringifyForAnalytics(error.message)
        : safeStringifyForAnalytics(error)
    const out: {
      error_message_hash?: string
      error_code?: string
      error_constructor?: string
      error_stack_hash?: string
      error_top_frame?: string
    } = {
      error_message_hash: shortSha256Hex12(redactForErrorMessageHash(text)),
    }
    const errno = nodeErrnoCodeForAnalytics(error)
    if (errno !== undefined) {
      out.error_code = errno
    }
    if (!(error instanceof Error)) {
      return out
    }
    const ctor = errorConstructorForAnalytics(error)
    if (ctor !== undefined) {
      out.error_constructor = ctor
    }
    if (typeof error.stack !== 'string') {
      return out
    }
    const { names, topFrame } = stackFramesForAnalytics(error.stack)
    if (names.length > 0) {
      out.error_stack_hash = shortSha256Hex12(names.join('|'))
    }
    if (topFrame !== undefined) {
      out.error_top_frame = topFrame
    }
    return out
  } catch {
    return {}
  }
}

/**
 * densable G/Z memory sample for tool_use success/error rss/heap/external deltas.
 */
export type ToolMemorySample = {
  rss: number
  heapUsed: number
  external: number
}

export function sampleToolMemoryUsage(): ToolMemorySample {
  try {
    const m = process.memoryUsage()
    return { rss: m.rss, heapUsed: m.heapUsed, external: m.external }
  } catch {
    return { rss: 0, heapUsed: 0, external: 0 }
  }
}

export function toolMemoryDeltasForAnalytics(
  before: ToolMemorySample,
  after: ToolMemorySample = sampleToolMemoryUsage(),
): {
  rssDeltaBytes: number
  heapUsedDeltaBytes: number
  externalDeltaBytes: number
} {
  return {
    rssDeltaBytes: after.rss - before.rss,
    heapUsedDeltaBytes: after.heapUsed - before.heapUsed,
    externalDeltaBytes: after.external - before.external,
  }
}

/**
 * djb2 string hash — fast non-cryptographic hash returning a signed 32-bit int.
 * Deterministic across runtimes (unlike Bun.hash which uses wyhash). Use as a
 * fallback when Bun.hash isn't available, or when you need on-disk-stable
 * output (e.g. cache directory names that must survive runtime upgrades).
 */
export function djb2Hash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return hash
}

/**
 * Hash arbitrary content for change detection. Bun.hash is ~100x faster than
 * sha256 and collision-resistant enough for diff detection (not crypto-safe).
 */
export function hashContent(content: string): string {
  if (typeof Bun !== 'undefined') {
    return Bun.hash(content).toString()
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('crypto') as typeof import('crypto')
  return crypto.createHash('sha256').update(content).digest('hex')
}

/**
 * Hash two strings without allocating a concatenated temp string. Bun path
 * seed-chains wyhash (hash(a) feeds as seed to hash(b)); Node path uses
 * incremental SHA-256 update. Seed-chaining naturally disambiguates
 * ("ts","code") vs ("tsc","ode") so no separator is needed under Bun.
 */
export function hashPair(a: string, b: string): string {
  if (typeof Bun !== 'undefined') {
    return Bun.hash(b, Bun.hash(a)).toString()
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('crypto') as typeof import('crypto')
  return crypto
    .createHash('sha256')
    .update(a)
    .update('\0')
    .update(b)
    .digest('hex')
}
