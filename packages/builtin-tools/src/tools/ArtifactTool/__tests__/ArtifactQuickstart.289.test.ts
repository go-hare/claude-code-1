import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'

import * as realFilesystem from 'src/utils/permissions/filesystem.js'
import { snapshotModuleExports } from '../../../../../../tests/mocks/settings.js'

const filesystemSnap = snapshotModuleExports(realFilesystem)
let scratchOn = false
mock.module('src/utils/permissions/filesystem.js', () => ({
  ...filesystemSnap,
  isScratchpadEnabled: () => scratchOn,
}))
afterAll(() => {
  mock.module('src/utils/permissions/filesystem.js', () => ({
    ...filesystemSnap,
  }))
})

import { setFrameDlDepsForTests } from 'src/services/artifactAutoReact/frameDl.js'
import { resetArtifactAutoReactStoreForTests } from 'src/services/artifactAutoReact/store.js'
import { ArtifactTool } from '../ArtifactTool.js'
import { isArtifactActionReadOnly } from '../permissions.js'
import { freezeArtifactTypes } from '../quickstartCatalog.js'
import {
  ArtifactQuickstartUnavailableError,
  callQuickstart,
  classifyQuickstartInput,
  formatQuickstartResult,
  isDocsConnectorAttached,
  QUICKSTART_UNAVAILABLE,
  validateQuickstartInput,
} from '../quickstart.js'
import { clearQuickstartSession } from '../quickstartSession.js'

const originalFetch = globalThis.fetch

beforeEach(() => {
  resetArtifactAutoReactStoreForTests()
  process.env.CLAUDE_CODE_ARTIFACT_QUICKSTART = '1'
  clearQuickstartSession()
})

afterEach(() => {
  scratchOn = false
  globalThis.fetch = originalFetch
  setFrameDlDepsForTests(null)
  delete process.env.CLAUDE_CODE_ARTIFACT_START_KIT
  delete process.env.CLAUDE_CODE_ARTIFACT_QUICKSTART
  delete process.env.CLAUDE_CODE_ARTIFACT_MULTI_FILE
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function installDlFetch(
  handler: (url: string) => Response | Promise<Response>,
): string[] {
  const urls: string[] = []
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input)
    urls.push(url)
    return handler(url)
  }) as typeof fetch
  globalThis.fetch = fetchImpl
  setFrameDlDepsForTests({
    oauthBearer: async () => 'test-oauth',
    claudeAiOrigin: () => 'https://claude.ai',
    isRelayOpen: () => false,
    fetch: fetchImpl,
  })
  return urls
}

describe('gold 2.1.289 Artifact quickstart analog', () => {
  test('quickstart is read-only', () => {
    expect(isArtifactActionReadOnly({ action: 'quickstart' })).toBe(true)
    expect(
      ArtifactTool.isReadOnly({ action: 'quickstart', intent: 'design' }),
    ).toBe(true)
  })

  test('document without Docs connector skips Ace', async () => {
    const urls = installDlFetch(() => jsonResponse({ types: [] }))
    const result = await callQuickstart({
      action: 'quickstart',
      intent: 'document',
    })
    expect(urls).toHaveLength(0)
    expect(result.data.quickstart).toMatchObject({
      intent: 'document',
      docs_connector: false,
    })
    expect(formatQuickstartResult(result.data)).toContain(
      'No first-party Claude Docs connector',
    )
  })

  test('other runs firstParty Ace and a second Ace without scopes', async () => {
    const urls = installDlFetch(async (url: string) => {
      if (url.includes('scopes=anthropic')) {
        return jsonResponse({
          types: [
            {
              slug: 'dash-1',
              title: 'Dashboard',
              listings: [{ scope: 'anthropic', tier: 'core' }],
            },
          ],
        })
      }
      return jsonResponse({
        types: [
          {
            slug: 'a',
            title: 'Alpha',
            listings: [{ scope: 'anthropic', tier: 'community' }],
          },
          { slug: 'b', title: 'Beta' },
          {
            slug: 'docs-1',
            title: 'Docs',
            listings: [{ scope: 'anthropic', tier: 'core' }],
          },
        ],
      })
    })
    const result = await callQuickstart({
      action: 'quickstart',
      intent: 'other',
      design_systems: false,
    })
    expect(
      urls.some(u => u.includes('/api/frame/types?scopes=anthropic')),
    ).toBe(true)
    expect(
      urls.some(
        u => u.includes('/api/frame/types') && !u.includes('scopes=anthropic'),
      ),
    ).toBe(true)
    const bag = result.data.quickstart as {
      types: Array<{ title: string }>
      dashboard_type?: { title: string }
      docs_connector?: boolean
      design_systems_off?: boolean
    }
    expect(bag.types.map(t => t.title)).toEqual(['Alpha', 'Beta'])
    expect(bag.dashboard_type?.title).toBe('Dashboard')
    expect(bag.docs_connector).toBe(false)
    expect(bag.design_systems_off).toBe(true)
  })

  test('design unique-core match lists design systems', async () => {
    installDlFetch(async (url: string) => {
      if (url.includes('/instances')) {
        return jsonResponse({
          instances: [
            {
              slug: 'sys-1',
              title: 'Acme',
              rel: 'mine',
              default: 'user',
            },
          ],
        })
      }
      return jsonResponse({
        types: [
          {
            slug: 'design-core',
            title: 'Design',
            listings: [{ scope: 'anthropic', tier: 'core' }],
          },
          {
            slug: 'ds-type',
            title: 'Design System',
            listings: [{ scope: 'anthropic', tier: 'core' }],
          },
        ],
      })
    })
    const result = await callQuickstart({
      action: 'quickstart',
      intent: 'design',
    })
    const bag = result.data.quickstart as {
      match: { title: string; type_url: string }
      design_systems: { instances: Array<{ title: string; default?: string }> }
      design_system: { title: string; url: string }
    }
    expect(bag.match.title).toBe('Design')
    expect(bag.match.type_url).toContain('/code/artifact/design-core')
    expect(bag.design_systems.instances[0]?.title).toBe('Acme')
    expect(bag.design_system.title).toBe('Acme')
    expect(formatQuickstartResult(result.data)).toContain(
      'listing the design systems',
    )
  })

  test('start-kit bag when CLAUDE_CODE_ARTIFACT_START_KIT is on', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_START_KIT = '1'
    installDlFetch(async (url: string) => {
      if (url.includes('/instances')) {
        return jsonResponse({ instances: [] })
      }
      if (url.includes('/files/SKILL.md')) {
        return jsonResponse({ path: 'SKILL.md', text: '# Slides type\n' })
      }
      if (url.endsWith('/api/frame/types/slides-1')) {
        return jsonResponse({
          files: ['SKILL.md', 'artifact-type/reference/a.md'],
        })
      }
      if (url.includes('/files/artifact-type/')) {
        return jsonResponse({
          path: 'artifact-type/reference/a.md',
          text: 'page',
        })
      }
      return jsonResponse({
        types: [
          {
            slug: 'slides-1',
            title: 'Slides',
            listings: [{ scope: 'anthropic', tier: 'core' }],
          },
        ],
      })
    })
    const result = await callQuickstart({
      action: 'quickstart',
      intent: 'slides',
      design_systems: false,
    })
    const bag = result.data.quickstart as {
      start_kit?: {
        type?: { dir?: string; files?: Array<{ path: string }> }
        not_saved?: string
      }
    }
    expect(bag.start_kit?.type?.dir || bag.start_kit?.not_saved).toBeTruthy()
    if (bag.start_kit?.type?.dir) {
      expect(bag.start_kit.type.files?.some(f => f.path === 'SKILL.md')).toBe(
        true,
      )
    }
  })

  test('deny/ask list_types rule sets types_ruled and skips Ace', async () => {
    const urls = installDlFetch(() => jsonResponse({ types: [] }))
    const result = await callQuickstart(
      { action: 'quickstart', intent: 'slides' },
      {
        getAppState: () => ({
          toolPermissionContext: {
            alwaysDenyRules: { user: ['Artifact(list_types)'] },
            alwaysAskRules: {},
          },
        }),
      } as never,
    )
    expect(urls).toHaveLength(0)
    expect(result.data.quickstart).toMatchObject({
      intent: 'slides',
      types_ruled: true,
    })
  })

  test('object-form {action:list,scope:types} deny sets types_ruled and skips Ace', async () => {
    const urls = installDlFetch(() => jsonResponse({ types: [] }))
    const result = await callQuickstart(
      { action: 'quickstart', intent: 'design' },
      {
        getAppState: () => ({
          toolPermissionContext: {
            alwaysDenyRules: {
              user: ['Artifact({action:list,scope:types})'],
            },
            alwaysAskRules: {},
          },
        }),
      } as never,
    )
    expect(urls).toHaveLength(0)
    expect(result.data.quickstart).toMatchObject({
      intent: 'design',
      types_ruled: true,
    })
  })

  test('start-kit skips path traversal in reference files', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_START_KIT = '1'
    installDlFetch(async (url: string) => {
      if (url.includes('/files/SKILL.md')) {
        return jsonResponse({ path: 'SKILL.md', text: '# ok\n' })
      }
      if (url.endsWith('/api/frame/types/slides-trav')) {
        return jsonResponse({
          files: [
            'SKILL.md',
            'artifact-type/reference/../../../../../../tmp/qs-escape.txt',
          ],
        })
      }
      return jsonResponse({
        types: [
          {
            slug: 'slides-trav',
            title: 'Slides',
            listings: [{ scope: 'anthropic', tier: 'core' }],
          },
        ],
      })
    })
    const result = await callQuickstart({
      action: 'quickstart',
      intent: 'slides',
      design_systems: false,
    })
    const bag = result.data.quickstart as {
      start_kit?: {
        type?: { dir?: string; files?: Array<{ path: string }> }
      }
    }
    const paths = bag.start_kit?.type?.files?.map(f => f.path) ?? []
    expect(paths.some(p => p.includes('..'))).toBe(false)
  })

  test('isDocsConnectorAttached needs claudeai-proxy Docs name', () => {
    expect(isDocsConnectorAttached(undefined)).toBe(false)
    expect(
      isDocsConnectorAttached([
        {
          type: 'connected',
          name: 'claudedocs',
          serverInfo: { name: 'claudedocs', version: '1' },
          config: { type: 'claudeai-proxy', scope: 'claudeai' },
        } as never,
      ]),
    ).toBe(true)
  })

  test('validateQuickstartInput rejects extra keys', () => {
    const extra = validateQuickstartInput({
      action: 'quickstart',
      intent: 'slides',
      foo: 1,
    })
    expect(extra.result).toBe(false)
    if (extra.result === false) {
      expect(extra.message).toContain(
        'action "quickstart" takes only `intent` and `design_systems`',
      )
      expect(extra.message).toContain('foo')
      expect(extra.errorCode).toBe(8)
    }
  })

  test('classifyQuickstartInput unique English for document', () => {
    expect(
      classifyQuickstartInput({ intent: 'document', design_systems: true }),
    ).toBe(
      'quickstart (read-only, intent: document): lists the published Artifact types — titles and descriptions their publishers wrote',
    )
  })

  test('start-kit skips community-only match as not listed first-party', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_START_KIT = '1'
    installDlFetch(() =>
      jsonResponse({
        types: [
          {
            slug: 'slides-community',
            title: 'Slides',
            listings: [{ scope: 'anthropic', tier: 'community' }],
          },
        ],
      }),
    )
    const result = await callQuickstart({
      action: 'quickstart',
      intent: 'slides',
      design_systems: false,
    })
    const bag = result.data.quickstart as {
      start_kit?: { not_saved?: string }
    }
    expect(bag.start_kit?.not_saved).toBe('not listed first-party')
  })

  test('start-kit skips font files under googleapis/gstatic', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_START_KIT = '1'
    installDlFetch(async (url: string) => {
      if (url.includes('/files/SKILL.md')) {
        return jsonResponse({ path: 'SKILL.md', text: '# ok\n' })
      }
      if (url.endsWith('/api/frame/types/slides-font')) {
        return jsonResponse({
          files: [
            'SKILL.md',
            'artifact-type/reference/fonts.googleapis.com/css2',
            'artifact-type/reference/ok.md',
          ],
        })
      }
      if (url.includes('/files/artifact-type/')) {
        return jsonResponse({
          path: 'artifact-type/reference/ok.md',
          text: 'page',
        })
      }
      return jsonResponse({
        types: [
          {
            slug: 'slides-font',
            title: 'Slides',
            listings: [{ scope: 'anthropic', tier: 'core' }],
          },
        ],
      })
    })
    const result = await callQuickstart({
      action: 'quickstart',
      intent: 'slides',
      design_systems: false,
    })
    const bag = result.data.quickstart as {
      start_kit?: { type?: { files?: Array<{ path: string }> } }
    }
    const paths = bag.start_kit?.type?.files?.map(f => f.path) ?? []
    expect(paths.some(p => p.includes('googleapis'))).toBe(false)
  })

  test('start-kit lists no SKILL.md when the type file is missing', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_START_KIT = '1'
    installDlFetch(async (url: string) => {
      if (url.includes('/files/SKILL.md')) {
        return jsonResponse({ error: 'missing' }, 404)
      }
      if (url.endsWith('/api/frame/types/slides-noskill')) {
        return jsonResponse({ files: ['artifact-type/reference/a.md'] })
      }
      return jsonResponse({
        types: [
          {
            slug: 'slides-noskill',
            title: 'Slides',
            listings: [{ scope: 'anthropic', tier: 'core' }],
          },
        ],
      })
    })
    const result = await callQuickstart({
      action: 'quickstart',
      intent: 'slides',
      design_systems: false,
    })
    const bag = result.data.quickstart as {
      start_kit?: { not_saved?: string }
    }
    expect(bag.start_kit?.not_saved).toBe('it lists no SKILL.md')
  })

  test('start-kit without a session scratchpad: its files did not land (joe null)', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_START_KIT = '1'
    scratchOn = false
    installDlFetch(async (url: string) => {
      if (url.includes('/files/SKILL.md')) {
        return jsonResponse({ path: 'SKILL.md', text: '# skill' })
      }
      if (url.endsWith('/api/frame/types/slides-clip')) {
        return jsonResponse({ files: ['SKILL.md'] })
      }
      return jsonResponse({
        types: [
          {
            slug: 'slides-clip',
            title: 'Slides',
            listings: [{ scope: 'anthropic', tier: 'core' }],
          },
        ],
      })
    })
    const result = await callQuickstart({
      action: 'quickstart',
      intent: 'slides',
      design_systems: false,
    })
    const bag = result.data.quickstart as {
      start_kit?: { not_saved?: string; type?: { not_saved?: string } }
    }
    expect(bag.start_kit?.not_saved ?? bag.start_kit?.type?.not_saved).toBe(
      'its files did not land',
    )
  })

  test('start-kit skill_in_result is false when SKILL.md exceeds TYPE_FILE_MAX_CHARS', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_START_KIT = '1'
    scratchOn = true
    const longSkill = `${'x'.repeat(20_001)}`
    installDlFetch(async (url: string) => {
      if (url.includes('/files/SKILL.md')) {
        return jsonResponse({ path: 'SKILL.md', text: longSkill })
      }
      if (url.endsWith('/api/frame/types/slides-clip')) {
        return jsonResponse({ files: ['SKILL.md'] })
      }
      return jsonResponse({
        types: [
          {
            slug: 'slides-clip',
            title: 'Slides',
            listings: [{ scope: 'anthropic', tier: 'core' }],
          },
        ],
      })
    })
    const result = await callQuickstart({
      action: 'quickstart',
      intent: 'slides',
      design_systems: false,
    })
    const bag = result.data.quickstart as {
      start_kit?: {
        skill_in_result?: boolean
        type?: { skill_in_result?: boolean }
      }
    }
    expect(
      bag.start_kit?.skill_in_result ?? bag.start_kit?.type?.skill_in_result,
    ).toBe(false)
  })

  test('design unique-core store README sets design_system.store', async () => {
    installDlFetch(async (url: string) => {
      if (url.includes('/db/agent')) {
        return jsonResponse({
          exists: true,
          data: { data: '# store readme' },
        })
      }
      if (url.includes('/instances')) {
        return jsonResponse({
          instances: [
            {
              slug: 'sys-store',
              title: 'Acme Store',
              rel: 'mine',
              default: 'user',
            },
          ],
        })
      }
      if (/\/api\/frame\/files\/sys-store\/?$/.test(url)) {
        return jsonResponse({
          files: [{ path: 'README.md', content_type: 'text/markdown' }],
        })
      }
      return jsonResponse({
        types: [
          {
            slug: 'design-core',
            title: 'Design',
            listings: [{ scope: 'anthropic', tier: 'core' }],
          },
          {
            slug: 'ds-type',
            title: 'Design System',
            listings: [{ scope: 'anthropic', tier: 'core' }],
          },
        ],
      })
    })
    const result = await callQuickstart({
      action: 'quickstart',
      intent: 'design',
    })
    const bag = result.data.quickstart as {
      design_system: {
        store?: true
        docs?: Array<{ path: string; text: string }>
      }
    }
    expect(bag.design_system.store).toBe(true)
    expect(bag.design_system.docs?.[0]?.text).toContain('store readme')
    expect(formatQuickstartResult(result.data)).toContain('action "read_db"')
    expect(formatQuickstartResult(result.data)).toContain(
      '`doc_id`: "tokens.md"',
    )
  })

  test('project/README.md files path does not set store', async () => {
    // Gold Zhe/MP: published files are read only when multi-file is on.
    process.env.CLAUDE_CODE_ARTIFACT_MULTI_FILE = '1'
    installDlFetch(async (url: string) => {
      if (url.includes('/db/agent')) {
        return jsonResponse({
          exists: true,
          data: { data: '# store should lose' },
        })
      }
      if (url.includes('/instances')) {
        return jsonResponse({
          instances: [
            {
              slug: 'sys-project',
              title: 'Acme Files',
              rel: 'mine',
              default: 'org',
            },
          ],
        })
      }
      if (url.includes('project/README.md')) {
        return jsonResponse({
          path: 'project/README.md',
          text: '# files project readme',
        })
      }
      if (/\/api\/frame\/files\/sys-project\/?$/.test(url)) {
        return jsonResponse({
          files: [{ path: 'project/README.md', content_type: 'text/markdown' }],
        })
      }
      // densable M/listArtifactFiles boots /api/frame/{slug}?via=model_read first.
      if (/\/api\/frame\/sys-project(\?|$)/.test(url)) {
        return jsonResponse({
          ver: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          assetToken: 'tok',
          mode: 'org',
          perm: { role: 'owner' },
          fileCount: 1,
        })
      }
      return jsonResponse({
        types: [
          {
            slug: 'design-core',
            title: 'Design',
            listings: [{ scope: 'anthropic', tier: 'core' }],
          },
          {
            slug: 'ds-type',
            title: 'Design System',
            listings: [{ scope: 'anthropic', tier: 'core' }],
          },
        ],
      })
    })
    const result = await callQuickstart({
      action: 'quickstart',
      intent: 'design',
    })
    const bag = result.data.quickstart as {
      design_system: {
        store?: true
        docs?: Array<{ path: string; text: string }>
      }
    }
    expect(bag.design_system.store).toBeUndefined()
    expect(bag.design_system.docs?.[0]?.path).toBe('project/README.md')
    expect(formatQuickstartResult(result.data)).not.toContain(
      'action "read_db"',
    )
  })

  test('deny Artifact(read) skips README fetch with ruled unique English', async () => {
    const urls = installDlFetch(async (url: string) => {
      if (url.includes('/instances')) {
        return jsonResponse({
          instances: [
            {
              slug: 'sys-ruled',
              title: 'Acme Ruled',
              rel: 'mine',
              default: 'user',
            },
          ],
        })
      }
      return jsonResponse({
        types: [
          {
            slug: 'design-core',
            title: 'Design',
            listings: [{ scope: 'anthropic', tier: 'core' }],
          },
          {
            slug: 'ds-type',
            title: 'Design System',
            listings: [{ scope: 'anthropic', tier: 'core' }],
          },
        ],
      })
    })
    const result = await callQuickstart(
      { action: 'quickstart', intent: 'design' },
      {
        getAppState: () => ({
          toolPermissionContext: {
            alwaysDenyRules: { user: ['Artifact(read)'] },
            alwaysAskRules: {},
          },
        }),
      } as never,
    )
    const bag = result.data.quickstart as {
      design_system: { unavailable?: string }
    }
    expect(bag.design_system.unavailable).toContain(
      'a permission rule governs reading it',
    )
    expect(urls.some(u => u.includes('/db/agent'))).toBe(false)
  })

  test('deny Artifact(read_db) skips store GET but still reads files README', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_MULTI_FILE = '1'
    const urls = installDlFetch(async (url: string) => {
      if (url.includes('/instances')) {
        return jsonResponse({
          instances: [
            {
              slug: 'sys-store-ruled',
              title: 'Acme Files',
              rel: 'mine',
              default: 'user',
            },
          ],
        })
      }
      if (url.includes('project/README.md')) {
        return jsonResponse({
          path: 'project/README.md',
          text: '# files project readme',
        })
      }
      if (/\/api\/frame\/files\/sys-store-ruled\/?$/.test(url)) {
        return jsonResponse({
          files: [{ path: 'project/README.md', content_type: 'text/markdown' }],
        })
      }
      // densable M/listArtifactFiles boots /api/frame/{slug}?via=model_read first.
      if (/\/api\/frame\/sys-store-ruled(\?|$)/.test(url)) {
        return jsonResponse({
          ver: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          assetToken: 'tok',
          mode: 'org',
          perm: { role: 'owner' },
          fileCount: 1,
        })
      }
      return jsonResponse({
        types: [
          {
            slug: 'design-core',
            title: 'Design',
            listings: [{ scope: 'anthropic', tier: 'core' }],
          },
          {
            slug: 'ds-type',
            title: 'Design System',
            listings: [{ scope: 'anthropic', tier: 'core' }],
          },
        ],
      })
    })
    const result = await callQuickstart(
      { action: 'quickstart', intent: 'design' },
      {
        getAppState: () => ({
          toolPermissionContext: {
            alwaysDenyRules: { user: ['Artifact(read_db)'] },
            alwaysAskRules: {},
          },
        }),
      } as never,
    )
    const bag = result.data.quickstart as {
      design_system: {
        store?: true
        docs?: Array<{ path: string }>
        unavailable?: string
      }
    }
    expect(urls.some(u => u.includes('/db/agent'))).toBe(false)
    expect(bag.design_system.store).toBeUndefined()
    expect(bag.design_system.docs?.[0]?.path).toBe('project/README.md')
    // Gold j: a project/README.md doc suppresses the store-ruled note.
    expect(bag.design_system.unavailable).toBeUndefined()
  })

  test('root README plus deny read_db keeps the store-ruled note', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_MULTI_FILE = '1'
    const urls = installDlFetch(async (url: string) => {
      if (url.includes('/instances')) {
        return jsonResponse({
          instances: [
            {
              slug: 'sys-root-ruled',
              title: 'Acme Root',
              rel: 'mine',
              default: 'user',
            },
          ],
        })
      }
      if (url.includes('project/README.md')) {
        return jsonResponse({ error: 'missing' }, 404)
      }
      if (url.includes('/README.md')) {
        return jsonResponse({
          path: 'README.md',
          text: '# published root',
        })
      }
      if (/\/api\/frame\/sys-root-ruled(\?|$)/.test(url)) {
        return jsonResponse({
          ver: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          assetToken: 'tok',
          mode: 'org',
          perm: { role: 'owner' },
          fileCount: 1,
        })
      }
      return jsonResponse({
        types: [
          {
            slug: 'design-core',
            title: 'Design',
            listings: [{ scope: 'anthropic', tier: 'core' }],
          },
          {
            slug: 'ds-type',
            title: 'Design System',
            listings: [{ scope: 'anthropic', tier: 'core' }],
          },
        ],
      })
    })
    const result = await callQuickstart(
      { action: 'quickstart', intent: 'design' },
      {
        getAppState: () => ({
          toolPermissionContext: {
            alwaysDenyRules: { user: ['Artifact(read_db)'] },
            alwaysAskRules: {},
          },
        }),
      } as never,
    )
    const bag = result.data.quickstart as {
      design_system: {
        store?: true
        docs?: Array<{ path: string }>
        unavailable?: string
      }
    }
    expect(urls.some(u => u.includes('/db/agent'))).toBe(false)
    expect(bag.design_system.store).toBeUndefined()
    expect(bag.design_system.docs?.[0]?.path).toBe('README.md')
    expect(bag.design_system.unavailable).toContain(
      'a permission rule governs reading its store',
    )
  })

  test('store HTTP 500 with empty files list surfaces unique English', async () => {
    installDlFetch(async (url: string) => {
      if (url.includes('/db/agent')) {
        return jsonResponse({ error: 'store down' }, 500)
      }
      if (url.includes('/instances')) {
        return jsonResponse({
          instances: [
            {
              slug: 'sys-500',
              title: 'Acme Down',
              rel: 'mine',
              default: 'user',
            },
          ],
        })
      }
      if (/\/api\/frame\/files\/sys-500\/?$/.test(url)) {
        return jsonResponse({ files: [] })
      }
      return jsonResponse({
        types: [
          {
            slug: 'design-core',
            title: 'Design',
            listings: [{ scope: 'anthropic', tier: 'core' }],
          },
          {
            slug: 'ds-type',
            title: 'Design System',
            listings: [{ scope: 'anthropic', tier: 'core' }],
          },
        ],
      })
    })
    const result = await callQuickstart({
      action: 'quickstart',
      intent: 'design',
    })
    const bag = result.data.quickstart as {
      design_system: { unavailable?: string }
    }
    expect(bag.design_system.unavailable).toContain(
      'its store could not be read (HTTP 500)',
    )
  })

  test('callQuickstart with env 0 throws ArtifactInputError quickstart_unavailable', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_QUICKSTART = '0'
    let thrown: unknown
    try {
      await callQuickstart({ action: 'quickstart', intent: 'design' })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ArtifactQuickstartUnavailableError)
    expect(thrown).toMatchObject({
      name: 'ArtifactInputError',
      reasonCode: 'quickstart_unavailable',
      message: QUICKSTART_UNAVAILABLE,
    })
  })

  test('callQuickstart with freeze pin false throws ArtifactInputError quickstart_unavailable', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_TYPES = '0'
    process.env.CLAUDE_CODE_ARTIFACT_MULTI_FILE = '1'
    process.env.CLAUDE_CODE_ARTIFACT_TYPE_CATALOG = '1'
    process.env.CLAUDE_CODE_ARTIFACT_QUICKSTART = '0'
    freezeArtifactTypes()
    process.env.CLAUDE_CODE_ARTIFACT_QUICKSTART = '1'
    let thrown: unknown
    try {
      await callQuickstart({ action: 'quickstart', intent: 'slides' })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ArtifactQuickstartUnavailableError)
    expect(thrown).toMatchObject({
      name: 'ArtifactInputError',
      reasonCode: 'quickstart_unavailable',
      message: QUICKSTART_UNAVAILABLE,
    })
    delete process.env.CLAUDE_CODE_ARTIFACT_TYPES
    delete process.env.CLAUDE_CODE_ARTIFACT_MULTI_FILE
    delete process.env.CLAUDE_CODE_ARTIFACT_TYPE_CATALOG
  })

  test('start_kit bag has capabilities_skill and repl_tool false when kit saved', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_START_KIT = '1'
    installDlFetch(async (url: string) => {
      if (url.includes('/files/SKILL.md')) {
        return jsonResponse({ path: 'SKILL.md', text: '# Slides type\n' })
      }
      if (url.endsWith('/api/frame/types/slides-kit-flags')) {
        return jsonResponse({ files: ['SKILL.md'] })
      }
      return jsonResponse({
        types: [
          {
            slug: 'slides-kit-flags',
            title: 'Slides',
            listings: [{ scope: 'anthropic', tier: 'core' }],
          },
        ],
      })
    })
    const result = await callQuickstart({
      action: 'quickstart',
      intent: 'slides',
      design_systems: false,
    })
    const bag = result.data.quickstart as {
      start_kit?: {
        capabilities_skill?: boolean
        repl_tool?: boolean
        type?: { dir?: string }
        not_saved?: string
      }
    }
    expect(bag.start_kit?.type?.dir || bag.start_kit?.not_saved).toBeTruthy()
    expect(bag.start_kit?.capabilities_skill).toBe(false)
    expect(bag.start_kit?.repl_tool).toBe(false)
  })
})
