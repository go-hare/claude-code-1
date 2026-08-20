/**
 * densable 2.1.235 #1 — prompt-input word tokenization for spellcheck (lhg).
 *
 * Skips inline/fenced code, CJK/Thai scripts, camelCase/identifiers,
 * and short / all-caps-ish tokens densable rejects.
 */

export type SpellcheckWordSpan = {
  word: string
  start: number
  end: number
}

const WORD_RE = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu
const CODE_RE = /(``+)[\s\S]*?(?:\1|$)|`[^`\n]*(?:`|\n|$)/g
const PUNCT_EDGE = String.raw`[\s.,;:!?"'‘’“”«»()[\]{}<>—–…*_~-]`
const STRIP_EDGE = new RegExp(`^${PUNCT_EDGE}+|${PUNCT_EDGE}+$`, 'gu')
const LEADING_QUOTES = /^["'‘’“”«»([{*_~]+/u
const IDENT_LIKE = /[0-9_/\\@#=<>{}[\]()|~^$%*+:;`]|\.\p{L}/u
const PATH_OR_TAG = /^(?:-|\.\p{L}|<\/?\p{L}[^<>]*>)/u
const CJK_LIKE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u

/** densable lhg */
export function tokenizeSpellcheckWords(text: string): SpellcheckWordSpan[] {
  const codeSpans: Array<{ start: number; end: number }> = []
  for (const m of text.matchAll(CODE_RE)) {
    codeSpans.push({ start: m.index!, end: m.index! + m[0].length })
  }

  const out: SpellcheckWordSpan[] = []
  let runStart = -1
  let runEnd = -1
  let runEligible = false
  let codeIdx = 0

  for (const m of text.matchAll(WORD_RE)) {
    const word = m[0]
    const start = m.index!
    const end = start + word.length

    while (codeIdx < codeSpans.length && codeSpans[codeIdx]!.end <= start) {
      codeIdx++
    }
    if (codeIdx < codeSpans.length && codeSpans[codeIdx]!.start < end) {
      continue
    }

    if (word.length < 2 || word.length > 64) continue
    // Reject CamelCase / ALLCAPS tails: densable requires slice(1) === lower(slice(1))
    if (word.slice(1) !== word.slice(1).toLowerCase()) continue
    if (CJK_LIKE.test(word)) continue

    if (start >= runEnd) {
      runStart = start
      while (runStart > 0 && !/\s/.test(text[runStart - 1]!)) runStart--
      runEnd = end
      while (runEnd < text.length && !/\s/.test(text[runEnd]!)) runEnd++
      const run = text.slice(runStart, runEnd)
      runEligible =
        !PATH_OR_TAG.test(run.replace(LEADING_QUOTES, '')) &&
        !IDENT_LIKE.test(run.replace(STRIP_EDGE, ''))
    }

    if (!runEligible) continue
    out.push({ word, start, end })
  }

  return out
}
