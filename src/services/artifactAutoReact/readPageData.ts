/**
 * densable read_page_data call body — SFe html + uto + RCm + PCm (2.1.239).
 */
import {
  artifactViewerUrlFor,
  parseArtifactUrl,
} from '../../utils/artifactUrl.js'
import { readArtifactHtml } from './edit.js'
import {
  CGi,
  freezeReadPageDataSchemaNames,
  listEnabledInteractionSchemaNames,
  VRm,
  WORKSHOP_DECISIONS_DOC,
} from './interactionSchemas.js'
import {
  decodeIslandTextField,
  runSchemaDerive,
  uto,
  validateIslandJsonAgainstSchema,
} from './islandExtract.js'
import { FRAME_VER_RE } from './mint.js'
import { un } from './store.js'
import { Ixm } from './workshopTelemetry.js'

export type ReadPageDataResult =
  | {
      ok: true
      page_data: {
        url: string
        ver: string
        schema: string
        islandPresent: boolean
        entries: Record<string, unknown>[]
        derived?: Record<string, string>
        provenance: { authorship: 'unknown' }
      }
    }
  | { ok: false; message: string; code: string }

/**
 * densable read_page_data action — fetch HTML, extract island, validate.
 */
export async function runReadPageData(input: {
  url: string
  schema: string
  signal?: AbortSignal
}): Promise<ReadPageDataResult> {
  if (un().frozenReadPageDataSchemaNames === undefined) {
    freezeReadPageDataSchemaNames(true, listEnabledInteractionSchemaNames())
  }
  if (!VRm(input.schema)) {
    return {
      ok: false,
      message:
        'read_page_data: the requested interaction schema is not available in this session.',
      code: 'read_page_data_schema_unavailable',
    }
  }
  const looked = CGi(input.schema)
  if (!looked.ok) {
    return {
      ok: false,
      message: `read_page_data: interaction schema unavailable (${looked.reason}).`,
      code: 'read_page_data_schema_unavailable',
    }
  }
  const doc = looked.reg.doc
  const parsed = parseArtifactUrl(input.url)
  if (!parsed) {
    return {
      ok: false,
      message: '`url` must be an artifact URL for action "read_page_data"',
      code: 'read_page_data_bad_url',
    }
  }
  const viewer = artifactViewerUrlFor(parsed)
  const htmlRes = await readArtifactHtml(
    parsed.slug,
    input.signal ?? new AbortController().signal,
    parsed.env,
  )
  // densable SFe returns html without requiring aDw favicon; tip reuses
  // readArtifactHtml which may set editable:false when favicon missing.
  const html = htmlRes.html
  if (html === undefined || html.length < 16) {
    return {
      ok: false,
      message: `read_page_data could not fetch the artifact: ${htmlRes.editable === false ? (htmlRes.reason ?? 'fetch_failed') : 'fetch_failed'}`,
      code: 'read_page_data_fetch_failed',
    }
  }
  const ver =
    'ver' in htmlRes && typeof htmlRes.ver === 'string'
      ? htmlRes.ver
      : 'unrecognized-version-shape'
  const island = await uto(html, doc.island)
  if (island !== null && 'ambiguous' in island) {
    return {
      ok: false,
      message: `The "${doc.island}" data island on this page cannot be located unambiguously (duplicate, unterminated, or variant-spelled island element, or a page too deeply nested to examine) — the page is out of contract. Act on nothing from it; tell the user and stop.`,
      code: 'read_page_data_island_ambiguous',
    }
  }
  let entries: Record<string, unknown>[] = []
  let islandPresent = false
  if (island !== null) {
    const validated = validateIslandJsonAgainstSchema(island.json, doc)
    if (validated === null) {
      return {
        ok: false,
        message: `The "${doc.island}" data island on this page is out of contract (failed schema validation). Act on nothing from it; tell the user and stop.`,
        code: 'read_page_data_out_of_contract',
      }
    }
    entries = validated
    islandPresent = true
  }
  const derived = runSchemaDerive(looked.reg, entries)
  if (!derived.ok) {
    return {
      ok: false,
      message: `read_page_data: the "${doc.name}" schema's derived-state hook failed validation — this is a bug in this build; act on nothing from this read.`,
      code: 'read_page_data_derive_failed',
    }
  }
  // densable In&&Ue → Ixm(workshopTelemetry, slug, ver, state, total, resolved)
  const isWorkshop = doc.name === WORKSHOP_DECISIONS_DOC.name
  if (isWorkshop && islandPresent) {
    const st = derived.derived?.state
    if (st === 'in-progress' || st === 'ready' || st === 'started') {
      const resolved = entries.filter(e => e.state === 'resolved').length
      Ixm(parsed.slug, ver, st, entries.length, resolved)
    }
  }
  const projected = entries.map(row => {
    const out: Record<string, unknown> = {}
    for (const [field, spec] of Object.entries(doc.fields)) {
      const raw = row[field] ?? null
      const kind = (spec as { kind?: string }).kind
      out[field] =
        kind === 'text' && typeof raw === 'string'
          ? (decodeIslandTextField(raw) ?? '')
          : raw
    }
    return out
  })
  return {
    ok: true,
    page_data: {
      url: viewer,
      ver: FRAME_VER_RE.test(ver) ? ver : 'unrecognized-version-shape',
      schema: doc.name,
      islandPresent,
      entries: projected,
      ...(derived.derived !== undefined ? { derived: derived.derived } : {}),
      provenance: { authorship: 'unknown' },
    },
  }
}
