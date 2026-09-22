/**
 * densable 2.1.248 #27 `tr` @189629037 sha=11305159c34f83fe —
 * strip DECSET / OSC / C0 from a bg streamTail before `claude logs` writes
 * it. Mouse tracking, bracketed paste, and alt-screen (`?1000h` / `?2004h` /
 * `?1049h`) are consumed and not replayed. CUP/HVP stay; `?1049/1047/47 h`
 * sets cursorAddressed so Pmr can park the caret.
 *
 * Gold helpers in the same module:
 *   go / ho / _o / wo / bo / ko @189628544
 *   SI @181098470 sha=30f8d643b6bf3bd8  CUP via Rp(..., "H")
 */

/** CSI finals kept in replay (gold `go`). */
const KEEP_CSI_FINALS = new Set('ABCDEFGHJKLMPSTXZ@`adefm')

/** ED (`J`) params that may stay (gold `ho`). */
const KEEP_ED_PARAMS = new Set([0, 1, 2])

/** Single-char ESC sequences kept (gold `_o`: DECSC/DECRC/IND/NEL/RI). */
const KEEP_ESC = new Set('78DEM')

/**
 * DECSET modes that mark cursorAddressed (gold `wo`).
 * These are alt-screen — not mouse / bracketed-paste.
 */
const CURSOR_ADDRESSED_DECSET = new Set(['1049', '1047', '47'])

const STREAM_TOKEN_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: gold `bo` CSI/ESC tokenizer
  /\x1b\[(?<params>[<-?]?[0-;]*)(?<intermediates>[ -/]*)(?<final>[@-~])|\x1b[\]PX^_][^\x07\x18\x1a\x1b\x9c]*(?:\x07|\x1b\\|\x9c)?|\x1b(?:\[[0-?]*[ -/]*|[ -/]*)$|\x1b(?<esc>[ -/]*[0-~])|\x1b|[\x00-\x07\x0e-\x1a\x1c-\x1f\x7f-\x9f]/g

/** Gold `ko` @189628829 sha=6dae7f55d1c6d10f */
function keepCsi(params: string, final: string): boolean {
  if (!KEEP_CSI_FINALS.has(final)) return false
  if (final !== 'J' && final !== 'T') return true
  const nums = params
    .split(';')
    .map(p => (/^\d*$/.test(p) ? Number(p) : Number.NaN))
  return final === 'J'
    ? nums.every(n => KEEP_ED_PARAMS.has(n))
    : nums.length === 1 && !Number.isNaN(nums[0])
}

export type BgLogsReplay = {
  replay: string
  cursorAddressed: boolean
}

/** Gold `tr(e)` — replay + cursorAddressed from joined streamTail. */
export function replayBgLogsStream(input: string): BgLogsReplay {
  let cursorAddressed = false
  let replay = ''
  let cursor = 0
  for (const match of input.matchAll(STREAM_TOKEN_RE)) {
    replay += input.slice(cursor, match.index)
    cursor = match.index + match[0].length
    const { params = '', intermediates, final, esc } = match.groups ?? {}
    if (final !== undefined) {
      const lead = params[0]
      const isPrivate =
        lead === '?' || lead === '>' || lead === '<' || lead === '='
      if (lead === '?' && final === 'h') {
        for (const mode of params.slice(1).split(';')) {
          if (CURSOR_ADDRESSED_DECSET.has(mode)) cursorAddressed = true
        }
      } else if (!isPrivate && !intermediates && keepCsi(params, final)) {
        if (final === 'H' || final === 'f') cursorAddressed = true
        replay += match[0]
      }
    } else if (esc !== undefined && esc.length === 1 && KEEP_ESC.has(esc)) {
      replay += match[0]
    }
  }
  return {
    replay: replay + input.slice(cursor),
    cursorAddressed,
  }
}

/** Gold `SI(t,r)` = Rp(t, r, "H") → CSI row;col H */
export function cursorAddress(row: number, col: number): string {
  return `\x1B[${row};${col}H`
}

/**
 * Gold Pmr TTY suffix: `"\\x1B[0m"+(d?SI(u,1)+\\n:"")`
 * Non-TTY: empty. rows default 9999 matches `process.stdout.rows||9999`.
 */
export function formatClaudeLogsReplay(
  streamTail: readonly string[],
  isTTY: boolean,
  rows: number,
): string {
  const { replay, cursorAddressed } = replayBgLogsStream(streamTail.join(''))
  const suffix = isTTY
    ? `\x1B[0m${cursorAddressed ? `${cursorAddress(rows, 1)}\n` : ''}`
    : ''
  return replay + suffix
}
