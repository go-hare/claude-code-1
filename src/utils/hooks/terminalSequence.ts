/**
 * densable 2.1.289 QWn / hxe / yxe / imt @187836506.
 *
 * Hook JSON `terminalSequence` allowlist: OSC 0/1/2/9/99/777 and BEL.
 * OSC 9 bodies may not begin with a digit unless they are the 9;4 progress form.
 * Parsed sequences are rewritten and emitted through the last registered writer.
 */

const ALLOWED_OSC_PS = new Set([0, 1, 2, 9, 99, 777])
const MAX_UTF8_BYTES = 4096
const BEL = '\x07'
const ESC = '\x1b'

type ParsedSeq = { kind: 'bel' } | { kind: 'osc'; ps: number; payload: string }

function stripC1(payload: string): string {
  let out = ''
  for (let i = 0; i < payload.length; i++) {
    const code = payload.charCodeAt(i)
    if (code >= 32 && code !== 127 && !(code >= 128 && code <= 159)) {
      out += payload[i]
    }
  }
  return out
}

/** densable XWn — OSC 9 payload: 9;4 progress, else must not start with a digit. */
const OSC9_DIGIT_LEAD = /^[\s\u180e\u200b]*[+-]?\p{Nd}/u

function isAllowedOsc9Payload(payload: string): boolean {
  if (/^4;[0-4](;(100|\d{1,2})?)?$/.test(payload)) {
    return true
  }
  return !OSC9_DIGIT_LEAD.test(payload)
}

function encodeOsc(ps: number, payload: string): string {
  return `${ESC}]${ps};${payload}${BEL}`
}

/** densable QWn — parse a concatenated allowlisted sequence. */
export function parseTerminalSequenceTokens(raw: string): ParsedSeq[] | null {
  if (raw.length === 0) {
    return null
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_UTF8_BYTES) {
    return null
  }
  const tokens: ParsedSeq[] = []
  let i = 0
  while (i < raw.length) {
    const ch = raw[i]
    if (ch === BEL) {
      tokens.push({ kind: 'bel' })
      i++
      continue
    }
    if (ch !== ESC || raw[i + 1] !== ']') {
      return null
    }
    let cursor = i + 2
    let end = -1
    let termLen = 0
    while (cursor < raw.length) {
      if (raw[cursor] === BEL) {
        end = cursor
        termLen = 1
        break
      }
      if (raw[cursor] === ESC && raw[cursor + 1] === '\\') {
        end = cursor
        termLen = 2
        break
      }
      if (raw[cursor] === ESC) {
        return null
      }
      cursor++
    }
    if (end === -1) {
      return null
    }
    const body = raw.slice(i + 2, end)
    const semi = body.indexOf(';')
    const psText = semi === -1 ? body : body.slice(0, semi)
    const payloadRaw = semi === -1 ? '' : body.slice(semi + 1)
    if (!/^\d+$/.test(psText)) {
      return null
    }
    const ps = Number(psText)
    if (!ALLOWED_OSC_PS.has(ps)) {
      return null
    }
    const payload = stripC1(payloadRaw)
    if (ps === 9 && !isAllowedOsc9Payload(payload)) {
      return null
    }
    tokens.push({ kind: 'osc', ps, payload })
    i = end + termLen
  }
  return tokens
}

/** densable hxe — allowlist + rewrite, or null if rejected. */
export function parseAllowedTerminalSequence(raw: string): string | null {
  const tokens = parseTerminalSequenceTokens(raw)
  if (tokens === null) {
    return null
  }
  return tokens
    .map(token =>
      token.kind === 'bel' ? BEL : encodeOsc(token.ps, token.payload),
    )
    .join('')
}

const REJECTED_TERMINAL_SEQUENCE =
  'returned a terminalSequence that was rejected by the allowlist (only OSC 0/1/2/9/99/777 and BEL are permitted, and OSC 9 bodies may not begin with a digit unless in the 9;4 progress form)'

export function rejectedTerminalSequenceMessage(
  hookName: string,
  hookEvent: string,
): string {
  return `Hook ${hookName} (${hookEvent}) ${REJECTED_TERMINAL_SEQUENCE}`
}

type TerminalSequenceWriter = (sequence: string) => void

/** densable imt — last-registered writer wins. */
const writers: TerminalSequenceWriter[] = []

/** densable SOr. `null` resets the stack (gold `_ee().reset()`). */
export function registerTerminalSequenceWriter(
  writer: TerminalSequenceWriter | null,
): void {
  if (writer === null) {
    writers.length = 0
    return
  }
  writers.push(writer)
}

/** densable bOr. */
export function unregisterTerminalSequenceWriter(
  writer: TerminalSequenceWriter,
): void {
  const idx = writers.lastIndexOf(writer)
  if (idx >= 0) {
    writers.splice(idx, 1)
  }
}

/** densable yxe. */
export function emitTerminalSequence(sequence: string): void {
  writers.at(-1)?.(sequence)
}

function defaultStdoutWriter(sequence: string): void {
  // The default sink shares stdout with SDK JSON/NDJSON. Only terminals may
  // receive control sequences; explicit UI writers retain their own routing.
  if (process.stdout.isTTY) process.stdout.write(sequence)
}

if (process.stdout?.writable) {
  registerTerminalSequenceWriter(defaultStdoutWriter)
}
