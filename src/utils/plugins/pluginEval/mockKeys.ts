/**
 * densable `Vi`/`lr`/`Lo`/`Ki`/`Uc`/`w3t`/`fg` — keys `pg` matches
 * relay answers against annotated tool_use.
 */
import { createHash } from 'crypto'
import { EVAL_ABORTED_BY_MOCK } from './constants.js'

/** densable `Ic` @212079328. */
const CANONICAL_DEPTH = 64
/** densable `$Ft`/`rI` @178551900. */
const TOOL_ERROR_CLIP = 10_000
const TOOL_ERROR_CLIP_SLACK = 1024
const TOOL_ERROR_CLIP_RE =
  /\n\n\.\.\. \[(\d+) characters truncated\] \.\.\.\n\n/g

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'null'
  } catch {
    return 'null'
  }
}

/** densable `Lo` @212079328. */
function canonicalize(value: unknown, depth = 0): unknown {
  if (depth > CANONICAL_DEPTH) {
    throw new RangeError('value nested too deep to canonicalize')
  }
  if (Array.isArray(value)) {
    return value.map(item => canonicalize(item, depth + 1))
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = Object.create(null)
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalize(
        (value as Record<string, unknown>)[key],
        depth + 1,
      )
    }
    return out
  }
  return value
}

/** densable `Vi`/`lr`. */
export function hashEvalJson(value: unknown): string {
  return createHash('sha256')
    .update(jsonText(canonicalize(value, 0)))
    .digest('hex')
}

/** densable `fg`. */
export function hashEvalInput(input: unknown): string {
  try {
    return hashEvalJson(input)
  } catch {
    return ''
  }
}

/** densable `Uc`. */
function clipToolError(text: string, max = TOOL_ERROR_CLIP): string {
  if (text.length <= max + TOOL_ERROR_CLIP_SLACK) return text
  const keep = Math.floor(max / 2)
  const omitted = text.length - keep * 2
  const middle = text.slice(keep, text.length - keep)
  let extra = 0
  for (const match of middle.matchAll(TOOL_ERROR_CLIP_RE)) {
    const n = (match[1] ?? '').length <= 15 ? Number(match[1]) : Number.NaN
    if (Number.isSafeInteger(n) && n >= (match[0]?.length ?? 0)) {
      extra += n - (match[0]?.length ?? 0)
    }
  }
  return `${text.slice(0, keep)}\n\n... [${omitted + extra} characters truncated] ...\n\n${text.slice(text.length - keep)}`
}

/** densable `w3t` @193071610. */
export function prefixMockAbortOutput(text: string): string {
  const trimmed = text.trimStart()
  const re = new RegExp(
    `^(?:${EVAL_ABORTED_BY_MOCK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|MCP server "|MCP error -32000: Connection closed)`,
  )
  return re.test(trimmed) ? `| ${trimmed}` : text
}

/** densable `Ki`. */
export function mockOutputKey(output: string, verdict: string): string {
  const trimmed = output.trim()
  return verdict === 'tool_error' ? clipToolError(trimmed) : trimmed
}

/** densable `$d` — sha256 of the stand-in spec JSON the child is launched with. */
export function hashEvalMockSpecJson(json: string): string {
  return createHash('sha256').update(json).digest('hex')
}
