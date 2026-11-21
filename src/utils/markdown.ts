import chalk from 'chalk'
import { marked, Tokenizer, type Token, type Tokens } from 'marked'
import stripAnsi from 'strip-ansi'
import { color } from '@anthropic/ink'
import { BLOCKQUOTE_BAR } from '../constants/figures.js'
import {
  mayWriteRawUrlHyperlink,
  stringWidth,
  supportsHyperlinks,
} from '@anthropic/ink'
import {
  createHyperlink,
  HYPERLINK_STYLE_RESET,
  OSC8_END,
  OSC8_START,
} from '../utils/hyperlink.js'
import { sanitizeMarkdownHref } from './markdownFileUrl.js'
import type { CliHighlight } from './cliHighlight.js'
import { logForDebugging } from './debug.js'
import { supportsStrikethrough } from './forceStrikethrough.js'

import { stripPromptXMLTags } from './messages.js'
import type { ThemeName } from './theme.js'

// Use \n unconditionally — os.EOL is \r\n on Windows, and the extra \r
// breaks the character-to-segment mapping in applyStylesToWrappedText,
// causing styled text to shift right.
const EOL = '\n'

/**
 * densable OIl — nest indent width cap for markdown lists (depth 3+).
 * ANSI child indent = spaces(min(hangingPrefix.length, OIl));
 * Ink nested indent = min(indent + markerCell, OIl).
 */
export const LIST_INDENT_CAP = 32

/** densable qIl — Ink marker cell minWidth. */
export const LIST_MARKER_MIN_WIDTH = 2

/** densable Krh — Ink list content minWidth upper bound. */
export const LIST_CONTENT_MIN_WIDTH_CAP = 10

/** densable Yno — columns reserved beside marker when sizing list content. */
export const LIST_COLUMN_SAFETY_MARGIN = 4

/** densable zIl / r6T — Ink list layout eligibility caps. */
export const LIST_INK_MAX_NODES = 300
export const LIST_INK_MAX_DEPTH = 64

/**
 * densable `uq` — invisible / control code points stripped from markdown
 * href display (`d0l`) and OSC8 post-process paths.
 */
export function isMarkdownInvisibleCodePoint(cp: number): boolean {
  return (
    cp <= 31 ||
    (cp >= 127 && cp <= 159) ||
    cp === 173 ||
    cp === 1564 ||
    (cp >= 8203 && cp <= 8207) ||
    cp === 8232 ||
    cp === 8233 ||
    (cp >= 8234 && cp <= 8238) ||
    (cp >= 8288 && cp <= 8297) ||
    (cp >= 65024 && cp <= 65039) ||
    cp === 65279 ||
    (cp >= 65529 && cp <= 65531) ||
    (cp >= 917504 && cp <= 917999)
  )
}

/**
 * densable `d0l` — strip invisibles + U+29C9 from href text shown beside /
 * as OSC8 targets so unusual Unicode in URLs cannot bloat layout.
 */
export function stripMarkdownHrefInvisibles(href: string): string {
  return Array.from(href)
    .filter(ch => {
      const cp = ch.codePointAt(0) ?? 0
      return cp !== 10697 && !isMarkdownInvisibleCodePoint(cp)
    })
    .join('')
}

// Official 2.1.295 (#392): Ue / Wt / $t — strip raw OSC 8 hyperlink sequences
// and stray 8-bit/ESC introducers so untrusted replies cannot draw hidden
// clickable links.
const RAW_OSC8_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional OSC 8 match
  /\x1b\]8;[^;\x07\x1b]*;[^\x07\x1b]*(?:\x07|\x1b\\)/g
const STRAY_OSC_C1_RE = /\x9d/g
const NON_CSI_ESC_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional non-CSI ESC match
  /\x1b(?!\[)/g

export function stripRawOsc8Sequences(text: string): string {
  if (!text.includes('\x1b') && !text.includes('\x9d')) return text
  return text
    .replace(RAW_OSC8_RE, '')
    .replace(STRAY_OSC_C1_RE, '')
    .replace(NON_CSI_ESC_RE, '')
}

/**
 * Official 2.1.328 (#556) `N = 1000`, `Te = 100`, `Ee = N * Te = 100_000`:
 * freeze guards for very long or malformed markdown inputs.
 */
export const MARKDOWN_WINDOW_LINES = 1000
export const MARKDOWN_WINDOW_AVG_LINE_CHARS = 100
export const MAX_MARKDOWN_LINE_LENGTH =
  MARKDOWN_WINDOW_LINES * MARKDOWN_WINDOW_AVG_LINE_CHARS

/** Official 2.1.328 (#556) `F(e)`: true if any single line exceeds `maxLineLength`. */
export function hasOverlongMarkdownLine(
  text: string,
  maxLineLength: number = MAX_MARKDOWN_LINE_LENGTH,
): boolean {
  let start = 0
  while (start < text.length) {
    const nl = text.indexOf('\n', start)
    const end = nl === -1 ? text.length : nl
    if (end - start > maxLineLength) return true
    start = end + 1
  }
  return false
}

/**
 * Official 2.1.328 (#556) `O(e, t, n)`: advance up to `maxLines` newlines OR
 * `maxLines * MARKDOWN_WINDOW_AVG_LINE_CHARS` chars from `start`.
 */
export function sliceMarkdownWindowEnd(
  text: string,
  start: number,
  maxLines: number = MARKDOWN_WINDOW_LINES,
): number {
  let pos = start
  const maxChars = maxLines * MARKDOWN_WINDOW_AVG_LINE_CHARS
  for (
    let i = 0;
    i < maxLines && pos < text.length && pos - start < maxChars;
    i++
  ) {
    const nl = text.indexOf('\n', pos)
    pos = nl === -1 ? text.length : nl + 1
  }
  return pos
}

function makePlainParagraphToken(raw: string): Token {
  return {
    type: 'paragraph',
    raw,
    text: raw,
    tokens: [{ type: 'text', raw, text: raw }],
  } as Token
}

/**
 * Official 2.1.328 (#556) `E2t`/`ut`: lex markdown safely with freeze guards:
 * 1. Any single line > `MAX_MARKDOWN_LINE_LENGTH` (100k chars) bypasses
 *    `marked.lexer` and renders as plain text to avoid catastrophic regex
 *    backtracking.
 * 2. Multi-window inputs (> 1000 lines or > 100k chars) split at blank-line
 *    boundaries outside fenced code blocks, falling back to newline boundaries
 *    within each bounded window so inputs with zero blank lines (huge malformed
 *    tables/lists/paragraphs) never feed unbounded text to `marked.lexer`.
 * 3. `RangeError` or unexpected parser failure degrades cleanly to plain text.
 */
export function lexMarkdownSafely(
  lexer: { lexer: (src: string) => Token[] },
  content: string,
): Token[] {
  const normalized = content.replace(/\r\n?/g, '\n')
  if (hasOverlongMarkdownLine(normalized)) {
    return [makePlainParagraphToken(normalized)]
  }
  try {
    const firstWindowEnd = sliceMarkdownWindowEnd(
      normalized,
      0,
      MARKDOWN_WINDOW_LINES,
    )
    if (firstWindowEnd >= normalized.length) {
      return lexer.lexer(normalized)
    }

    const tokens: Token[] = []
    let pos = 0
    while (pos < normalized.length) {
      let winEnd = sliceMarkdownWindowEnd(
        normalized,
        pos,
        MARKDOWN_WINDOW_LINES,
      )
      if (winEnd <= pos) {
        // Safety against degenerate non-advancing slice
        const nl = normalized.indexOf('\n', pos)
        winEnd = nl === -1 ? normalized.length : nl + 1
      }
      if (winEnd < normalized.length) {
        // Prefer splitting on a blank line (`\n\n`) inside the window when not
        // inside an open fence, so valid blocks stay intact across windows.
        const chunk = normalized.slice(pos, winEnd)
        let inFence = false
        let fenceChar = ''
        let lastBlankEnd = -1
        let lineStart = 0
        while (lineStart < chunk.length) {
          const nl = chunk.indexOf('\n', lineStart)
          const lineEnd = nl === -1 ? chunk.length : nl
          const line = chunk.slice(lineStart, lineEnd)
          const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line)
          if (fenceMatch) {
            const ch = fenceMatch[1]![0]!
            if (!inFence) {
              inFence = true
              fenceChar = ch
            } else if (ch === fenceChar) {
              inFence = false
              fenceChar = ''
            }
          } else if (!inFence && line.trim() === '' && nl !== -1) {
            lastBlankEnd = nl + 1
          }
          lineStart = nl === -1 ? chunk.length : nl + 1
        }
        if (lastBlankEnd > 0) {
          winEnd = pos + lastBlankEnd
        }
      }
      const slice = normalized.slice(pos, winEnd)
      if (hasOverlongMarkdownLine(slice)) {
        tokens.push(makePlainParagraphToken(slice))
      } else {
        const chunkTokens = lexer.lexer(slice)
        for (const tok of chunkTokens) {
          const prev = tokens.at(-1)
          if (prev?.type === 'space' && tok.type === 'space') {
            prev.raw += tok.raw
          } else {
            tokens.push(tok)
          }
        }
      }
      pos = winEnd
    }
    return tokens
  } catch (err) {
    if (err instanceof RangeError) {
      logForDebugging(`marked.lexer overflow on ${content.length} chars`, {
        level: 'error',
      })
    }
    return [makePlainParagraphToken(normalized)]
  }
}

/**
 * densable `PPE` — escape unescaped `|` inside matching backtick spans so
 * GFM table tokenization does not treat code-cell pipes as column separators
 * (SEA CXr / j6m.table; changelog 2.1.234 #10).
 * Official 2.1.328 (#556): linear-time O(N) backtick index prevents quadratic
 * freezes on malformed lines containing thousands of unmatched backticks.
 */
export function escapePipesInInlineCode(line: string): string {
  if (!line.includes('`') || !line.includes('|')) return line
  if (line.length > MAX_MARKDOWN_LINE_LENGTH) return line
  // Pre-index all backtick runs by length so closing lookup is O(1) amortized.
  const runsByLen = new Map<number, number[]>()
  const runPtrByLen = new Map<number, number>()
  let scan = 0
  while (scan < line.length) {
    if (line[scan] !== '`') {
      scan++
      continue
    }
    const start = scan
    while (line[scan] === '`') scan++
    const len = scan - start
    let arr = runsByLen.get(len)
    if (!arr) {
      arr = []
      runsByLen.set(len, arr)
      runPtrByLen.set(len, 0)
    }
    arr.push(start)
  }

  let out = ''
  let i = 0
  while (i < line.length) {
    if (line[i] !== '`') {
      out += line[i++]
      continue
    }
    let tickLen = 0
    while (line[i + tickLen] === '`') tickLen++
    const open = line.slice(i, i + tickLen)
    const positions = runsByLen.get(tickLen)
    let ptr = runPtrByLen.get(tickLen) ?? 0
    let closeAt = -1
    if (positions) {
      while (ptr < positions.length && positions[ptr]! <= i) ptr++
      runPtrByLen.set(tickLen, ptr)
      if (ptr < positions.length) {
        closeAt = positions[ptr]!
        runPtrByLen.set(tickLen, ptr + 1)
      }
    }
    if (closeAt === -1) {
      out += open
      i += tickLen
      continue
    }
    out += open
    for (let j = i + tickLen; j < closeAt; j++) {
      const ch = line[j]!
      if (ch !== '|') {
        out += ch
        continue
      }
      let backslashes = 0
      while (line[j - 1 - backslashes] === '\\') backslashes++
      out += backslashes % 2 === 0 ? '\\|' : '|'
    }
    out += open
    i = closeAt + tickLen
  }
  return out
}

/** densable `MPE` — split a table row on unescaped pipes. */
function splitMarkdownTableRow(line: string): string[] {
  const cells = line
    .replace(/\|/g, (pipe, index, whole) => {
      let escaped = false
      let k = index
      while (--k >= 0 && whole[k] === '\\') escaped = !escaped
      return escaped ? '|' : ' |'
    })
    .split(/ \|/)
  if (!cells[0]?.trim()) cells.shift()
  if (cells.length > 0 && !cells.at(-1)?.trim()) cells.pop()
  return cells
}

/**
 * densable `DPE` — true when any body row (from line index 2) has more
 * non-empty cells beyond the header width after PPE.
 */
export function markdownTableHasExtraColumns(
  ppeLines: string[],
  headerLen: number,
): boolean {
  for (let r = 2; r < ppeLines.length; r++) {
    const cells = splitMarkdownTableRow(ppeLines[r]!)
    for (let c = headerLen; c < cells.length; c++) {
      if (cells[c]!.trim()) return true
    }
  }
  return false
}

// densable `N6m` — stock marked Tokenizer prototypes before overrides.
const stockMarkdownTable = Tokenizer.prototype.table
const stockMarkdownBlockquote = Tokenizer.prototype.blockquote
const stockMarkdownList = Tokenizer.prototype.list
const stockMarkdownEmStrong = Tokenizer.prototype.emStrong

/**
 * Official 2.1.295 (#409) `It()` / `F` — cap recursive lexer nesting
 * (blockquote/list/emStrong) at 100 levels so deeply nested quotes do not
 * freeze the terminal or exhaust memory.
 */
export const MAX_LEXER_NESTING_DEPTH = 100
const lexerNestingDepths = new WeakMap<object, number>()

function isAtMaxLexerNesting(lexer: object): boolean {
  return (lexerNestingDepths.get(lexer) ?? 0) >= MAX_LEXER_NESTING_DEPTH
}

function lexAtLevel<T>(lexer: object, fn: () => T): T | undefined {
  if (isAtMaxLexerNesting(lexer)) return undefined
  const depth = lexerNestingDepths.get(lexer) ?? 0
  lexerNestingDepths.set(lexer, depth + 1)
  try {
    return fn()
  } finally {
    lexerNestingDepths.set(lexer, depth)
  }
}

const NESTED_BLOCK_MARKER_RE = /^[ \t>]+/gm
const INLINE_WHITESPACE_RUN_RE = /[ \t]+/g
const TRIPLE_NEWLINE_RE = /\n{3,}/g

function flattenNestedBlockMarkers(src: string): string {
  return src
    .replace(NESTED_BLOCK_MARKER_RE, m =>
      m.replace(INLINE_WHITESPACE_RUN_RE, ' ').trimStart(),
    )
    .replace(TRIPLE_NEWLINE_RE, '\n\n')
    .trimEnd()
}

function fallbackAtMaxNesting(
  tokenizer: Tokenizer,
  src: string,
): { raw: string; text: string; tokens: Token[] } | undefined {
  if (
    !isAtMaxLexerNesting(tokenizer.lexer) ||
    !(
      tokenizer.rules.block.list.test(src) ||
      tokenizer.rules.other.blockquoteStart.test(src)
    )
  ) {
    return undefined
  }
  const text = flattenNestedBlockMarkers(src)
  return { raw: src, text, tokens: tokenizer.lexer.inline(text) }
}

let markedConfigured = false

const HTTP_URL_RE = /^https?:\/\/[\w\-.~:/?#[\]@!$&'()*+,;=%]+$/i

export type FormatTokenOptions = {
  listIndent?: string
  glueProse?: boolean
  screenReader?: boolean
  promptMode?: boolean
  quotesAround?: number
  linkCap?: boolean
  windowed?: boolean
}

const WRAPPED_BACKSLASH_PAIRS: Record<string, string> = {
  '"': '"',
  "'": "'",
  ')': '(',
  ']': '[',
  '}': '{',
  '>': '<',
}
const WRAPPED_BACKSLASH_CONTINUES_RE = /^\\.[\p{L}\p{N}\\*_`~]/u
const WRAPPED_BACKSLASH_WORD_BEFORE_RE = /[\p{L}\p{N}].$/u

// Official 2.1.326 (#150): preserve Windows path backslashes before folders
// like `.claude` or `_build` so marked's escape tokenizer doesn't eat `\`.
const WIN_PATH_SEG_RE = /^\\[._\-[({$@#~!%+*]+(?=[\p{L}\p{N}\\])/u
const WIN_PATH_PREV_RE = /\\[^\s\\]+(?: [^\s\\]+){0,2}$/
const WIN_PATH_CONT_RE = /^\\[^\s\\]+\\[\p{L}\p{N}]/u
const WIN_PATH_ALNUM_END_RE = /[\p{L}\p{N}]$/u
const WIN_PATH_ROOT_RE =
  /[\s("'[](?:[a-z]:|\.\.?|~|%\w+%|\$env:\w+|\$HOME)\\[._]$/i

// Official 2.1.326 (#151): CJK bold text starting or ending with punctuation
// (e.g. 日本語**「重要」**です, **（注意）**してください).
const CJK_CHAR_CLASS = String.raw`[\p{sc=Han}\p{sc=Hangul}\u3001-\u31ff\uff01-\uffe6]`
export const CJK_BOLD_OPEN_RE = new RegExp(
  `^(?:${CJK_CHAR_CLASS}\\*{2,3}[^\\s*]|[^\\s*]\\*{2,3}${CJK_CHAR_CLASS})`,
  'u',
)
const CJK_TERM_RE = String.raw`(?![.:!?][!-~])[\p{Term}\p{Pe}\p{Pf}\u30FB]`
const CJK_OPEN_PAREN_RE = String.raw`[(（](?![^*]*[)）]\*)`
const CJK_NOT_BOLD_OPEN_RE = new RegExp(
  String.raw`^\*+(?:["']?(?:\s|$|${CJK_TERM_RE})|${CJK_OPEN_PAREN_RE})`,
  'u',
)
const CJK_CHAR_RE = new RegExp(CJK_CHAR_CLASS, 'u')
const OPEN_PUNCT_RE = /\p{Ps}/u

function canCloseCjkBold(
  prevChar: string,
  delimLen: number,
  nextChar: string,
): boolean {
  if (delimLen !== 2 && delimLen !== 3) return false
  if (!prevChar || /\s/.test(prevChar) || OPEN_PUNCT_RE.test(prevChar)) {
    return false
  }
  return CJK_CHAR_RE.test(prevChar + nextChar)
}

export function tokenizeCjkEmStrong(
  tokenizer: Tokenizer,
  src: string,
  maskedSrc: string,
  prevChar = '',
): Tokens.Em | Tokens.Strong | undefined {
  const isCjkOpen =
    CJK_BOLD_OPEN_RE.test(prevChar + src.slice(0, 5)) &&
    !CJK_NOT_BOLD_OPEN_RE.test(src)
  const stock = stockMarkdownEmStrong.call(
    tokenizer,
    src,
    maskedSrc,
    isCjkOpen ? '' : prevChar,
  )
  const openMatch = /^(\*{2,3})(?!\*)/.exec(src)
  if (!openMatch) return stock
  const delim = openMatch[1]!
  const delimLen = delim.length
  const firstInner = src[delimLen]
  if (!firstInner || /\s/.test(firstInner) || CJK_NOT_BOLD_OPEN_RE.test(src)) {
    return stock
  }

  // Scan aligned maskedSrc (`maskedSrc` is the full paragraph; its tail of
  // length `src.length` aligns 1:1 with `src`, matching marked's own
  // `t.slice(-1 * e.length)` indexing) for the earliest matching closing
  // ** / *** with a CJK punctuation boundary. Prefer an earlier CJK close over
  // a greedier stock match that skipped a CJK-punctuation-adjacent closer
  // (e.g. `请看**中文（测试）**和**重点！**继续`).
  const alignedMasked =
    maskedSrc.length >= src.length ? maskedSrc.slice(-src.length) : src
  const maxEnd = stock ? stock.raw.length : Number.POSITIVE_INFINITY
  let idx = delimLen
  while (idx < alignedMasked.length) {
    const closeAt = alignedMasked.indexOf(delim, idx)
    if (closeAt === -1) break
    const candidateEnd = closeAt + delimLen
    if (candidateEnd >= maxEnd) break
    // Skip longer runs like ****
    if (
      alignedMasked[closeAt - 1] === '*' ||
      alignedMasked[closeAt + delimLen] === '*'
    ) {
      idx = closeAt + 1
      continue
    }
    const beforeClose = src[closeAt - 1] ?? ''
    const afterClose = src[closeAt + delimLen] ?? ''
    if (
      closeAt > delimLen &&
      (canCloseCjkBold(beforeClose, delimLen, afterClose) ||
        (isCjkOpen &&
          !stock &&
          !/\s/.test(beforeClose) &&
          !OPEN_PUNCT_RE.test(beforeClose)))
    ) {
      const inner = src.slice(delimLen, closeAt)
      if (inner.includes('\n\n')) break
      const raw = src.slice(0, candidateEnd)
      if (delimLen === 3) {
        const emToken: Tokens.Em = {
          type: 'em',
          raw: `*${inner}*`,
          text: inner,
          tokens: tokenizer.lexer.inlineTokens(inner),
        }
        return {
          type: 'strong',
          raw,
          text: `*${inner}*`,
          tokens: [emToken],
        } as Tokens.Strong
      }
      return {
        type: 'strong',
        raw,
        text: inner,
        tokens: tokenizer.lexer.inlineTokens(inner),
      } as Tokens.Strong
    }
    idx = closeAt + delimLen
  }
  return stock
}

export function configureMarked(): void {
  if (markedConfigured) return
  markedConfigured = true

  // When the terminal cannot render SGR strikethrough, disable del parsing —
  // the model often uses ~ for "approximate" (e.g., ~100). When support (or
  // FORCE_STRIKETHROUGH) is on, keep official del tokenization so ~~text~~
  // can render via chalk.strikethrough.
  // densable ifr() → LE.use(j6m): custom del (when strikethrough works),
  // disable ref `def`, wrap table with PPE/DPE for pipe-in-code + reject
  // rows that still expand past the header (2.1.234 #10).
  marked.use({
    tokenizer: {
      ...(supportsStrikethrough()
        ? {}
        : {
            del() {
              return undefined
            },
          }),
      blockquote(this: Tokenizer, src: string) {
        return this.rules.other.blockquoteStart.test(src)
          ? lexAtLevel(this.lexer, () =>
              stockMarkdownBlockquote.call(this, src),
            )
          : undefined
      },
      list(this: Tokenizer, src: string) {
        return this.rules.block.list.test(src)
          ? lexAtLevel(this.lexer, () => stockMarkdownList.call(this, src))
          : undefined
      },
      emStrong(
        this: Tokenizer,
        src: string,
        maskedSrc: string,
        prevChar?: string,
      ) {
        return this.rules.inline.emStrongLDelim.test(src)
          ? lexAtLevel(this.lexer, () =>
              tokenizeCjkEmStrong(this, src, maskedSrc, prevChar ?? ''),
            )
          : undefined
      },
      paragraph(this: Tokenizer, src: string) {
        const flattened = fallbackAtMaxNesting(this, src)
        return flattened ? { type: 'paragraph', ...flattened } : false
      },
      text(this: Tokenizer, src: string) {
        const flattened = fallbackAtMaxNesting(this, src)
        return flattened ? { type: 'text', ...flattened } : false
      },
      def() {
        return undefined
      },
      table(this: Tokenizer, src: string) {
        const match = this.rules.block.table.exec(src)
        if (!match) return undefined
        const raw = match[0]
        const ppeLines = raw.split('\n').map(escapePipesInInlineCode)
        const escaped = ppeLines.join('\n')
        const token =
          escaped === raw
            ? stockMarkdownTable.call(this, src)
            : stockMarkdownTable.call(this, escaped + src.slice(raw.length))
        if (token) {
          if (markdownTableHasExtraColumns(ppeLines, token.header.length)) {
            return undefined
          }
          if (escaped !== raw) {
            token.raw = raw
          }
        }
        return token
      },
    },
    extensions: [
      {
        name: 'wrappedBackslash',
        level: 'inline',
        tokenizer(src, tokens) {
          const next = src[1]
          if (
            src[0] !== '\\' ||
            next === undefined ||
            this.lexer.state.inLink
          ) {
            return undefined
          }
          const open = WRAPPED_BACKSLASH_PAIRS[next]
          const prev = tokens.at(-1)
          if (
            open === undefined ||
            prev?.type !== 'text' ||
            !prev.raw.endsWith(open) ||
            WRAPPED_BACKSLASH_WORD_BEFORE_RE.test(prev.raw) ||
            WRAPPED_BACKSLASH_CONTINUES_RE.test(src)
          ) {
            return undefined
          }
          const beforePrev = tokens.at(-2)
          if (
            prev.raw === open &&
            beforePrev !== undefined &&
            beforePrev.type !== 'br' &&
            !(
              beforePrev.type === 'escape' && beforePrev.text === beforePrev.raw
            )
          ) {
            return undefined
          }
          const literal = `\\${next}`
          return { type: 'escape', raw: literal, text: literal }
        },
      },
      {
        name: 'windowsPath',
        level: 'inline',
        tokenizer(src, tokens) {
          const match = WIN_PATH_SEG_RE.exec(src)?.[0]
          const prev = tokens.at(-1)
          if (
            match === undefined ||
            prev?.type !== 'text' ||
            this.lexer.state.inLink
          ) {
            return undefined
          }
          const lead = tokens.length === 1 ? ' ' : ''
          if (
            !WIN_PATH_PREV_RE.test(prev.raw) &&
            !(
              WIN_PATH_CONT_RE.test(src) && WIN_PATH_ALNUM_END_RE.test(prev.raw)
            ) &&
            !WIN_PATH_ROOT_RE.test(lead + prev.raw + match.slice(0, 2))
          ) {
            return undefined
          }
          return {
            type: 'text',
            raw: match,
            text: match,
            escaped: this.lexer.state.inRawBlock,
          }
        },
      },
    ],
  })
}

export function applyMarkdown(
  content: string,
  theme: ThemeName,
  highlight: CliHighlight | null = null,
): string {
  configureMarked()
  return lexMarkdownSafely(marked, stripPromptXMLTags(content))
    .map(_ => formatToken(_, theme, 0, null, null, highlight))
    .join('')
    .trim()
}

/**
 * Official 2.1.295 (#409) `At = 6`, `Ot = 16`, `Pe`/`Ce`/`Pt`/`Nt`/`Ct` —
 * iterative blockquote renderer that avoids O(depth * lines) repeated ANSI
 * split/re-join and caps rendered quote bar depth at `MAX_QUOTE_BARS` (16).
 */
export const MAX_ITALIC_QUOTE_DEPTH = 6
export const MAX_QUOTE_BARS = 16

type QuoteChunk = { rows: string; isDone: boolean }

const asPendingChunk = (rows: string): QuoteChunk => ({ rows, isDone: false })
const ensureTrailingNewline = (s: string): string =>
  s === '' || s.endsWith(EOL) ? s : s + EOL
const nonEmptyPending = (s: string): QuoteChunk[] =>
  s === '' ? [] : [asPendingChunk(s)]
const hasVisibleContent = (line: string): boolean =>
  stripAnsi(line).trim() !== ''

function wrapSingleQuoteBar(rows: string): QuoteChunk {
  const bar = chalk.dim(BLOCKQUOTE_BAR)
  return asPendingChunk(
    rows
      .split(EOL)
      .map(line =>
        hasVisibleContent(line) ? `${bar} ${chalk.italic(line)}` : line,
      )
      .join(EOL),
  )
}

function buildQuoteBarsPrefix(count: number): string {
  const bars = `${BLOCKQUOTE_BAR} `.repeat(Math.max(0, count)).trimEnd()
  return bars === '' ? '' : `${chalk.dim(bars)} `
}

function wrapDeepQuoteBars(
  rows: string,
  depth: number,
  around: number,
): QuoteChunk {
  const barCount = Math.min(depth + 1, MAX_QUOTE_BARS) - around
  const isOutermost = around === 0
  const outerPrefix = buildQuoteBarsPrefix(isOutermost ? 1 : barCount)
  const innerPrefix = buildQuoteBarsPrefix(isOutermost ? barCount - 1 : 0)
  const styleInner = isOutermost ? chalk.italic : (s: string) => s
  return {
    rows: ensureTrailingNewline(rows)
      .split(EOL)
      .map(line =>
        hasVisibleContent(line)
          ? outerPrefix + styleInner(innerPrefix + line)
          : line,
      )
      .join(EOL),
    isDone: true,
  }
}

function flushAdjacentPendingChunks(chunks: QuoteChunk[]): QuoteChunk[] {
  const out: QuoteChunk[] = []
  let pending = ''
  for (const chunk of chunks) {
    if (chunk.isDone) {
      out.push(...nonEmptyPending(ensureTrailingNewline(pending)), chunk)
      pending = ''
    } else {
      pending += chunk.rows
    }
  }
  return [...out, ...nonEmptyPending(pending)]
}

function renderBlockquoteLevel(
  tokens: Token[],
  depth: number,
  ctx: {
    around: number
    draw: (token: Token, quotesAround: number) => string
  },
): QuoteChunk[] {
  const wrap =
    depth < MAX_ITALIC_QUOTE_DEPTH
      ? wrapSingleQuoteBar
      : (rows: string) => wrapDeepQuoteBars(rows, depth, ctx.around)
  const children = flushAdjacentPendingChunks(
    tokens.flatMap(child =>
      child.type === 'blockquote'
        ? renderBlockquoteLevel(child.tokens ?? [], depth + 1, ctx)
        : [asPendingChunk(ctx.draw(child, depth + 1))],
    ),
  )
  return children.map(chunk => (chunk.isDone ? chunk : wrap(chunk.rows)))
}

function renderBlockquoteTokens(
  tokens: Token[],
  quotesAround: number,
  draw: (token: Token, quotesAround: number) => string,
): string {
  return renderBlockquoteLevel(tokens, quotesAround, {
    around: quotesAround,
    draw,
  })
    .map(chunk => chunk.rows)
    .join('')
}

/**
 * #1400 (official `Ze` / `rYt`): when a blockquote begins with blank tokens
 * (`space`, empty `code`, empty `heading`, or all-blank nested `blockquote`)
 * immediately followed by a `code` block, drop the leading blank tokens so the
 * code block's own top blank line is preserved instead of being stripped.
 */
function isBlankBlockToken(
  token: Token,
  highlight: CliHighlight | null,
): boolean {
  switch (token.type) {
    case 'space':
      return true
    case 'code': {
      const codeTok = token as Tokens.Code
      return (
        codeTok.text === '' &&
        (!codeTok.lang || highlight?.supportsLanguage(codeTok.lang) === true)
      )
    }
    case 'heading':
      return (token as Tokens.Heading).text === ''
    case 'blockquote':
      return ((token as Tokens.Blockquote).tokens ?? []).every(t =>
        isBlankBlockToken(t, highlight),
      )
    default:
      return false
  }
}

export function stripLeadingBlankTokensBeforeCode(
  token: Tokens.Blockquote,
  highlight: CliHighlight | null,
): Tokens.Blockquote | undefined {
  const tokens = token.tokens ?? []
  const idx = tokens.findIndex(t => !isBlankBlockToken(t, highlight))
  const first = idx === -1 ? undefined : tokens[idx]
  const codeOrQuote =
    first?.type === 'blockquote'
      ? stripLeadingBlankTokensBeforeCode(first as Tokens.Blockquote, highlight)
      : first?.type === 'code'
        ? first
        : undefined
  return (
    codeOrQuote && {
      ...token,
      tokens: [codeOrQuote, ...tokens.slice(idx + 1)],
    }
  )
}

export function formatToken(
  token: Token,
  theme: ThemeName,
  listDepth = 0,
  orderedListNumber: number | null = null,
  parent: Token | null = null,
  highlight: CliHighlight | null = null,
  options: FormatTokenOptions | boolean = {},
): string {
  const resolved =
    typeof options === 'boolean' ? { promptMode: options } : options
  const listIndent = resolved.listIndent ?? ''
  const glueProse = resolved.glueProse ?? false
  const screenReader = resolved.screenReader ?? false
  const promptMode = resolved.promptMode ?? false
  const quotesAround = resolved.quotesAround ?? 0
  const windowed = resolved.windowed ?? false
  const linkCap = !windowed && (resolved.linkCap ?? supportsHyperlinks())
  const childOpts = (
    overrides: FormatTokenOptions = {},
  ): FormatTokenOptions => ({
    listIndent,
    glueProse,
    screenReader,
    promptMode,
    linkCap,
    windowed,
    ...overrides,
  })

  switch (token.type) {
    case 'blockquote': {
      return renderBlockquoteTokens(
        token.tokens ?? [],
        quotesAround,
        (child, nextQuotesAround) =>
          formatToken(
            child,
            theme,
            0,
            null,
            null,
            highlight,
            childOpts({ quotesAround: nextQuotesAround }),
          ),
      )
    }
    case 'code': {
      if (!highlight) {
        return token.text + EOL
      }
      let language = 'plaintext'
      if (token.lang) {
        if (highlight.supportsLanguage(token.lang)) {
          language = token.lang
        } else {
          logForDebugging(
            `Language not supported while highlighting code, falling back to plaintext: ${token.lang}`,
          )
        }
      }
      return highlight.highlight(token.text, { language, fence: token }) + EOL
    }
    case 'codespan': {
      // inline code
      const styled = color(
        'permission',
        theme,
      )(stripRawOsc8Sequences(token.text))
      const skipHyperlink =
        promptMode ||
        parent?.type === 'link' ||
        ('defanged' in token && token.defanged === true) ||
        ('afterStyle' in token && token.afterStyle === true)
      if (
        !skipHyperlink &&
        HTTP_URL_RE.test(token.text) &&
        URL.canParse(token.text) &&
        (linkCap || (!windowed && mayWriteRawUrlHyperlink(token.text)))
      ) {
        return createHyperlink(token.text, styled, {
          supportsHyperlinks: true,
        })
      }
      return styled
    }
    case 'em':
      return chalk.italic(
        (token.tokens ?? [])
          .map(_ =>
            formatToken(_, theme, 0, null, parent, highlight, childOpts()),
          )
          .join(''),
      )
    case 'strong':
      return chalk.bold(
        (token.tokens ?? [])
          .map(_ =>
            formatToken(_, theme, 0, null, parent, highlight, childOpts()),
          )
          .join(''),
      )
    case 'heading':
      switch (token.depth) {
        case 1: // h1
          return (
            chalk.bold.italic.underline(
              (token.tokens ?? [])
                .map(_ =>
                  formatToken(_, theme, 0, null, null, highlight, childOpts()),
                )
                .join(''),
            ) +
            EOL +
            EOL
          )
        case 2: // h2
          return (
            chalk.bold(
              (token.tokens ?? [])
                .map(_ =>
                  formatToken(_, theme, 0, null, null, highlight, childOpts()),
                )
                .join(''),
            ) +
            EOL +
            EOL
          )
        default: // h3+
          return (
            chalk.bold(
              (token.tokens ?? [])
                .map(_ =>
                  formatToken(_, theme, 0, null, null, highlight, childOpts()),
                )
                .join(''),
            ) +
            EOL +
            EOL
          )
      }
    case 'hr':
      // densable 2.1.234 #16 / SEA `jG` case"hr": `"---"+AY` (AY=`\n`) so the
      // rule does not run into the next line. Heading already appends AY+AY.
      return '---' + EOL
    case 'image':
      return token.href
    case 'link': {
      // Prevent mailto links from being displayed as clickable links
      if (token.href.startsWith('mailto:')) {
        // Extract email from mailto: link and display as plain text
        const email = token.href.replace(/^mailto:/, '')
        return email
      }
      // densable jG link: 247 `pt` gates OSC8; `d0l` still sanitizes the
      // allowed target (234 display / unusual-Unicode href).
      const target = sanitizeMarkdownHref(token.href)
      const href = stripMarkdownHrefInvisibles(target ?? token.href)
      // Extract display text from the link's child tokens
      const linkText = (token.tokens ?? [])
        .map(_ => formatToken(_, theme, 0, null, token, highlight, childOpts()))
        .join('')
      const plainLinkText = stripAnsi(linkText)
      if (target === null) {
        return plainLinkText || href
      }
      // If the link has meaningful display text (different from the URL),
      // show it as a clickable hyperlink. In terminals that support OSC 8,
      // users see the text and can hover/click to see the URL.
      // Official 2.1.326 (#213): in unrecognized terminals that can still
      // honor OSC 8 on raw URLs, wrap the shown URL in OSC 8 so wrapped URLs
      // stay clickable.
      const wrapFallbackUrl = (u: string): string =>
        !linkCap && !windowed && mayWriteRawUrlHyperlink(u)
          ? `${OSC8_START}${u}${OSC8_END}${u}${OSC8_START}${OSC8_END}`
          : u
      if (
        plainLinkText &&
        plainLinkText !== token.href &&
        plainLinkText !== href
      ) {
        if (!linkCap && !windowed && mayWriteRawUrlHyperlink(href)) {
          return `${stripRawOsc8Sequences(linkText)}${HYPERLINK_STYLE_RESET} (${wrapFallbackUrl(href)})`
        }
        return createHyperlink(href, stripRawOsc8Sequences(linkText), {
          supportsHyperlinks: linkCap,
          shownUrlStart: HYPERLINK_STYLE_RESET,
        })
      }
      // When the display text matches the URL (or is empty), just show the URL
      if (!linkCap && !windowed && mayWriteRawUrlHyperlink(href)) {
        return `${HYPERLINK_STYLE_RESET}${wrapFallbackUrl(href)}`
      }
      return createHyperlink(href, undefined, {
        supportsHyperlinks: linkCap,
        shownUrlStart: HYPERLINK_STYLE_RESET,
      })
    }
    case 'list': {
      return token.items
        .map((item: Token, index: number) =>
          formatToken(
            item,
            theme,
            listDepth,
            token.ordered ? token.start + index : null,
            token,
            highlight,
            childOpts({ glueProse: false }),
          ),
        )
        .join('')
    }
    case 'list_item': {
      // densable i3 list_item: marker on the item, hanging wrap prefix, OIl cap.
      const listParent =
        parent?.type === 'list' ? (parent as Tokens.List) : null
      const orderedInfo =
        orderedListNumber !== null && listParent
          ? { number: orderedListNumber, ...listNumberRange(listParent) }
          : null
      const marker = formatListMarker(listDepth, orderedInfo)
      const hanging = listIndent + spaces(stringWidth(marker) + 1)
      const nestedIndent = spaces(Math.min(hanging.length, LIST_INDENT_CAP))
      // marked may emit a leading `checkbox` token for GFM tasks; densable SEA
      // folds the box into list_item.task on the first text token instead.
      const firstContent = (token.tokens ?? []).find(
        t => t.type !== 'space' && t.type !== 'checkbox',
      )
      const leadingBlock =
        firstContent !== undefined && isListBlockToken(firstContent)
      let pendingMarker = !leadingBlock
      const body = (token.tokens ?? [])
        .map(child => {
          const normalizedQuote =
            child.type === 'blockquote'
              ? stripLeadingBlankTokensBeforeCode(
                  child as Tokens.Blockquote,
                  highlight,
                )
              : undefined
          const rendered = formatToken(
            normalizedQuote ?? child,
            theme,
            listDepth + 1,
            orderedListNumber,
            token,
            highlight,
            childOpts({
              glueProse: false,
              listIndent: nestedIndent,
            }),
          )
          if (
            child.type === 'code' ||
            child.type === 'blockquote' ||
            child.type === 'hr' ||
            child.type === 'table' ||
            child.type === 'list' ||
            child.type === 'space' ||
            child.type === 'checkbox'
          ) {
            if (
              (child.type === 'blockquote' && normalizedQuote === undefined) ||
              child.type === 'hr' ||
              child.type === 'table'
            ) {
              return rendered.replace(/^\n+/, '')
            }
            return rendered
          }
          const linePrefix = pendingMarker ? `${listIndent}${marker} ` : hanging
          pendingMarker = false
          const wrapped = rendered
            .split(EOL)
            .map((line, lineIndex) =>
              lineIndex === 0
                ? linePrefix + line
                : line === ''
                  ? line
                  : hanging + line,
            )
            .join(EOL)
          return child.type === 'html' && !wrapped.endsWith(EOL)
            ? wrapped + EOL
            : wrapped
        })
        .join('')
      if (pendingMarker || leadingBlock) {
        return `${listIndent}${marker}${EOL}${body.replace(/^\n+/, '')}`
      }
      return body
    }
    case 'paragraph':
      return (
        (token.tokens ?? [])
          .map(_ =>
            formatToken(_, theme, 0, null, null, highlight, childOpts()),
          )
          .join('') + EOL
      )
    case 'space':
      return EOL
    case 'br':
      return EOL
    case 'text':
      if (parent?.type === 'link') {
        // Already inside a markdown link — the link handler will wrap this
        // in an OSC 8 hyperlink. Linkifying here would nest a second OSC 8
        // sequence, and terminals honor the innermost one, overriding the
        // link's actual href.
        return stripRawOsc8Sequences(token.text)
      }
      if (parent?.type === 'list_item') {
        // densable: marker lives on list_item; text only emits body (+ task box).
        const body = token.tokens
          ? (token.tokens ?? [])
              .map(_ =>
                formatToken(
                  _,
                  theme,
                  listDepth,
                  orderedListNumber,
                  token,
                  highlight,
                  childOpts({ glueProse: true }),
                ),
              )
              .join('')
          : protectOrderedListMarkers(
              linkifyIssueReferences(
                stripRawOsc8Sequences(token.text),
                promptMode,
              ),
            )
        const listItem = parent as Tokens.ListItem
        const firstContent = listItem.tokens?.find(
          t => t.type !== 'space' && t.type !== 'checkbox',
        )
        const isFirst = firstContent === token
        const taskPrefix =
          listItem.task && isFirst ? `[${listItem.checked ? 'x' : ' '}] ` : ''
        return `${taskPrefix}${body}${EOL}`
      }
      {
        const linked = linkifyIssueReferences(
          stripRawOsc8Sequences(token.text),
          promptMode,
        )
        return glueProse ? protectOrderedListMarkers(linked) : linked
      }
    case 'checkbox':
      // GFM task checkbox is rendered via list_item.task on the first text token.
      return ''
    case 'table': {
      const tableToken = token as Tokens.Table

      // Helper function to get the text content that will be displayed (after stripAnsi)
      function getDisplayText(tokens: Token[] | undefined): string {
        return stripAnsi(
          tokens
            ?.map(_ =>
              formatToken(_, theme, 0, null, null, highlight, childOpts()),
            )
            .join('') ?? '',
        )
      }

      // Determine column widths based on displayed content (without formatting)
      const columnWidths = tableToken.header.map((header, index) => {
        let maxWidth = stringWidth(getDisplayText(header.tokens))
        for (const row of tableToken.rows) {
          const cellLength = stringWidth(getDisplayText(row[index]?.tokens))
          maxWidth = Math.max(maxWidth, cellLength)
        }
        return Math.max(maxWidth, 3) // Minimum width of 3
      })

      // Format header row
      let tableOutput = '| '
      tableToken.header.forEach((header, index) => {
        const content =
          header.tokens
            ?.map(_ =>
              formatToken(_, theme, 0, null, null, highlight, childOpts()),
            )
            .join('') ?? ''
        const displayText = getDisplayText(header.tokens)
        const width = columnWidths[index]!
        const align = tableToken.align?.[index]
        tableOutput +=
          padAligned(content, stringWidth(displayText), width, align) + ' | '
      })
      tableOutput = tableOutput.trimEnd() + EOL

      // Add separator row
      tableOutput += '|'
      columnWidths.forEach(width => {
        // Always use dashes, don't show alignment colons in the output
        const separator = '-'.repeat(width + 2) // +2 for spaces on each side
        tableOutput += separator + '|'
      })
      tableOutput += EOL

      // Format data rows
      tableToken.rows.forEach(row => {
        tableOutput += '| '
        row.forEach((cell, index) => {
          const content =
            cell.tokens
              ?.map(_ =>
                formatToken(_, theme, 0, null, null, highlight, childOpts()),
              )
              .join('') ?? ''
          const displayText = getDisplayText(cell.tokens)
          const width = columnWidths[index]!
          const align = tableToken.align?.[index]
          tableOutput +=
            padAligned(content, stringWidth(displayText), width, align) + ' | '
        })
        tableOutput = tableOutput.trimEnd() + EOL
      })

      return tableOutput + EOL
    }
    case 'escape':
      // Markdown escape: \) → ), \\ → \, etc.
      return token.text
    case 'del': {
      // Official wLr: real SGR strikethrough when the terminal supports it,
      // else keep the ~~…~~ markers visible.
      const inner = (token.tokens ?? [])
        .map(_ => formatToken(_, theme, 0, null, null, highlight, childOpts()))
        .join('')
      if (supportsStrikethrough() && chalk.level > 0) {
        return chalk.strikethrough(inner)
      }
      return `~~${inner}~~`
    }
    case 'def':
    case 'html':
      // These token types are not rendered
      return ''
  }
  return ''
}

// Matches owner/repo#NNN style GitHub issue/PR references. The qualified form
// is unambiguous — bare #NNN was removed because it guessed the current repo
// and was wrong whenever the assistant discussed a different one.
// Owner segment disallows dots (GitHub usernames are alphanumerics + hyphens
// only) so hostnames like docs.github.io/guide#42 don't false-positive. Repo
// segment allows dots (e.g. cc.kurs.web). Lookbehind is avoided — it defeats
// YARR JIT in JSC.
const ISSUE_REF_PATTERN =
  /(^|[^\w./-])([A-Za-z0-9][\w-]*\/[A-Za-z0-9][\w.-]*)#(\d+)\b/g

/**
 * Replaces owner/repo#123 references with clickable hyperlinks to GitHub.
 * densable promptMode skips linkify.
 */
function linkifyIssueReferences(text: string, promptMode = false): string {
  if (promptMode || !supportsHyperlinks()) {
    return text
  }
  return text.replace(
    ISSUE_REF_PATTERN,
    (_match, prefix, repo, num) =>
      prefix +
      createHyperlink(
        `https://github.com/${repo}/issues/${num}`,
        `${repo}#${num}`,
      ),
  )
}

function numberToLetter(n: number): string {
  let result = ''
  while (n > 0) {
    n--
    result = String.fromCharCode(97 + (n % 26)) + result
    n = Math.floor(n / 26)
  }
  return result
}

const ROMAN_VALUES: ReadonlyArray<[number, string]> = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
]

function numberToRoman(n: number): string {
  let result = ''
  for (const [value, numeral] of ROMAN_VALUES) {
    while (n >= value) {
      result += numeral
      n -= value
    }
  }
  return result
}

/** densable Wh — repeat spaces with non-finite/≤0 → empty. */
export function spaces(count: number): string {
  return ' '.repeat(Number.isFinite(count) && count > 0 ? count : 0)
}

/** densable DIl — ordered list number range for marker style gating. */
export function listNumberRange(list: Tokens.List): {
  first: number
  last: number
} {
  const rawStart = list.start as number | string | undefined
  const first = rawStart === '' || rawStart === undefined ? 1 : Number(rawStart)
  return { first, last: first + list.items.length - 1 }
}

/**
 * densable G5T — ordered marker body by nest depth.
 * depthArg = listDepth+1 (caller of formatListMarker passes listDepth).
 */
export function getOrderedMarkerBody(
  listDepthPlusOne: number,
  info: { number: number; first: number; last: number },
): string {
  switch (listDepthPlusOne) {
    case 2:
      return info.first >= 1
        ? numberToLetter(info.number)
        : info.number.toString()
    case 3:
      return info.first >= 1 && info.last <= 3999
        ? numberToRoman(info.number)
        : info.number.toString()
    default:
      return info.number.toString()
  }
}

/** densable MIl — "-" or "<body>." */
export function formatListMarker(
  listDepth: number,
  ordered: { number: number; first: number; last: number } | null,
): string {
  if (ordered === null) return '-'
  return `${getOrderedMarkerBody(listDepth + 1, ordered)}.`
}

/** densable Yrh — block tokens that break list hanging inline flow. */
export function isListBlockToken(token: Token): boolean {
  return (
    token.type === 'code' ||
    token.type === 'blockquote' ||
    token.type === 'hr' ||
    token.type === 'table'
  )
}

/**
 * densable QQr — token/raw ends with a blank line (trailing whitespace-only
 * line after a newline).
 */
export function endsWithBlankLine(text: string): boolean {
  if (!text.endsWith('\n')) return false
  for (let i = text.length - 2; i >= 0; i--) {
    const ch = text[i]
    if (ch === '\n') return true
    if (ch !== undefined && !/\s/.test(ch)) return false
  }
  return false
}

/** densable Arh — NBSP before ordered markers so wrap won't orphan them. */
export function protectOrderedListMarkers(text: string): string {
  return text.replace(/ (\d{1,9}[.)])(?!\w)/g, ' $1')
}

/**
 * densable GIl — whether top-level tokens are small/shallow enough for Ink
 * flex list layout (else fall back to ANSI string path).
 */
export function shouldUseInkListLayout(tokens: Token[]): boolean {
  let nodes = 0
  const stack: Array<{ list: Tokens.List; depth: number }> = []
  for (const token of tokens) {
    if (token.type === 'list') {
      stack.push({ list: token as Tokens.List, depth: 1 })
    }
  }
  while (stack.length > 0) {
    const frame = stack.pop()!
    if (frame.depth > LIST_INK_MAX_DEPTH) return false
    for (const item of frame.list.items) {
      if (++nodes > LIST_INK_MAX_NODES) return false
      let inlineRun = true
      for (const child of item.tokens) {
        if (child.type === 'list') {
          stack.push({ list: child as Tokens.List, depth: frame.depth + 1 })
          inlineRun = false
        } else if (isListBlockToken(child)) {
          if (++nodes > LIST_INK_MAX_NODES) return false
          inlineRun = false
        } else if (child.type !== 'space' && !inlineRun) {
          if (++nodes > LIST_INK_MAX_NODES) return false
          inlineRun = true
        }
      }
    }
  }
  return true
}

/**
 * densable Jrh — blank line before next list item when previous item ends
 * with space/heading/table/html-blank or nested list that does.
 */
export function listItemNeedsBlankBefore(item: Tokens.ListItem): boolean {
  const last = item.tokens.at(-1)
  if (!last) return false
  if (
    last.type === 'space' ||
    last.type === 'heading' ||
    last.type === 'table'
  ) {
    return true
  }
  if (last.type === 'list') {
    const nestedLast = (last as Tokens.List).items.at(-1)
    return nestedLast ? listItemNeedsBlankBefore(nestedLast) : false
  }
  if (last.type === 'html') {
    return endsWithBlankLine(last.raw)
  }
  return false
}

/**
 * Pad `content` to `targetWidth` according to alignment. `displayWidth` is the
 * visible width of `content` (caller computes this, e.g. via stringWidth on
 * stripAnsi'd text, so ANSI codes in `content` don't affect padding).
 */
export function padAligned(
  content: string,
  displayWidth: number,
  targetWidth: number,
  align: 'left' | 'center' | 'right' | null | undefined,
): string {
  const padding = Math.max(0, targetWidth - displayWidth)
  if (align === 'center') {
    const leftPad = Math.floor(padding / 2)
    return ' '.repeat(leftPad) + content + ' '.repeat(padding - leftPad)
  }
  if (align === 'right') {
    return ' '.repeat(padding) + content
  }
  return content + ' '.repeat(padding)
}
