import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { setFrameDlDepsForTests } from 'src/services/artifactAutoReact/frameDl.js'
import {
  resetArtifactAutoReactStoreForTests,
  un,
} from 'src/services/artifactAutoReact/store.js'
import {
  fetchTypeCatalog,
  freezeArtifactTypes,
  isArtifactQuickstartOn,
  typesPath,
} from '../quickstartCatalog.js'

const ENV_KEYS = [
  'CLAUDE_CODE_ARTIFACT_QUICKSTART',
  'CLAUDE_CODE_ARTIFACT_TYPES',
  'CLAUDE_CODE_ARTIFACT_MULTI_FILE',
  'CLAUDE_CODE_ARTIFACT_TYPE_CATALOG',
  'CLAUDE_CODE_ARTIFACT_TYPE_CLOUD_CREATE',
  'CLAUDE_CODE_REMOTE',
] as const
const savedEnv = Object.fromEntries(
  ENV_KEYS.map(key => [key, process.env[key]]),
)

beforeEach(() => {
  process.env.CLAUDE_CODE_ARTIFACT_CATALOG_RETRY_MS = '0'
})

afterEach(() => {
  setFrameDlDepsForTests(null)
  resetArtifactAutoReactStoreForTests()
  un().frozenArtifactTypes = undefined
  delete process.env.CLAUDE_CODE_ARTIFACT_CATALOG_RETRY_MS
  for (const key of ENV_KEYS) {
    const prev = savedEnv[key]
    if (prev === undefined) delete process.env[key]
    else process.env[key] = prev
  }
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function installCatalogFetch(
  handler: (url: string) => Response | Promise<Response>,
): string[] {
  const urls: string[] = []
  setFrameDlDepsForTests({
    oauthBearer: async () => 'test-oauth',
    claudeAiOrigin: () => 'https://claude.ai',
    isRelayOpen: () => false,
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input)
      urls.push(url)
      return handler(url)
    }) as typeof fetch,
  })
  return urls
}

describe('gold 2.1.289 Artifact quickstart Ace catalog analog', () => {
  test('typesPath omits q when query is omitted', () => {
    expect(typesPath()).toBe('/api/frame/types')
    expect(typesPath(undefined, false)).toBe('/api/frame/types')
  })

  test('typesPath firstParty adds scopes=anthropic', () => {
    expect(typesPath(undefined, true)).toBe('/api/frame/types?scopes=anthropic')
    expect(typesPath('slides', true)).toBe(
      '/api/frame/types?scopes=anthropic&q=slides',
    )
  })

  test('404 is unavailable with empty rows', async () => {
    installCatalogFetch(() => jsonResponse({ types: [] }, 404))
    const result = await fetchTypeCatalog({ firstParty: true })
    expect(result).toEqual({
      err: null,
      rows: [],
      dropped: 0,
      more: false,
      unavailable: true,
    })
  })

  test('firstParty drops rows whose listings lack scope anthropic', async () => {
    const urls = installCatalogFetch(() =>
      jsonResponse({
        types: [
          {
            slug: 'keep',
            title: 'Keep',
            listings: [{ scope: 'anthropic', tier: 'core' }],
          },
          {
            slug: 'drop-scope',
            title: 'Other',
            listings: [{ scope: 'org', tier: 'community' }],
          },
          {
            slug: 'drop-missing',
            title: 'No listings',
          },
        ],
      }),
    )
    const result = await fetchTypeCatalog({ firstParty: true })
    expect(
      urls.some(u => u.includes('/api/frame/types?scopes=anthropic')),
    ).toBe(true)
    expect(result.err).toBeNull()
    expect(result.unavailable).toBe(false)
    expect(result.rows.map(r => r.slug)).toEqual(['keep'])
    expect(result.rows[0]?.typeUrl).toContain('/code/artifact/keep')
    expect(result.rows[0]?.tier).toBe('core')
    expect(result.dropped).toBe(2)
  })

  test('isArtifactQuickstartOn env=1 true env=0 false', () => {
    process.env.CLAUDE_CODE_ARTIFACT_QUICKSTART = '1'
    expect(isArtifactQuickstartOn()).toBe(true)
    process.env.CLAUDE_CODE_ARTIFACT_QUICKSTART = '0'
    expect(isArtifactQuickstartOn()).toBe(false)
  })

  test('frozenArtifactTypes.quickstartOn true pins over env', () => {
    process.env.CLAUDE_CODE_ARTIFACT_QUICKSTART = '0'
    un().frozenArtifactTypes = {
      typesOn: true,
      typeCreateOn: true,
      typeCatalogOn: true,
      quickstartOn: true,
    }
    expect(isArtifactQuickstartOn()).toBe(true)
  })

  test('frozenArtifactTypes.quickstartOn false pins over env', () => {
    process.env.CLAUDE_CODE_ARTIFACT_QUICKSTART = '1'
    un().frozenArtifactTypes = {
      typesOn: true,
      typeCreateOn: true,
      typeCatalogOn: true,
      quickstartOn: false,
    }
    expect(isArtifactQuickstartOn()).toBe(false)
  })

  test('frozenArtifactTypes undefined falls through to env', () => {
    process.env.CLAUDE_CODE_ARTIFACT_QUICKSTART = '1'
    expect(un().frozenArtifactTypes).toBeUndefined()
    expect(isArtifactQuickstartOn()).toBe(true)
    process.env.CLAUDE_CODE_ARTIFACT_QUICKSTART = '0'
    expect(isArtifactQuickstartOn()).toBe(false)
  })

  test('429 after retry → reason rate_limited unique English', async () => {
    let hits = 0
    installCatalogFetch(() => {
      hits++
      return jsonResponse({ error: 'slow down' }, 429)
    })
    const result = await fetchTypeCatalog({ firstParty: true })
    expect(hits).toBe(2)
    expect(result.reason).toBe('rate_limited')
    expect(result.err).toBe(
      'the Artifact type listing: rate limited — wait a little before asking again',
    )
    expect(result.rows).toEqual([])
  })

  test('403 → reason forbidden', async () => {
    installCatalogFetch(() => jsonResponse({ types: [] }, 403))
    const result = await fetchTypeCatalog({ firstParty: true })
    expect(result.reason).toBe('forbidden')
    expect(result.err).toBe(
      'the Artifact type listing: not available to this session — nothing to retry',
    )
  })

  test('malformed types not array → all_rows_dropped unique English', async () => {
    installCatalogFetch(() => jsonResponse({ types: { not: 'an array' } }))
    const result = await fetchTypeCatalog({ firstParty: true })
    expect(result.reason).toBe('all_rows_dropped')
    expect(result.err).toBe(
      'the Artifact type listing could not be read (response rows were unreadable)',
    )
  })

  test('413 → oversize unique English', async () => {
    installCatalogFetch(
      () =>
        new Response('too big', {
          status: 413,
          headers: { 'Content-Type': 'text/plain' },
        }),
    )
    const result = await fetchTypeCatalog({ firstParty: true })
    expect(result.reason).toBe('oversize_body')
    expect(result.err).toBe(
      'the Artifact type listing could not be read (the response was larger than this client accepts)',
    )
  })

  test('freezeArtifactTypes env all-on remote unset → quickstartOn', () => {
    process.env.CLAUDE_CODE_ARTIFACT_TYPES = '1'
    process.env.CLAUDE_CODE_ARTIFACT_MULTI_FILE = '1'
    process.env.CLAUDE_CODE_ARTIFACT_TYPE_CATALOG = '1'
    process.env.CLAUDE_CODE_ARTIFACT_QUICKSTART = '1'
    delete process.env.CLAUDE_CODE_REMOTE
    freezeArtifactTypes()
    const frozen = un().frozenArtifactTypes
    expect(frozen?.typesOn).toBe(true)
    expect(frozen?.typeCreateOn).toBe(true)
    expect(frozen?.typeCatalogOn).toBe(true)
    expect(frozen?.quickstartOn).toBe(true)
  })

  test('freezeArtifactTypes second call does not overwrite pin', () => {
    process.env.CLAUDE_CODE_ARTIFACT_TYPES = '1'
    process.env.CLAUDE_CODE_ARTIFACT_MULTI_FILE = '1'
    process.env.CLAUDE_CODE_ARTIFACT_TYPE_CATALOG = '1'
    process.env.CLAUDE_CODE_ARTIFACT_QUICKSTART = '1'
    delete process.env.CLAUDE_CODE_REMOTE
    freezeArtifactTypes()
    process.env.CLAUDE_CODE_ARTIFACT_TYPES = '0'
    process.env.CLAUDE_CODE_ARTIFACT_QUICKSTART = '0'
    freezeArtifactTypes()
    expect(un().frozenArtifactTypes?.typesOn).toBe(true)
    expect(un().frozenArtifactTypes?.quickstartOn).toBe(true)
  })

  test('freezeArtifactTypes TYPES=0 → typesOn false, no quickstartOn key', () => {
    process.env.CLAUDE_CODE_ARTIFACT_TYPES = '0'
    process.env.CLAUDE_CODE_ARTIFACT_MULTI_FILE = '1'
    process.env.CLAUDE_CODE_ARTIFACT_TYPE_CATALOG = '1'
    process.env.CLAUDE_CODE_ARTIFACT_QUICKSTART = '1'
    delete process.env.CLAUDE_CODE_REMOTE
    freezeArtifactTypes()
    const frozen = un().frozenArtifactTypes
    expect(frozen?.typesOn).toBe(false)
    expect(frozen?.typeCreateOn).toBe(false)
    expect(frozen?.typeCatalogOn).toBe(false)
    expect(frozen).not.toHaveProperty('quickstartOn')
  })

  test('freezeArtifactTypes REMOTE=1 without CLOUD_CREATE → typeCreateOn false', () => {
    process.env.CLAUDE_CODE_ARTIFACT_TYPES = '1'
    process.env.CLAUDE_CODE_ARTIFACT_MULTI_FILE = '1'
    process.env.CLAUDE_CODE_ARTIFACT_TYPE_CATALOG = '1'
    process.env.CLAUDE_CODE_ARTIFACT_QUICKSTART = '1'
    process.env.CLAUDE_CODE_REMOTE = '1'
    delete process.env.CLAUDE_CODE_ARTIFACT_TYPE_CLOUD_CREATE
    freezeArtifactTypes()
    const frozen = un().frozenArtifactTypes
    expect(frozen?.typesOn).toBe(true)
    expect(frozen?.typeCatalogOn).toBe(true)
    expect(frozen?.typeCreateOn).toBe(false)
    expect(frozen).not.toHaveProperty('quickstartOn')
  })

  test('freezeArtifactTypes REMOTE=1 + CLOUD_CREATE=1 → typeCreateOn true', () => {
    process.env.CLAUDE_CODE_ARTIFACT_TYPES = '1'
    process.env.CLAUDE_CODE_ARTIFACT_MULTI_FILE = '1'
    process.env.CLAUDE_CODE_ARTIFACT_TYPE_CATALOG = '1'
    process.env.CLAUDE_CODE_ARTIFACT_QUICKSTART = '1'
    process.env.CLAUDE_CODE_REMOTE = '1'
    process.env.CLAUDE_CODE_ARTIFACT_TYPE_CLOUD_CREATE = '1'
    freezeArtifactTypes()
    const frozen = un().frozenArtifactTypes
    expect(frozen?.typesOn).toBe(true)
    expect(frozen?.typeCatalogOn).toBe(true)
    expect(frozen?.typeCreateOn).toBe(true)
    expect(frozen?.quickstartOn).toBe(true)
  })

  test('isArtifactQuickstartOn after freeze false pin stays false', () => {
    process.env.CLAUDE_CODE_ARTIFACT_TYPES = '0'
    process.env.CLAUDE_CODE_ARTIFACT_MULTI_FILE = '1'
    process.env.CLAUDE_CODE_ARTIFACT_TYPE_CATALOG = '1'
    process.env.CLAUDE_CODE_ARTIFACT_QUICKSTART = '0'
    delete process.env.CLAUDE_CODE_REMOTE
    freezeArtifactTypes()
    process.env.CLAUDE_CODE_ARTIFACT_QUICKSTART = '1'
    expect(isArtifactQuickstartOn()).toBe(false)
  })
})
