/**
 * densable uto / bJr / cQf / RCm / ato / dto / PMw — island extract (2.1.239).
 * Gold: uto / Ncw / nestingBudgetExceeded / Fhl / RCm.
 *
 * bJr string scan + parse5 DOM verify (sourceCodeLocationInfo). Variant id
 * spelling (bJr miss, DOM hit) → ambiguous. Nesting budget exceeded → ambiguous.
 */
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import type { InteractionSchemaDoc } from './interactionSchemas.js'
import { nestingBudgetExceeded } from './nestingBudget.js'

/** densable Szt / E$i */
export const ISLAND_TOKEN_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

const GET_STARTED_ID = 'get-started'
const GET_STARTED_OPTS = ['get-started', 'keep-iterating'] as const
const MAX_SCHEMA_JSON_BYTES = 65_536
const MAX_TEXT_B64_CHARS = 1496
const MAX_TEXT_UTF8_BYTES = 1120
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/

type P5Node = DefaultTreeAdapterMap['node']
type P5Element = DefaultTreeAdapterMap['element']

export type WorkshopDecisionEntry = {
  id: string
  opts: string[]
  state: 'open' | 'resolved'
  choice: string | null
  custom: string | null
}

export type UtoResult = { json: string } | { ambiguous: true } | null

type IslandDomHit = {
  node: P5Element
  inTemplate: boolean
}

/** densable $sr portable — advance from after id="…" to the tag's `>`. */
function skipToTagGreater(html: string, from: number): number {
  let j = from
  while (j < html.length) {
    const c = html[j]
    if (c === '>') return j - from
    if (c === '"' || c === "'") {
      const q = c
      j++
      while (j < html.length && html[j] !== q) j++
      j++
      continue
    }
    j++
  }
  return -1
}

/** densable bJr — locate `id="{island}"` attribute spans ending at tag `>`. */
export function findIslandIdAttributeSpans(
  html: string,
  islandId: string,
): Array<[number, number]> {
  const needle = `id="${islandId}"`
  const out: Array<[number, number]> = []
  let o = html.indexOf(needle)
  while (o !== -1) {
    const after = o + needle.length
    const skip = skipToTagGreater(html, after)
    if (skip >= 0) {
      const gt = after + skip
      if (html.charCodeAt(gt) === 62) out.push([o, gt + 1])
    }
    o = html.indexOf(needle, after)
  }
  return out
}

/** densable T2 */
function elementAttr(node: P5Element, name: string): string | undefined {
  const lower = name.toLowerCase()
  return node.attrs?.find(a => a.name.toLowerCase() === lower)?.value
}

/**
 * densable Ncw — parse5 walk for elements with id === islandId.
 */
export function findDomNodesById(
  html: string,
  islandId: string,
): IslandDomHit[] {
  const doc = parse(html, { sourceCodeLocationInfo: true })
  const out: IslandDomHit[] = []
  const stack: Array<{ node: P5Node; inTemplate: boolean }> = [
    { node: doc, inTemplate: false },
  ]
  for (;;) {
    const cur = stack.pop()
    if (cur === undefined) break
    const { node, inTemplate } = cur
    const el = node as P5Element
    if (el.tagName !== undefined) {
      if (elementAttr(el, 'id') === islandId) {
        out.push({ node: el, inTemplate })
      }
    }
    for (const c of el.childNodes ?? []) {
      stack.push({ node: c, inTemplate })
    }
    const content = (el as P5Element & { content?: { childNodes?: P5Node[] } })
      .content
    for (const c of content?.childNodes ?? []) {
      stack.push({ node: c, inTemplate: true })
    }
  }
  return out
}

/**
 * densable cQf — nesting budget gate + DOM id lookup.
 * null = nesting exceeded / parse failure (uto → ambiguous).
 */
export async function cQf(
  html: string,
  islandId: string,
): Promise<IslandDomHit[] | null> {
  try {
    if (nestingBudgetExceeded(html)) return null
    return findDomNodesById(html, islandId)
  } catch {
    return null
  }
}

/**
 * densable uto — extract JSON body of the unique script island, or ambiguous/null.
 */
export async function uto(html: string, islandId: string): Promise<UtoResult> {
  if (!ISLAND_TOKEN_RE.test(islandId)) return { ambiguous: true }
  const hits = findIslandIdAttributeSpans(html, islandId)
  if (hits.length === 0) {
    // densable: bJr miss → DOM probe for variant id spelling
    const viaDom = await cQf(html, islandId)
    if (viaDom === null) return { ambiguous: true }
    return viaDom.length === 0 ? null : { ambiguous: true }
  }
  if (hits.length !== 1) return { ambiguous: true }
  const [idAt, tagCloseEnd] = hits[0]!
  const viaDom = await cQf(html, islandId)
  if (viaDom === null || viaDom.length !== 1 || viaDom[0]!.inTemplate) {
    return { ambiguous: true }
  }
  const node = viaDom[0]!.node
  const typeVal = (elementAttr(node, 'type') ?? '').trim().toLowerCase()
  const startTag = node.sourceCodeLocation?.startTag
  const endTag = node.sourceCodeLocation?.endTag
  if (
    (node.tagName ?? '').toLowerCase() !== 'script' ||
    typeVal !== 'application/json' ||
    startTag === undefined ||
    startTag === null ||
    endTag === undefined ||
    endTag === null
  ) {
    return { ambiguous: true }
  }
  // densable: id span must sit inside startTag and end exactly at startTag.endOffset
  if (idAt < startTag.startOffset || tagCloseEnd !== startTag.endOffset) {
    return { ambiguous: true }
  }
  return { json: html.slice(startTag.endOffset, endTag.startOffset) }
}

/** densable jo */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** densable Got */
export function isIslandToken(v: unknown): v is string {
  return typeof v === 'string' && ISLAND_TOKEN_RE.test(v)
}

/**
 * densable ato — base64 text field → utf-8, or null if invalid.
 */
export function decodeIslandTextField(b64: string): string | null {
  if (
    b64.length === 0 ||
    b64.length % 4 !== 0 ||
    b64.length > MAX_TEXT_B64_CHARS ||
    !B64_RE.test(b64)
  ) {
    return null
  }
  let buf: Buffer
  try {
    buf = Buffer.from(b64, 'base64')
  } catch {
    return null
  }
  if (buf.length > MAX_TEXT_UTF8_BYTES) return null
  if (buf.toString('base64') !== b64) return null
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return null
  }
  // densable C0/C1 reject — keep the official class; biome flags the escapes.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: official island control-char class
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(text)) {
    return null
  }
  return text
}

type FieldSpec = {
  kind: string
  nullable?: boolean
  values?: string[]
  minItems?: number
  maxItems?: number
  unique?: boolean
  into?: string
}

function checkInvariant(
  inv: Record<string, unknown>,
  row: Record<string, unknown>,
  keyField: string,
): boolean {
  if ('forKey' in inv) {
    if (row[keyField] !== inv.forKey) return true
    const nulls = inv.null as string[]
    return nulls.every(k => row[k] === null)
  }
  const when = inv.when as Record<string, unknown>
  const whenKey = Object.keys(when)[0]!
  if (row[whenKey] !== when[whenKey]) return true
  if ('null' in inv) {
    return (inv.null as string[]).every(k => row[k] === null)
  }
  const exactly = inv.exactlyOneOf as string[]
  return exactly.filter(k => row[k] !== null).length === 1
}

/**
 * densable RCm — validate island JSON against InteractionSchemaDoc.
 */
export function validateIslandJsonAgainstSchema(
  jsonText: string,
  doc: InteractionSchemaDoc,
): Record<string, unknown>[] | null {
  if (Buffer.byteLength(jsonText, 'utf-8') > MAX_SCHEMA_JSON_BYTES) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return null
  }
  if (!isPlainObject(parsed)) return null
  const keys = Object.keys(parsed)
  if (keys.length !== 1 || keys[0] !== 'items') return null
  const items = parsed.items
  if (!Array.isArray(items) || items.length > doc.maxEntries) return null
  const fieldNames = Object.keys(doc.fields).sort()
  const out: Record<string, unknown>[] = []
  const seenKeys = new Set<string>()
  for (const raw of items) {
    if (!isPlainObject(raw)) return null
    const rk = Object.keys(raw).sort()
    if (
      rk.length !== fieldNames.length ||
      rk.some((k, i) => k !== fieldNames[i])
    ) {
      return null
    }
    const row: Record<string, unknown> = Object.create(null)
    for (const name of fieldNames) {
      const spec = doc.fields[name] as FieldSpec
      const v = raw[name]
      if (v === null) {
        if (spec.nullable !== true) return null
        row[name] = null
        continue
      }
      switch (spec.kind) {
        case 'token':
          if (!isIslandToken(v)) return null
          row[name] = v
          break
        case 'enum':
          if (typeof v !== 'string' || !spec.values?.includes(v)) return null
          row[name] = v
          break
        case 'tokenArray': {
          if (
            !Array.isArray(v) ||
            v.length < (spec.minItems ?? 0) ||
            v.length > (spec.maxItems ?? Infinity) ||
            v.some(x => !isIslandToken(x)) ||
            new Set(v as string[]).size !== v.length
          ) {
            return null
          }
          row[name] = (v as string[]).slice()
          break
        }
        case 'ref': {
          if (typeof v !== 'string') return null
          const into = raw[spec.into ?? '']
          if (!Array.isArray(into) || !into.includes(v)) return null
          row[name] = v
          break
        }
        case 'text':
          if (typeof v !== 'string' || decodeIslandTextField(v) === null) {
            return null
          }
          row[name] = v
          break
        default:
          return null
      }
    }
    const keyVal = row[doc.key]
    if (typeof keyVal !== 'string' || seenKeys.has(keyVal)) return null
    seenKeys.add(keyVal)
    out.push(row)
  }
  for (const inv of doc.invariants ?? []) {
    if (!isPlainObject(inv)) return null
    for (const row of out) {
      if (!checkInvariant(inv, row, doc.key)) return null
    }
  }
  return out
}

function isGetStartedRow(e: WorkshopDecisionEntry): boolean {
  return (
    e.id === GET_STARTED_ID &&
    e.opts.length === 2 &&
    GET_STARTED_OPTS.every(o => e.opts.includes(o)) &&
    e.custom === null
  )
}

/** densable dto — workshop derived state. */
export function deriveWorkshopState(
  entries: WorkshopDecisionEntry[],
): 'in-progress' | 'started' | 'ready' {
  const gs = entries.find(isGetStartedRow)
  if (entries.some(n => n !== gs && n.state === 'open')) return 'in-progress'
  if (gs !== undefined && gs.choice === GET_STARTED_OPTS[0]) return 'started'
  if (gs !== undefined && gs.state === 'open') return 'ready'
  return 'in-progress'
}

/** densable PMw */
export function deriveWorkshopFromEntries(entries: unknown): { state: string } {
  const list = (Array.isArray(entries) ? entries : []).map(r => {
    const o = r as WorkshopDecisionEntry
    return {
      id: o.id,
      opts: o.opts.slice(),
      state: o.state,
      choice: o.choice,
      custom: o.custom,
    }
  })
  return { state: deriveWorkshopState(list) }
}

/** densable PCm */
export function runSchemaDerive(
  reg: { derive?: (entries: unknown) => Record<string, string> },
  entries: unknown,
): { ok: true; derived?: Record<string, string> } | { ok: false } {
  if (reg.derive === undefined) return { ok: true }
  let derived: Record<string, string>
  try {
    derived = reg.derive(entries)
  } catch {
    return { ok: false }
  }
  if (!isPlainObject(derived)) return { ok: false }
  const keys = Object.keys(derived)
  if (keys.length > 16) return { ok: false }
  const out: Record<string, string> = {}
  for (const k of keys) {
    const v = derived[k]
    if (!isIslandToken(k) || !isIslandToken(v)) return { ok: false }
    out[k] = v
  }
  return { ok: true, derived: out }
}
