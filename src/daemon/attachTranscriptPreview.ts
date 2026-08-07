/**
 * densable 2.1.212 cold-attach transcript preview (`Nia` + `J5_` + `B5_`).
 *
 * When attach lands while the worker is still booting, densable reads the last
 * FPp=262144 bytes of the session transcript and paints a formatted frame so
 * the user sees prior turns immediately instead of a blank stall.
 *
 * Faithful J5_: roles, wrap budget, chalk colorLevel (gt.level), theme via
 * zn/color, assistant X5_ = applyMarkdown, user subtle+text+userMessageBackground,
 * thinking italic, dim footer with B5_.
 */

import { closeSync, lstatSync, openSync, type PathLike, readSync } from 'fs'
import chalk from 'chalk'
import { color, stringWidth } from '@anthropic/ink'
import { BLACK_CIRCLE } from '../constants/figures.js'
import { applyMarkdown } from '../utils/markdown.js'
import type { ThemeName } from '../utils/theme.js'

/** densable FPp — max tail bytes read from transcript. */
export const ATTACH_TRANSCRIPT_TAIL_BYTES = 262_144
/** densable P5_ — total text budget for extracted entries. */
const TEXT_BUDGET = 32_768
/** densable L5_ — max message entries in the preview. */
const MAX_ENTRIES = 200
/** densable M5_ — markdown budget per assistant entry (skip md if longer). */
export const ATTACH_MARKDOWN_BUDGET = 4096
/** densable O5_ — max ms for markdown formatting across the frame. */
export const ATTACH_MARKDOWN_TIME_BUDGET_MS = 50
/** densable F5_ — default chalk colorLevel when caps omit it. */
export const ATTACH_DEFAULT_COLOR_LEVEL = 2
/** densable U5_ — default theme when caps omit systemTheme. */
export const ATTACH_DEFAULT_THEME = 'dark'
/** densable UPp — pointer glyph for user lines (figures.pointer ≈ ›). */
const POINTER = '›'
/** densable eLr — thinking prefix (∵). */
const THINKING_PREFIX = '\u2234'
/** densable Oa — assistant/tool bullet (● / ⏺). */
const BULLET = BLACK_CIRCLE
/** densable B5_ stall footer when preview is shown. */
export const COLD_ATTACH_SHOWING_TRANSCRIPT =
  '  Session is starting — showing its transcript until it appears. Ctrl+Z to detach'
/** densable legacy stall when no preview is available. */
export const COLD_ATTACH_ONCE_READY =
  'Session is starting — it will appear once ready. Ctrl+Z to detach'
export const ATTACH_WAITING_REDRAW =
  'Waiting for session to redraw… Ctrl+Z to detach'

const DIM = '\x1B[2m'
const RESET = '\x1B[0m'
const CLEAR_SCREEN = '\x1B[H\x1B[2J'
const ERASE_LINE = '\x1B[2K'

/** densable Nia/J5_ caps from attach request. */
export type AttachPreviewCaps = {
  colorLevel?: number
  /** densable systemTheme / theme — 'dark' | 'light' | … */
  theme?: string
  systemTheme?: string
}

type PreviewRole = 'user' | 'assistant' | 'tool' | 'thinking'

type PreviewEntry = {
  role: PreviewRole
  text: string
}

type FrameLine = {
  text: string
  dim: boolean
}

/**
 * densable Nia — read last FPp bytes of transcript and format for terminal.
 * Returns null when file missing/empty/unparseable or frame cannot fit.
 */
export function formatColdAttachTranscriptPreview(
  transcriptPath: string,
  cols: number,
  rows: number,
  caps?: AttachPreviewCaps,
): string | null {
  let fd: number | undefined
  try {
    const st = lstatSync(transcriptPath as PathLike)
    if (!st.isFile() || st.size === 0) return null
    const size = st.size
    fd = openSync(transcriptPath, 'r')
    const offset = Math.max(0, size - ATTACH_TRANSCRIPT_TAIL_BYTES)
    const buf = Buffer.alloc(Math.min(size, ATTACH_TRANSCRIPT_TAIL_BYTES))
    const n = readSync(fd, buf, 0, buf.length, offset)
    let utf8 = buf.subarray(0, n).toString('utf8')
    // densable: if we started mid-file, drop the partial first line.
    if (offset > 0) {
      const nl = utf8.indexOf('\n')
      if (nl < 0) return null
      utf8 = utf8.slice(nl + 1)
    }
    return formatTranscriptTailFrame(utf8, cols, rows, caps)
  } catch {
    return null
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // ignore
      }
    }
  }
}

/**
 * densable J5_ — build a terminal frame ending with dim B5_ lines.
 * M5_/O5_: assistant markdown only when text length ≤ M5_ and elapsed < O5_.
 * colorLevel/theme from caps (F5_/U5_ defaults); temporarily sets chalk.level.
 */
export function formatTranscriptTailFrame(
  utf8: string,
  cols: number,
  rows: number,
  caps?: AttachPreviewCaps,
): string | null {
  const width = Math.max(1, cols)
  const height = Math.max(1, rows)
  const colorLevel = caps?.colorLevel ?? ATTACH_DEFAULT_COLOR_LEVEL
  const themeName = resolveAttachTheme(caps?.theme ?? caps?.systemTheme)
  const dimIf = (s: string): string => (colorLevel > 0 && s !== '' ? dim(s) : s)
  const rowCost = (s: string): number =>
    Math.max(1, Math.ceil(visibleWidth(s) / width))
  const rule = '─'.repeat(width)
  // densable zgb footer: u=["",c,b6p,c,Ngb] — leading "" is the one-line gap
  // between transcript body and the rule/pointer chrome (2.1.217 #14).
  const footerLines = ['', rule, POINTER, rule, COLD_ATTACH_SHOWING_TRANSCRIPT]
  const footerRows = footerLines.reduce((sum, line) => sum + rowCost(line), 0)
  const bodyBudget = height - footerRows
  if (bodyBudget < 1) return null

  const maxEntries = Math.min(Math.ceil((bodyBudget + 1) / 2), MAX_ENTRIES)
  const lines = utf8.split('\n')
  const entries: PreviewEntry[] = []
  let budget = TEXT_BUDGET
  outer: for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = parseTranscriptLine(lines[i]!)
    for (let j = parsed.length - 1; j >= 0; j--) {
      if (entries.length >= maxEntries) break outer
      const e = parsed[j]!
      if (e.text.length > budget) {
        if (entries.length === 0) {
          // densable: keep a tail slice of the last huge entry once.
          const tail = e.text.slice(-budget)
          const cut = tail.indexOf('\n')
          const text = (cut >= 0 ? tail.slice(cut + 1) : tail).trim()
          if (text) entries.unshift({ role: e.role, text })
        }
        break outer
      }
      budget -= e.text.length
      entries.unshift(e)
    }
  }
  if (entries.length === 0) return null

  // densable: indent prefix width 2 when cols >= 4
  const prefixPad = width >= 4 ? 2 : 0
  const wrapWidth = Math.max(1, width - prefixPad)

  const prevLevel = chalk.level
  chalk.level = colorLevel as 0 | 1 | 2 | 3
  const formatStarted = performance.now()
  const body: FrameLine[] = []
  try {
    for (const e of entries) {
      if (body.length > 0) body.push({ text: '', dim: false })
      const raw = stripControlChars(e.text)
      switch (e.role) {
        case 'tool': {
          const line = `${BULLET} ${raw.replace(/\n/g, ' ')}`
          body.push({ text: hardWrapOne(line, width), dim: true })
          break
        }
        case 'thinking': {
          const t = raw.replace(/\s+/g, ' ').trim()
          for (const [idx, row] of wrapHard(t, wrapWidth).entries()) {
            const lead =
              prefixPad === 0 || row === ''
                ? ''
                : idx === 0
                  ? `${THINKING_PREFIX} `
                  : '  '
            body.push({
              text: lead + chalk.italic(row),
              dim: true,
            })
          }
          break
        }
        case 'assistant': {
          let md = raw
          if (
            raw.length <= ATTACH_MARKDOWN_BUDGET &&
            performance.now() - formatStarted <
              ATTACH_MARKDOWN_TIME_BUDGET_MS &&
            !looksLikeHeavyMarkdown(raw)
          ) {
            try {
              // densable X5_ — applyMarkdown with theme
              md = applyMarkdown(raw, themeName, null)
            } catch {
              md = raw
            }
          }
          const bullet = color('text', themeName)(BULLET)
          for (const [idx, row] of wrapHard(md, wrapWidth).entries()) {
            const lead =
              prefixPad === 0 || row === ''
                ? ''
                : idx === 0
                  ? `${bullet} `
                  : '  '
            body.push({ text: lead + row, dim: false })
          }
          break
        }
        case 'user': {
          const subtlePtr = color('subtle', themeName)(`${POINTER} `)
          const textColor = color('text', themeName)
          const bg = color('userMessageBackground', themeName, 'background')
          for (const [idx, row] of wrapHard(raw, wrapWidth).entries()) {
            const lead = prefixPad === 0 ? '' : idx === 0 ? subtlePtr : '  '
            body.push({
              text: bg(lead + textColor(row)),
              dim: false,
            })
          }
          break
        }
        default:
          break
      }
    }
  } finally {
    chalk.level = prevLevel
  }

  // densable: keep only the last bodyBudget visual rows.
  const kept: string[] = []
  let used = 0
  for (let i = body.length - 1; i >= 0; i--) {
    const line = body[i]!
    const cost = rowCost(line.text)
    if (used + cost > bodyBudget) break
    used += cost
    kept.unshift(line.dim ? dimIf(line.text) : line.text)
  }
  if (kept.length === 0) return null

  const pad = Math.max(0, bodyBudget - used)
  const out: string[] = []
  for (let i = 0; i < pad; i++) out.push('')
  out.push(...kept)
  for (const f of footerLines) out.push(dimIf(f))

  // densable uses \r\n between lines for PTY paint.
  return out.join('\r\n')
}

function resolveAttachTheme(raw: string | undefined): ThemeName {
  const t = (raw ?? ATTACH_DEFAULT_THEME).toLowerCase()
  if (
    t === 'light' ||
    t === 'dark' ||
    t === 'light-ansi' ||
    t === 'dark-ansi' ||
    t === 'light-daltonized' ||
    t === 'dark-daltonized'
  ) {
    return t
  }
  return ATTACH_DEFAULT_THEME
}

/** densable N5_ — skip markdown for heavy/code-heavy blobs (cheap heuristic). */
function looksLikeHeavyMarkdown(text: string): boolean {
  if (text.includes('```')) return true
  if (text.length > ATTACH_MARKDOWN_BUDGET) return true
  return false
}

function stripControlChars(text: string): string {
  // Keep content; strip orphan C0 controls that break wrap widths.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional strip of C0
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

function hardWrapOne(text: string, width: number): string {
  const rows = wrapHard(text, width)
  return rows[0] ?? text
}

function parseTranscriptLine(line: string): PreviewEntry[] {
  const trimmed = line.trim()
  if (!trimmed) return []
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return []
  }
  if (obj.type !== 'user' && obj.type !== 'assistant') return []
  if (obj.isSidechain === true || obj.isMeta === true) return []
  const message = obj.message as Record<string, unknown> | undefined
  const content = message?.content
  if (typeof content === 'string') {
    if (obj.type === 'user') return userEntries(content)
    const t = content.trim()
    return t ? [{ role: 'assistant', text: t }] : []
  }
  if (!Array.isArray(content)) return []
  if (obj.type === 'user') {
    const parts: string[] = []
    for (const c of content) {
      const block = c as Record<string, unknown>
      if (block?.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text)
      }
    }
    return userEntries(parts.join('\n'))
  }
  const out: PreviewEntry[] = []
  let assistantBuf: string[] = []
  const flushAssistant = () => {
    const t = assistantBuf.join('\n').trim()
    assistantBuf = []
    if (t) out.push({ role: 'assistant', text: t })
  }
  for (const c of content) {
    const block = c as Record<string, unknown>
    if (block?.type === 'text' && typeof block.text === 'string') {
      assistantBuf.push(block.text)
    } else if (block?.type === 'tool_use' && typeof block.name === 'string') {
      flushAssistant()
      let arg = ''
      if (typeof block.input === 'object' && block.input !== null) {
        for (const v of Object.values(block.input as Record<string, unknown>)) {
          if (typeof v === 'string' && v !== '') {
            arg = v
            break
          }
        }
      }
      out.push({ role: 'tool', text: `${block.name}(${arg})` })
    } else if (
      block?.type === 'thinking' &&
      typeof block.thinking === 'string' &&
      block.thinking.trim() !== ''
    ) {
      flushAssistant()
      out.push({ role: 'thinking', text: block.thinking })
    }
  }
  flushAssistant()
  return out
}

function userEntries(raw: string): PreviewEntry[] {
  let t = raw.trim()
  if (!t) return []
  const bash = /^<bash-input>([\s\S]*?)<\/bash-input>/.exec(t)
  if (bash) t = `! ${bash[1]!.trim()}`
  // densable Kfi — drop pure system-reminder shells
  if (/^<system-reminder>[\s\S]*<\/system-reminder>\s*$/.test(t)) return []
  return [{ role: 'user', text: t }]
}

function wrapHard(text: string, width: number): string[] {
  if (width <= 1) return [text]
  const rows: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      rows.push('')
      continue
    }
    let rest = paragraph
    while (rest.length > 0) {
      if (visibleWidth(rest) <= width) {
        rows.push(rest)
        break
      }
      // Cut by code units with width accounting — densable uses segmenter; we
      // approximate with iterative slice for attach-path speed.
      let lo = 1
      let hi = rest.length
      let cut = 1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (visibleWidth(rest.slice(0, mid)) <= width) {
          cut = mid
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      if (cut < 1) cut = 1
      rows.push(rest.slice(0, cut))
      rest = rest.slice(cut)
    }
  }
  return rows
}

function visibleWidth(s: string): number {
  try {
    return stringWidth(s)
  } catch {
    // strip common CSI then length (ESC = \u001b; avoid control-char regex lint)
    const esc = String.fromCharCode(0x1b)
    return s.split(`${esc}[`).reduce((acc, part, i) => {
      if (i === 0) return part.length
      const m = part.match(/^[0-9;]*m/)
      return acc + (m ? part.slice(m[0].length).length : part.length + 2)
    }, 0)
  }
}

function dim(s: string): string {
  return `${DIM}${s}${RESET}`
}

/** Wrap preview body with clear+erase like densable attach write of cached frame. */
export function paintColdAttachPreview(preview: string): string {
  return `${CLEAR_SCREEN}${ERASE_LINE}${preview}`
}
