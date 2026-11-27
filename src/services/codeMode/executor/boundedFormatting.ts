/**
 * Bounded incremental serialization & REPL output elision (E3-P1-1).
 *
 * Enforces strict character and depth limits BEFORE/DURING serialization so
 * giant strings, deeply nested trees, or circular structures inside the VM
 * cannot exhaust host memory during `console.log` or script output formatting.
 */
import { REPL_PART_CAP } from '../constants.js'
import { MAX_FORMAT_DEPTH, MAX_LOG_ENTRY_CHARS } from './types.js'

/**
 * Official 2.1.328 (`On`/`Dr`/`REPL_PART_CAP`): cap long output parts at 30,000
 * characters using a 60% head / 40% tail elision so giant outputs don't blow up
 * context.
 */
export function elideReplOutputPart(
  text: string,
  cap: number = REPL_PART_CAP,
): string {
  if (text.length <= cap) return text
  const headLen = Math.floor(cap * 0.6)
  const tailLen = Math.max(0, cap - headLen)
  const omitted = text.length - headLen - tailLen
  return `${text.slice(0, headLen)}\n... [${omitted} characters elided] ...\n${text.slice(text.length - tailLen)}`
}

type BoundedFormatState = {
  chunks: string[]
  len: number
  maxChars: number
  truncated: boolean
  seen: Set<object>
}

function appendBounded(state: BoundedFormatState, text: string): boolean {
  if (state.truncated || text.length === 0) return !state.truncated
  const remaining = state.maxChars - state.len
  if (remaining <= 0) {
    state.truncated = true
    return false
  }
  if (text.length > remaining) {
    state.chunks.push(text.slice(0, remaining))
    state.len = state.maxChars
    state.truncated = true
    return false
  }
  state.chunks.push(text)
  state.len += text.length
  return true
}

function quoteBoundedJsonString(
  str: string,
  maxChars: number,
): {
  text: string
  truncated: boolean
} {
  if (str.length <= maxChars) {
    const quoted = JSON.stringify(str)
    if (quoted.length <= maxChars) {
      return { text: quoted, truncated: false }
    }
    return { text: quoted.slice(0, maxChars), truncated: true }
  }
  const sliced = str.slice(0, maxChars)
  const quoted = JSON.stringify(sliced)
  return {
    text: quoted.length > maxChars ? quoted.slice(0, maxChars) : quoted,
    truncated: true,
  }
}

function writeBoundedJsonValue(
  value: unknown,
  state: BoundedFormatState,
  depth: number,
): void {
  if (state.truncated) return
  if (value === null) {
    appendBounded(state, 'null')
    return
  }
  const t = typeof value
  if (t === 'string') {
    const remaining = Math.max(0, state.maxChars - state.len)
    const { text, truncated } = quoteBoundedJsonString(
      value as string,
      remaining,
    )
    appendBounded(state, text)
    if (truncated) state.truncated = true
    return
  }
  if (t === 'number') {
    appendBounded(
      state,
      Number.isFinite(value as number) ? String(value) : 'null',
    )
    return
  }
  if (t === 'boolean') {
    appendBounded(state, value ? 'true' : 'false')
    return
  }
  if (t === 'bigint') {
    appendBounded(state, `"${String(value)}n"`)
    return
  }
  if (t === 'undefined' || t === 'function' || t === 'symbol') {
    appendBounded(state, 'null')
    return
  }

  const obj = value as object
  const tag = Object.prototype.toString.call(obj)
  if (tag === '[object Date]') {
    try {
      const ms = (obj as Date).getTime()
      const iso = Number.isFinite(ms) ? new Date(ms).toISOString() : null
      appendBounded(state, iso !== null ? JSON.stringify(iso) : 'null')
    } catch {
      appendBounded(state, 'null')
    }
    return
  }
  if (state.seen.has(obj)) {
    appendBounded(state, '"[Circular]"')
    return
  }
  if (depth >= MAX_FORMAT_DEPTH) {
    appendBounded(state, '"[MaxDepth]"')
    return
  }

  state.seen.add(obj)
  try {
    const indent = '  '.repeat(depth + 1)
    const closingIndent = '  '.repeat(depth)

    if (Array.isArray(obj)) {
      const arr = obj as unknown[]
      if (arr.length === 0) {
        appendBounded(state, '[]')
        return
      }
      if (!appendBounded(state, '[\n')) return
      for (let i = 0; i < arr.length; i++) {
        if (i > 0 && !appendBounded(state, ',\n')) return
        if (!appendBounded(state, indent)) return
        let elem: unknown
        try {
          elem = arr[i]
        } catch {
          elem = '[Unreadable]'
        }
        writeBoundedJsonValue(elem, state, depth + 1)
        if (state.truncated) return
      }
      appendBounded(state, `\n${closingIndent}]`)
      return
    }

    let keys: string[]
    try {
      keys = Object.keys(obj)
    } catch {
      appendBounded(state, '{}')
      return
    }
    let wroteAny = false
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!
      let propVal: unknown
      try {
        propVal = (obj as Record<string, unknown>)[key]
      } catch {
        propVal = '[Unreadable]'
      }
      const pt = typeof propVal
      if (pt === 'undefined' || pt === 'function' || pt === 'symbol') {
        continue
      }
      if (!wroteAny) {
        if (!appendBounded(state, '{\n')) return
        wroteAny = true
      } else if (!appendBounded(state, ',\n')) {
        return
      }
      if (!appendBounded(state, indent)) return
      const keyRemaining = Math.max(0, state.maxChars - state.len)
      const quotedKey = quoteBoundedJsonString(key, keyRemaining)
      appendBounded(state, quotedKey.text)
      if (quotedKey.truncated) {
        state.truncated = true
        return
      }
      if (!appendBounded(state, ': ')) return
      writeBoundedJsonValue(propVal, state, depth + 1)
      if (state.truncated) return
    }
    if (!wroteAny) {
      appendBounded(state, '{}')
    } else {
      appendBounded(state, `\n${closingIndent}}`)
    }
  } finally {
    state.seen.delete(obj)
  }
}

export function formatValueBounded(
  value: unknown,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (value === undefined) return { text: '', truncated: false }
  if (typeof value === 'string') {
    if (value.length <= maxChars) return { text: value, truncated: false }
    return { text: value.slice(0, maxChars), truncated: true }
  }
  const t = typeof value
  if (t === 'bigint' || t === 'symbol' || t === 'function') {
    let raw: string
    try {
      raw = String(value)
    } catch {
      raw = '<unprintable>'
    }
    if (raw.length <= maxChars) return { text: raw, truncated: false }
    return { text: raw.slice(0, maxChars), truncated: true }
  }
  const state: BoundedFormatState = {
    chunks: [],
    len: 0,
    maxChars,
    truncated: false,
    seen: new Set<object>(),
  }
  writeBoundedJsonValue(value, state, 0)
  return { text: state.chunks.join(''), truncated: state.truncated }
}

export function formatArgsBounded(
  args: readonly unknown[],
  maxChars: number,
): { text: string; truncated: boolean } {
  const parts: string[] = []
  let used = 0
  let truncated = false
  for (let i = 0; i < args.length; i++) {
    if (i > 0) {
      if (used >= maxChars) {
        truncated = true
        break
      }
      parts.push(' ')
      used += 1
    }
    const remaining = maxChars - used
    if (remaining <= 0) {
      if (args[i] !== undefined) truncated = true
      break
    }
    const formatted = formatValueBounded(args[i], remaining)
    parts.push(formatted.text)
    used += formatted.text.length
    if (formatted.truncated) {
      truncated = true
      break
    }
  }
  return { text: parts.join(''), truncated }
}

export function formatValueForOutput(
  value: unknown,
  maxChars = MAX_LOG_ENTRY_CHARS,
): string {
  const { text, truncated } = formatValueBounded(value, maxChars)
  if (!truncated) return text
  const suffix = '... [truncated]'
  if (maxChars <= suffix.length) return text.slice(0, maxChars)
  return `${text.slice(0, maxChars - suffix.length)}${suffix}`
}
