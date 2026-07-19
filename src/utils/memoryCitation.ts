/**
 * densable memory citation helpers (bDc / mBh / gDc / K0 / kjb).
 *
 * Model replies wrap memory-backed sentences in:
 *   <cc-memory filenames="a.md,b.md">…sentence…</cc-memory>
 * used by the memory survey trigger + surveyRating write-back.
 */

const MEMORY_TAG = 'cc-memory'
const MEMORY_TAG_RE = /<\/?cc-memory\b[^>]*>/g
const FILENAMES_ATTR_RE = /\bfilenames="([^"]*)"/
/** densable V1i — truncate open-ended citation body for survey display. */
const CITATION_BODY_MAX = 300

export type MemoryCitation = {
  sentence: string
  filenames: string[]
}

/** densable K0: strip cc-memory tags from display text. */
export function stripMemoryCitationTags(text: string): string {
  if (!text.includes(MEMORY_TAG)) return text
  return text.replace(MEMORY_TAG_RE, '')
}

/** densable mBh: parse filenames="a,b" from an opening tag. */
export function parseMemoryCitationFilenamesAttr(openTag: string): string[] {
  const m = openTag.match(FILENAMES_ATTR_RE)
  if (m === null) return []
  return (m[1] ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(s => s !== '')
}

/** densable gDc: truncate + strip tags for citation sentence body. */
export function formatMemoryCitationBody(raw: string): string {
  if (raw.length <= CITATION_BODY_MAX) {
    return stripMemoryCitationTags(raw).trim()
  }
  let slice = raw.slice(0, CITATION_BODY_MAX)
  const last = slice.charCodeAt(slice.length - 1)
  // avoid splitting a surrogate pair
  if (last >= 0xd800 && last <= 0xdbff) {
    slice = slice.slice(0, -1)
  }
  return `${stripMemoryCitationTags(slice).trim()}\u2026`
}

/**
 * densable bDc: extract {sentence, filenames} spans from model text.
 * Unclosed open tags take the next CITATION_BODY_MAX chars as body.
 */
export function extractMemoryCitations(text: string): MemoryCitation[] {
  if (!text.includes(MEMORY_TAG)) return []
  const out: MemoryCitation[] = []
  let openBodyAt: number | null = null
  let openFilenames: string[] = []
  for (const m of text.matchAll(MEMORY_TAG_RE)) {
    const tag = m[0]
    const index = m.index ?? 0
    if (!tag.startsWith('</')) {
      if (openBodyAt === null) {
        openBodyAt = index + tag.length
        openFilenames = parseMemoryCitationFilenamesAttr(tag)
      }
      continue
    }
    if (openBodyAt === null) continue
    const body = formatMemoryCitationBody(text.slice(openBodyAt, index))
    if (body !== '' && body !== '\u2026') {
      out.push({ sentence: body, filenames: openFilenames })
    }
    openBodyAt = null
    openFilenames = []
  }
  if (openBodyAt !== null) {
    const body = formatMemoryCitationBody(
      text.slice(openBodyAt, openBodyAt + CITATION_BODY_MAX + 1),
    )
    if (body !== '' && body !== '\u2026') {
      out.push({ sentence: body, filenames: openFilenames })
    }
  }
  return out
}

/**
 * densable kjb: from an assistant message content array, collect citation
 * sentences + unique filenames. Null when no citations.
 */
export function extractMemoryCitationFromAssistantContent(
  content: unknown,
): { sentence: string; filenames: string[] } | null {
  if (!Array.isArray(content)) return null
  const spans = content
    .filter(
      (b): b is { type: 'text'; text: string } =>
        typeof b === 'object' &&
        b !== null &&
        (b as { type?: unknown }).type === 'text' &&
        typeof (b as { text?: unknown }).text === 'string',
    )
    .flatMap(b => extractMemoryCitations(b.text))
  if (spans.length === 0) return null
  const filenames = [...new Set(spans.flatMap(s => s.filenames))]
  return {
    sentence: spans.map(s => s.sentence).join('\n'),
    filenames,
  }
}
