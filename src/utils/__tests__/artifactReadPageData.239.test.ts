/**
 * densable uto / RCm / read_page_data island extract (2.1.239).
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
  deriveWorkshopState,
  findIslandIdAttributeSpans,
  freezeReadPageDataSchemaNames,
  hxl,
  Ixm,
  isFirstWorkshopPublish,
  listEnabledInteractionSchemaNames,
  markWorkshopInvokeT0,
  markWorkshopPublishedSeen,
  nestingBudgetExceeded,
  registerWorkshopDecisionsGate,
  resetArtifactAutoReactStoreForTests,
  resetInteractionSchemaGatesForTests,
  runReadPageData,
  un,
  uto,
  validateIslandJsonAgainstSchema,
  WORKSHOP_DECISIONS_DOC,
} from '../../services/artifactAutoReact/index.js'

const SLUG = '11111111-1111-1111-1111-111111111111'
const URL = `https://claude.ai/code/artifact/${SLUG}`

const authMock = {
  getClaudeAIOAuthTokens: mock(() => ({
    accessToken: 'test-oauth',
  })),
}
mock.module('../../utils/auth.js', () => authMock)
mock.module('src/utils/auth.js', () => authMock)

afterEach(() => {
  resetArtifactAutoReactStoreForTests()
  resetInteractionSchemaGatesForTests()
})

function workshopHtml(itemsJson: string): string {
  return `<!doctype html><html><body>
<script id="ws-decisions" type="application/json">${itemsJson}</script>
</body></html>`
}

const openItem = {
  id: 'choose-color',
  opts: ['red', 'blue'],
  state: 'open',
  choice: null,
  custom: null,
}

const getStartedOpen = {
  id: 'get-started',
  opts: ['get-started', 'keep-iterating'],
  state: 'open',
  choice: null,
  custom: null,
}

describe('uto / bJr (239)', () => {
  test('extracts unique script island JSON', async () => {
    const body = JSON.stringify({ items: [openItem] })
    const r = await uto(workshopHtml(body), 'ws-decisions')
    expect(r).not.toBeNull()
    expect(r && 'json' in r ? r.json.trim() : null).toBe(body)
  })

  test('duplicate id → ambiguous', async () => {
    const html = `${workshopHtml('{}')}${workshopHtml('{}')}`
    const r = await uto(html, 'ws-decisions')
    expect(r && 'ambiguous' in r).toBe(true)
  })

  test('absent island → null', async () => {
    expect(await uto('<html></html>', 'ws-decisions')).toBeNull()
  })

  test('variant id quoting (bJr miss, DOM hit) → ambiguous', async () => {
    // densable: id='…' not matched by bJr's id="…", but parse5 finds the attr
    const html =
      '<html><body><script type="application/json" id=\'ws-decisions\'>{"items":[]}</script></body></html>'
    const r = await uto(html, 'ws-decisions')
    expect(r && 'ambiguous' in r).toBe(true)
  })

  test('nesting budget exceeded → ambiguous', async () => {
    const deep = `${'<div>'.repeat(5000)}<script id="ws-decisions" type="application/json">{}</script>${'</div>'.repeat(5000)}`
    expect(nestingBudgetExceeded(deep)).toBe(true)
    const r = await uto(`<html><body>${deep}</body></html>`, 'ws-decisions')
    expect(r && 'ambiguous' in r).toBe(true)
  })

  test('Iwt failClosed: rawtext inside frameset → exceeded', () => {
    const html = '<frameset><style>x</style></frameset>'
    expect(nestingBudgetExceeded(html)).toBe(true)
  })

  test('bJr finds id attribute span', () => {
    const html = `<script id="ws-decisions" type="application/json">{}</script>`
    const spans = findIslandIdAttributeSpans(html, 'ws-decisions')
    expect(spans).toHaveLength(1)
    expect(html.slice(spans[0]![1]).startsWith('{}')).toBe(true)
  })
})

describe('RCm / dto (239)', () => {
  test('validates workshop items and derives ready', () => {
    const json = JSON.stringify({ items: [getStartedOpen] })
    const rows = validateIslandJsonAgainstSchema(json, WORKSHOP_DECISIONS_DOC)
    expect(rows).not.toBeNull()
    expect(deriveWorkshopState(rows as never)).toBe('ready')
  })

  test('open with choice → out of contract', () => {
    const bad = {
      ...openItem,
      choice: 'red',
    }
    expect(
      validateIslandJsonAgainstSchema(
        JSON.stringify({ items: [bad] }),
        WORKSHOP_DECISIONS_DOC,
      ),
    ).toBeNull()
  })
})

describe('runReadPageData (239)', () => {
  test('schema unavailable when workshop gate closed', async () => {
    const r = await runReadPageData({
      url: URL,
      schema: 'workshop-decisions',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('read_page_data_schema_unavailable')
  })

  test('fetches html, extracts island, returns page_data', async () => {
    registerWorkshopDecisionsGate(() => true)
    freezeReadPageDataSchemaNames(true, listEnabledInteractionSchemaNames())
    const body = JSON.stringify({ items: [getStartedOpen, openItem] })
    const prev = globalThis.fetch
    globalThis.fetch = (async input => {
      const u = String(input)
      if (u.includes('/api/frame/')) {
        return new Response(
          JSON.stringify({
            ver: 'v1',
            assetToken: 'atok',
            perm: { role: 'owner' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(workshopHtml(body), {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    }) as typeof fetch
    try {
      const r = await runReadPageData({
        url: URL,
        schema: 'workshop-decisions',
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.page_data.islandPresent).toBe(true)
        expect(r.page_data.schema).toBe('workshop-decisions')
        expect(r.page_data.entries).toHaveLength(2)
        expect(r.page_data.derived?.state).toBe('in-progress')
        expect(r.page_data.ver).toBe('v1')
      }
    } finally {
      globalThis.fetch = prev
    }
  })

  test('ambiguous island → error code', async () => {
    registerWorkshopDecisionsGate(() => true)
    freezeReadPageDataSchemaNames(true, listEnabledInteractionSchemaNames())
    const prev = globalThis.fetch
    globalThis.fetch = (async input => {
      const u = String(input)
      if (u.includes('/api/frame/')) {
        return new Response(JSON.stringify({ ver: 'v1', assetToken: 'atok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(workshopHtml('{}') + workshopHtml('{}'), {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    }) as typeof fetch
    try {
      const r = await runReadPageData({
        url: URL,
        schema: 'workshop-decisions',
      })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe('read_page_data_island_ambiguous')
    } finally {
      globalThis.fetch = prev
    }
  })

  test('Ixm records workshop_turn startedSeen on derived started', async () => {
    registerWorkshopDecisionsGate(() => true)
    freezeReadPageDataSchemaNames(true, listEnabledInteractionSchemaNames())
    const started = {
      id: 'get-started',
      opts: ['get-started', 'keep-iterating'],
      state: 'resolved',
      choice: 'get-started',
      custom: null,
    }
    const body = JSON.stringify({ items: [started] })
    const prev = globalThis.fetch
    globalThis.fetch = (async input => {
      const u = String(input)
      if (u.includes('/api/frame/')) {
        return new Response(
          JSON.stringify({
            ver: '1-abc',
            assetToken: 'atok',
            favicon: 'data:,',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(workshopHtml(body), {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    }) as typeof fetch
    try {
      expect(un().workshopTelemetry.startedSeen).toEqual([])
      const r = await runReadPageData({
        url: URL,
        schema: 'workshop-decisions',
      })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.page_data.derived?.state).toBe('started')
      expect(un().workshopTelemetry.startedSeen).toContain(SLUG)
      // second Ixm should not duplicate
      Ixm(SLUG, '1-abc', 'started', 1, 1)
      expect(
        un().workshopTelemetry.startedSeen.filter(s => s === SLUG),
      ).toHaveLength(1)
    } finally {
      globalThis.fetch = prev
    }
  })

  test('hxl publish-side: first_page + completed on structural deliverables', () => {
    markWorkshopInvokeT0()
    expect(un().workshopTelemetry.invokeT0).not.toBeNull()
    hxl(SLUG, '1-abc', 'ready', { n: 2, pr: 1, artifact: 1, other: 0 }, true)
    expect(un().workshopTelemetry.invokeT0).toBeNull()
    expect(un().workshopTelemetry.completedSeen).toContain(SLUG)
  })

  test('isFirstWorkshopPublish latches after markWorkshopPublishedSeen', () => {
    expect(isFirstWorkshopPublish(SLUG)).toBe(true)
    markWorkshopPublishedSeen(SLUG)
    expect(isFirstWorkshopPublish(SLUG)).toBe(false)
  })
})
