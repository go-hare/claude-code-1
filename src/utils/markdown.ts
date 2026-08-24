import chalk from 'chalk'
import { marked, Tokenizer, type Token, type Tokens } from 'marked'
import stripAnsi from 'strip-ansi'
import { color } from '@anthropic/ink'
import { BLOCKQUOTE_BAR } from '../constants/figures.js'
import { stringWidth, supportsHyperlinks } from '@anthropic/ink'
import { createHyperlink } from '../utils/hyperlink.js'
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

/**
 * densable `PPE` — escape unescaped `|` inside matching backtick spans so
 * GFM table tokenization does not treat code-cell pipes as column separators
 * (SEA CXr / j6m.table; changelog 2.1.234 #10).
 */
export function escapePipesInInlineCode(line: string): string {
  if (!line.includes('`') || !line.includes('|')) return line
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
    let scan = i + tickLen
    let closeAt = -1
    while (scan < line.length) {
      if (line[scan] !== '`') {
        scan++
        continue
      }
      let closeLen = 0
      while (line[scan + closeLen] === '`') closeLen++
      if (closeLen === tickLen) {
        closeAt = scan
        break
      }
      scan += closeLen
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

// densable `N6m` — stock marked Tokenizer.table before j6m override.
const stockMarkdownTable = Tokenizer.prototype.table

let markedConfigured = false

export type FormatTokenOptions = {
  listIndent?: string
  glueProse?: boolean
  screenReader?: boolean
  promptMode?: boolean
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
  })
}

export function applyMarkdown(
  content: string,
  theme: ThemeName,
  highlight: CliHighlight | null = null,
): string {
  configureMarked()
  return marked
    .lexer(stripPromptXMLTags(content))
    .map(_ => formatToken(_, theme, 0, null, null, highlight))
    .join('')
    .trim()
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
  const childOpts = (
    overrides: FormatTokenOptions = {},
  ): FormatTokenOptions => ({
    listIndent,
    glueProse,
    screenReader,
    promptMode,
    ...overrides,
  })

  switch (token.type) {
    case 'blockquote': {
      const inner = (token.tokens ?? [])
        .map(_ => formatToken(_, theme, 0, null, null, highlight, childOpts()))
        .join('')
      // Prefix each line with a dim vertical bar. Keep text italic but at
      // normal brightness — chalk.dim is nearly invisible on dark themes.
      const bar = chalk.dim(BLOCKQUOTE_BAR)
      return inner
        .split(EOL)
        .map(line =>
          stripAnsi(line).trim() ? `${bar} ${chalk.italic(line)}` : line,
        )
        .join(EOL)
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
      return highlight.highlight(token.text, { language }) + EOL
    }
    case 'codespan': {
      // inline code
      return color('permission', theme)(token.text)
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
      // densable jG link: `d0l(href)` for display / OSC8 target sanitization
      const href = stripMarkdownHrefInvisibles(token.href)
      // Extract display text from the link's child tokens
      const linkText = (token.tokens ?? [])
        .map(_ => formatToken(_, theme, 0, null, token, highlight, childOpts()))
        .join('')
      const plainLinkText = stripAnsi(linkText)
      // If the link has meaningful display text (different from the URL),
      // show it as a clickable hyperlink. In terminals that support OSC 8,
      // users see the text and can hover/click to see the URL.
      if (
        plainLinkText &&
        plainLinkText !== token.href &&
        plainLinkText !== href
      ) {
        return createHyperlink(href, linkText)
      }
      // When the display text matches the URL (or is empty), just show the URL
      return createHyperlink(href)
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
          const rendered = formatToken(
            child,
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
        return token.text
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
              linkifyIssueReferences(token.text, promptMode),
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
        const linked = linkifyIssueReferences(token.text, promptMode)
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
