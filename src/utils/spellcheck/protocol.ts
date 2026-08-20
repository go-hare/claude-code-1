/**
 * densable 2.1.235 #1 — ispell `-a` protocol helpers (zTu / qTu / WTu / GTu / vKe / hs_).
 */

export const SPELLCHECK_CHECKERS = ['aspell', 'hunspell', 'ispell'] as const

export type SpellcheckCheckerName = (typeof SPELLCHECK_CHECKERS)[number]

export type SpellcheckCheckerOrAuto = SpellcheckCheckerName | 'auto'

/** densable hs_ — plain dictionary name validator. */
export const SPELLCHECK_LANGUAGE_RE = /^[A-Za-z][A-Za-z0-9_.,-]{0,63}$/

/** densable jTu — terse/version handshake after banner. */
export const SPELLCHECK_TERSE_HANDSHAKE = '!\n'

export function isSpellcheckLanguageName(value: string): boolean {
  return SPELLCHECK_LANGUAGE_RE.test(value)
}

export function isSpellcheckCheckerName(
  value: string,
): value is SpellcheckCheckerName {
  return (SPELLCHECK_CHECKERS as readonly string[]).includes(value)
}

/** densable rdE — normalize checker setting; unknown → auto + log caller. */
export function normalizeSpellcheckChecker(
  value: string | undefined,
): SpellcheckCheckerOrAuto {
  if (value === undefined || value === 'auto') return 'auto'
  if (isSpellcheckCheckerName(value)) return value
  return 'auto'
}

/** densable zTu — argv for aspell/hunspell/ispell `-a` mode. */
export function buildSpellcheckArgs(
  checker: SpellcheckCheckerName,
  language: string | undefined,
): string[] {
  const lang =
    language !== undefined && isSpellcheckLanguageName(language)
      ? language
      : undefined
  switch (checker) {
    case 'aspell':
      return [
        '-a',
        '--encoding=utf-8',
        '--sug-mode=ultra',
        ...(lang ? [`--lang=${lang}`] : []),
      ]
    case 'hunspell':
      return ['-a', '-i', 'utf-8', ...(lang ? ['-d', lang] : [])]
    case 'ispell':
      return ['-a', ...(lang ? ['-d', lang] : [])]
  }
}

/** densable qTu — parse ispell-family banner → backend name. */
export function parseSpellcheckBanner(
  line: string,
): SpellcheckCheckerName | null {
  if (!line.startsWith('@(#) International Ispell')) return null
  if (/but really Aspell/i.test(line)) return 'aspell'
  if (/but really Hunspell/i.test(line)) return 'hunspell'
  return 'ispell'
}

/** densable WTu — pipe a batch of words (`^word1 word2…\n`). */
export function formatSpellcheckRequest(words: string[]): string {
  return `^${words.join(' ')}\n`
}

export type SpellcheckResponseLine =
  | { type: 'end' }
  | { type: 'correct' }
  | { type: 'misspelled'; word: string }
  | { type: 'unrecognized' }

/** densable GTu — parse one checker stdout line. */
export function parseSpellcheckResponseLine(
  line: string,
): SpellcheckResponseLine {
  if (line === '') return { type: 'end' }
  switch (line[0]) {
    case '*':
    case '+':
    case '-':
      return { type: 'correct' }
    case '&':
    case '?': {
      const m = /^[&?] (\S+) \d+ \d+:/.exec(line)
      return m ? { type: 'misspelled', word: m[1]! } : { type: 'unrecognized' }
    }
    case '#': {
      const m = /^# (\S+) \d+/.exec(line)
      return m ? { type: 'misspelled', word: m[1]! } : { type: 'unrecognized' }
    }
    default:
      return { type: 'unrecognized' }
  }
}
