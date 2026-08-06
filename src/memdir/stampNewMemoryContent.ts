/**
 * densable Zto / hRg / km(quoteLossyValues) — stamp memory .md writes with
 * provenance + ISO `modified` without dropping inline `#` values.
 *
 * Binary 2.1.214:
 * - Zto: if path is auto-mem .md with frontmatter, stamp originSessionId+modified
 *   on first write (CBc/wBc), else faithfully rewrite `modified:` (hRg).
 * - Team mem path (zle): skip provenance stamp; still date via hRg.
 * - quoteLossyValues / BYh: quote values that YAML would strip at `#`; if rewrite
 *   cannot prove preservation → rewriteHazard (no full rewrite stamp).
 *
 * Call sites (densable FileWrite / FileEdit): content = Zto(path, content) before disk.
 */

import isEqual from 'lodash-es/isEqual.js'
import { getSessionId } from '../bootstrap/state.js'
import { logForDebugging } from '../utils/debug.js'
import { parseYaml, stringifyYaml } from '../utils/yaml.js'
import { isAutoMemPath } from './paths.js'
import { isTeamMemPath } from './teamMemPaths.js'

/** densable kX — loose open (used for gate + body slice). */
const FRONTMATTER_OPEN = /^---\s*\n([\s\S]*?)---\s*\n?/
/** densable q0t — strict CRLF-aware closed frontmatter. */
const FRONTMATTER_STRICT = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/

const YAML_SPECIAL_CHARS = /[{}[\]*&#!|>%@`]|: /
const MODIFIED_LINE = /^(\s*)modified\s*:/
const INDENT_KEY = /^\s+\S/
const BLANK_OR_COMMENT = /^\s*(#|$)/
const KEBAB = /^[a-z0-9_-]+$/

const MEMORY_NODE_TYPE = 'memory'
const TOP_LEVEL_KEYS = new Set(['name', 'description', 'metadata'])

export type MemoryFrontmatter = {
  name: string | null
  description: string | null
  metadata: Readonly<Record<string, unknown>>
}

export type ParsedMemoryMarkdown = {
  frontmatter: MemoryFrontmatter
  body: string
  rewriteHazard?: string
  parseError?: string
}

type QuoteLossyResult = {
  text: string | null
  quotedKeys: string[]
  unprovableKeys: string[]
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** densable cXh — normalize raw frontmatter to {name, description, metadata}. */
export function normalizeMemoryFrontmatter(
  raw: Record<string, unknown>,
): MemoryFrontmatter {
  const nested = isPlainObject(raw.metadata) ? raw.metadata : {}
  const promoted: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (TOP_LEVEL_KEYS.has(k) || v == null) continue
    promoted[k] = v
  }
  return {
    name: asNonEmptyString(raw.name),
    description: asNonEmptyString(raw.description),
    metadata: Object.freeze({ ...promoted, ...nested }),
  }
}

/** densable O9n */
export function getMemoryMetadataString(
  fm: MemoryFrontmatter,
  key: string,
): string | null {
  return asNonEmptyString(fm.metadata[key])
}

/** densable wBc */
export function mergeMemoryMetadata(
  fm: MemoryFrontmatter,
  patch: Record<string, unknown>,
): MemoryFrontmatter {
  return {
    ...fm,
    metadata: Object.freeze({ ...fm.metadata, ...patch }),
  }
}

/** densable uXh */
export function toMemoryNameSlug(name: string): string {
  if (KEBAB.test(name)) return name
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function emptyFrontmatterHazard(
  text: string,
  parsed: Record<string, unknown>,
): string | undefined {
  if (text.trim() !== '' && Object.keys(parsed).length === 0) {
    return 'the frontmatter has no keys (a sequence, scalar, or comment-only document)'
  }
  return undefined
}

/**
 * densable xji — collect keys whose unquoted value contains `#` that cannot
 * be proven preserved by a mechanical quote rewrite.
 */
function collectUnprovableHashKey(line: string, unprovable: string[]): void {
  const m =
    line.match(/^("(?:[^"\\]|\\.)*"):[ \t]+(.*)$/) ??
    line.match(/^('(?:[^']|'')*'):[ \t]+(.*)$/) ??
    line.match(/^([^\s#][^:\n]*?):[ \t]+(.*)$/)
  if (m === null) return
  const key = m[1]
  const value = m[2]
  if (!key || !value) return
  const stripped = value
    .trimEnd()
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'/g, '')
  if (/^#|[ \t]#/.test(stripped)) {
    unprovable.push(key)
  }
}

/**
 * densable BYh — quote plain scalar values that YAML would interpret with
 * inline `#` comments / special chars. Returns null text when nothing quoted.
 */
export function quoteLossyFrontmatterValues(
  frontmatterText: string,
): QuoteLossyResult {
  const quotedKeys: string[] = []
  const unprovableKeys: string[] = []
  const lines = frontmatterText.split('\n').map(line => {
    const hasCr = line.endsWith('\r')
    const bare = hasCr ? line.slice(0, -1) : line
    const m = bare.match(/^([A-Za-z0-9_][A-Za-z0-9_.-]*):[ \t]+(.*)$/)
    if (!m) {
      collectUnprovableHashKey(bare, unprovableKeys)
      return line
    }
    const key = m[1]
    const value = m[2]
    if (!key || value === undefined) return line
    const trimmedEnd = value.trimEnd()
    if (trimmedEnd === '') return line
    // already quoted / block scalar / flow
    if (/^["'|>]/.test(trimmedEnd)) {
      collectUnprovableHashKey(bare, unprovableKeys)
      return line
    }
    let parsed: unknown
    try {
      parsed = parseYaml(trimmedEnd)
    } catch {
      return line
    }
    // only rewrite string/null scalars that differ from raw (comment strip etc.)
    if (typeof parsed !== 'string' && parsed !== null) {
      collectUnprovableHashKey(bare, unprovableKeys)
      return line
    }
    const nullLiterals = ['null', 'Null', 'NULL', '~']
    if (
      !(
        (typeof parsed === 'string' && parsed !== trimmedEnd) ||
        (parsed === null && !nullLiterals.includes(trimmedEnd))
      )
    ) {
      return line
    }
    quotedKeys.push(key)
    const escaped = trimmedEnd.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
    return `${key}: "${escaped}"${hasCr ? '\r' : ''}`
  })
  return {
    text: quotedKeys.length === 0 ? null : lines.join('\n'),
    quotedKeys,
    unprovableKeys,
  }
}

/** densable UYh — quote special-char values for fallback parse (like local quoteProblematic). */
function quoteSpecialYamlValues(frontmatterText: string): string {
  return frontmatterText
    .split('\n')
    .map(line => {
      const match = line.match(/^([a-zA-Z_-]+):\s+(.+)$/)
      if (!match) return line
      const [, key, value] = match
      if (!key || !value) return line
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        return line
      }
      if (value.startsWith('[') && value.endsWith(']')) {
        try {
          if (Array.isArray(parseYaml(value))) return line
        } catch {
          /* fall through */
        }
      }
      if (YAML_SPECIAL_CHARS.test(value)) {
        const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
        return `${key}: "${escaped}"`
      }
      return line
    })
    .join('\n')
}

/**
 * densable km — parse frontmatter; with quoteLossyValues, detect rewrite hazards
 * for inline `#` and ambiguous `---`.
 */
export function parseMemoryMarkdown(
  markdown: string,
  sourcePath?: string,
  options?: { quoteLossyValues?: boolean },
): {
  frontmatter: Record<string, unknown>
  content: string
  rewriteHazard?: string
  parseError?: string
} {
  const match = markdown.match(FRONTMATTER_OPEN)
  if (!match) {
    return { frontmatter: {}, content: markdown }
  }
  const openText = match[1] || ''
  const body = markdown.slice(match[0].length)

  let ambiguousClose: string | undefined
  if (options?.quoteLossyValues) {
    const strict = markdown.match(FRONTMATTER_STRICT)
    const strictText = strict?.[1] ?? ''
    if (openText.trim() !== '' || strictText.trim() !== '') {
      if (strict === null || strictText.trim() !== openText.trim()) {
        ambiguousClose =
          'the closing --- is ambiguous (a value containing "---"?) — part of the block may have read as body'
      }
    }
  }

  let unprovableHazard: string | undefined
  let quoteBroke: string | undefined
  if (options?.quoteLossyValues) {
    const q = quoteLossyFrontmatterValues(openText)
    if (q.unprovableKeys.length > 0) {
      unprovableHazard = `an inline '#' in [${q.unprovableKeys.join(', ')}] cannot be preserved by a rewrite`
    }
    if (q.text !== null) {
      try {
        const rawParsed = parseYaml(q.text)
        const parsedObj = isPlainObject(rawParsed) ? rawParsed : {}
        const hazard =
          ambiguousClose ??
          unprovableHazard ??
          emptyFrontmatterHazard(openText, parsedObj)
        return {
          frontmatter: parsedObj,
          content: body,
          ...(hazard !== undefined ? { rewriteHazard: hazard } : {}),
        }
      } catch {
        quoteBroke = `quoting [${q.quotedKeys.join(', ')}] broke the document; a rewrite from the plain parse would drop their inline '#' content`
        const loc = sourcePath ? ` in ${sourcePath}` : ''
        logForDebugging(`quoteLossyValues: ${quoteBroke}${loc}`, {
          level: 'warn',
        })
      }
    }
  }

  let frontmatter: Record<string, unknown> = {}
  let parseError: string | undefined
  try {
    const parsed = parseYaml(openText)
    frontmatter = isPlainObject(parsed) ? parsed : {}
  } catch {
    try {
      const quoted = quoteSpecialYamlValues(openText).replace(/^\t+/gm, tabs =>
        '  '.repeat(tabs.length),
      )
      const parsed = parseYaml(quoted)
      frontmatter = isPlainObject(parsed) ? parsed : {}
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err)
      const loc = sourcePath ? ` in ${sourcePath}` : ''
      logForDebugging(`Failed to parse YAML frontmatter${loc}: ${parseError}`, {
        level: 'warn',
      })
    }
  }

  const rewriteHazard = !options?.quoteLossyValues
    ? undefined
    : parseError !== undefined
      ? (ambiguousClose ?? `the frontmatter failed to parse: ${parseError}`)
      : (ambiguousClose ??
        unprovableHazard ??
        quoteBroke ??
        emptyFrontmatterHazard(openText, frontmatter))

  return {
    frontmatter,
    content: body,
    ...(parseError !== undefined ? { parseError } : {}),
    ...(rewriteHazard !== undefined ? { rewriteHazard } : {}),
  }
}

/** densable bMe */
export function parseMemoryDocument(
  markdown: string,
  sourcePath?: string,
  options?: { quoteLossyValues?: boolean },
): ParsedMemoryMarkdown {
  const {
    frontmatter: raw,
    content,
    rewriteHazard,
    parseError,
  } = parseMemoryMarkdown(markdown, sourcePath, options)
  return {
    frontmatter: normalizeMemoryFrontmatter(raw),
    body: content,
    ...(rewriteHazard !== undefined ? { rewriteHazard } : {}),
    ...(parseError !== undefined ? { parseError } : {}),
  }
}

/** densable CBc — full rewrite serialize with node_type + metadata. */
export function serializeMemoryDocument(
  fm: MemoryFrontmatter,
  body: string,
): string {
  const metadata = Object.fromEntries(
    [
      ['node_type', MEMORY_NODE_TYPE],
      ...Object.entries(fm.metadata).filter(([k]) => k !== 'node_type'),
    ].filter(([, v]) => v != null),
  )
  const doc: Record<string, unknown> = {
    name: toMemoryNameSlug(fm.name ?? ''),
    ...(fm.description !== null ? { description: fm.description } : {}),
    metadata,
  }
  const bodyTrim = body.replace(/^\n+/, '')
  return `---\n${stringifyYaml(doc)}---\n${bodyTrim}`
}

function stripTrailingCr(line: string): string {
  return line.replace(/\r$/, '')
}

/**
 * densable gRg — split existing modified line into indent + trailing comment.
 * Preserves `  # comment` when value is unquoted.
 */
function splitModifiedLine(line: string): [string, string] {
  const m = line.match(/^(\s*)modified\s*:([\s\S]*)$/)
  if (!m) return ['', '']
  const indent = m[1] ?? ''
  const rest = m[2] ?? ''
  if (/^["']/.test(rest.trimStart())) {
    return [indent, '']
  }
  const comment = rest.match(/([ \t]+#.*)$/)?.[1] ?? ''
  return [indent, comment]
}

function insertAt(lines: string[], index: number, line: string): string[] {
  return [...lines.slice(0, index), line, ...lines.slice(index)]
}

/** densable _Rg — end index of indented metadata block. */
function endOfMetadataBlock(lines: string[], metadataIdx: number): number {
  let r = metadataIdx + 1
  while (r < lines.length - 1) {
    const line = stripTrailingCr(lines[r]!)
    if (INDENT_KEY.test(line)) {
      r++
      continue
    }
    if (BLANK_OR_COMMENT.test(line)) {
      let n = r + 1
      while (
        n < lines.length - 1 &&
        BLANK_OR_COMMENT.test(stripTrailingCr(lines[n]!))
      ) {
        n++
      }
      if (n < lines.length - 1 && INDENT_KEY.test(stripTrailingCr(lines[n]!))) {
        r = n
        continue
      }
    }
    break
  }
  return r
}

/**
 * densable yRg — insert modified line into metadata block (or before closing ---).
 */
function insertModifiedLine(
  lines: string[],
  format: (indent: string, comment?: string) => string,
): string[] | null {
  const anyMeta = lines.findIndex(
    (a, l) => l > 0 && /^metadata:/.test(stripTrailingCr(a)),
  )
  const emptyMeta = lines.findIndex(
    (a, l) => l > 0 && /^metadata:\s*(#.*)?$/.test(stripTrailingCr(a)),
  )
  // inline map metadata: without block form → cannot faithfully insert
  if (anyMeta !== -1 && emptyMeta === -1) return null
  if (emptyMeta === -1) {
    // find last ---
    let lastClose = -1
    for (let i = lines.length - 1; i >= 0; i--) {
      if (stripTrailingCr(lines[i]!).trim() === '---') {
        lastClose = i
        break
      }
    }
    return lastClose > 0 ? insertAt(lines, lastClose, format('')) : null
  }
  const end = endOfMetadataBlock(lines, emptyMeta)
  const indent =
    lines
      .slice(emptyMeta + 1, end)
      .find(
        a =>
          INDENT_KEY.test(stripTrailingCr(a)) &&
          !BLANK_OR_COMMENT.test(stripTrailingCr(a)),
      )
      ?.match(/^(\s+)/)?.[1] ?? '  '
  return insertAt(lines, end, format(indent))
}

/**
 * densable hRg — faithfully place/update a single `modified:` ISO line.
 * Returns null when there is no safe place (caller keeps original content).
 */
export function stampModifiedLine(
  markdown: string,
  iso: string,
): string | null {
  const loose = markdown.match(FRONTMATTER_OPEN)
  const strict = markdown.match(FRONTMATTER_STRICT)
  if (
    loose === null ||
    strict === null ||
    (loose[1] ?? '').trim() !== (strict[1] ?? '').trim()
  ) {
    return null
  }
  const doc = parseMemoryDocument(markdown)
  const { name, description, metadata } = doc.frontmatter
  if (
    name === null &&
    description === null &&
    Object.keys(metadata).length === 0
  ) {
    return null
  }
  const headerLen = strict[0].length
  const header = markdown.slice(0, headerLen)
  const lines = header.split('\n')
  const cr = header.includes('\r\n') ? '\r' : ''
  const formatLine = (indent: string, comment = '') =>
    `${indent}modified: ${iso}${comment}${cr}`

  const existingIdxs = lines.flatMap((line, i) =>
    i > 0 && i < lines.length - 1 && MODIFIED_LINE.test(line) ? [i] : [],
  )
  // multiple modified lines, or parsed has modified but no line → unsafe
  if (
    existingIdxs.length > 1 ||
    (existingIdxs.length === 0 && 'modified' in metadata)
  ) {
    return null
  }

  let nextLines: string[] | null
  const existing = existingIdxs[0]
  if (existing !== undefined) {
    const [indent, comment] = splitModifiedLine(
      stripTrailingCr(lines[existing]!),
    )
    nextLines = [
      ...lines.slice(0, existing),
      formatLine(indent, comment),
      ...lines.slice(existing + 1),
    ]
  } else {
    nextLines = insertModifiedLine(lines, formatLine)
  }
  if (nextLines === null) return null

  const candidate = nextLines.join('\n') + markdown.slice(headerLen)
  const reparsed = parseMemoryDocument(candidate)
  const expected = mergeMemoryMetadata(doc.frontmatter, { modified: iso })
  const strict2 = candidate.match(FRONTMATTER_STRICT)
  if (
    isEqual(reparsed.frontmatter, expected) &&
    reparsed.body === doc.body &&
    strict2 !== null &&
    candidate.slice(strict2[0].length) === markdown.slice(headerLen)
  ) {
    return candidate
  }
  return null
}

/**
 * densable Zto(path, content) — stamp auto-memory .md writes.
 * No-op for non-memdir paths or content without frontmatter.
 */
export function stampNewMemoryContent(
  filePath: string,
  content: string,
): string {
  if (!(filePath.endsWith('.md') && isAutoMemPath(filePath))) {
    return content
  }
  if (!FRONTMATTER_OPEN.test(content)) {
    return content
  }

  const iso = new Date().toISOString()
  // densable zle: team path skips provenance full-rewrite
  const team = isTeamMemPath(filePath)
  const parsed = team
    ? null
    : parseMemoryDocument(content, filePath, { quoteLossyValues: true })

  const needsProvenance =
    parsed !== null &&
    getMemoryMetadataString(parsed.frontmatter, 'originSessionId') === null

  if (needsProvenance && parsed) {
    if (parsed.rewriteHazard === undefined) {
      return serializeMemoryDocument(
        mergeMemoryMetadata(parsed.frontmatter, {
          originSessionId: getSessionId(),
          modified: iso,
        }),
        parsed.body,
      )
    }
    logForDebugging(
      `stampNewMemoryContent: not stamping provenance on ${filePath} — ${parsed.rewriteHazard}`,
      { level: 'warn' },
    )
  }

  const dated = stampModifiedLine(content, iso)
  if (dated === null) {
    logForDebugging(
      `stampNewMemoryContent: not dating ${filePath} — no faithful place for a modified line`,
      { level: 'warn' },
    )
    return content
  }
  return dated
}
