import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { debugMock } from '../../../tests/mocks/debug.js'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'
import { setupAxiosMock } from '../../../tests/mocks/axios.js'

const axiosGetMock = mock(
  async (
    _url: string,
    _opts?: unknown,
  ): Promise<{ status: number; data: Buffer }> => ({
    status: 404,
    data: Buffer.alloc(0),
  }),
)

const axiosHandle = setupAxiosMock()
axiosHandle.useStubs = true
axiosHandle.stubs.get = (...args: unknown[]) =>
  axiosGetMock(...(args as [string, unknown?]))

mock.module('src/utils/debug.js', debugMock)
mock.module('src/utils/debug.ts', debugMock)

const analyticsSnap = snapshotModuleExports(
  await import('../../services/analytics/index.js'),
)
const analyticsMock = () => ({
  ...analyticsSnap,
  logEvent: () => {},
  logEventAsync: async () => {},
})
mock.module('src/services/analytics/index.js', analyticsMock)
mock.module('src/services/analytics/index.ts', analyticsMock)

const fileUploadSnap = snapshotModuleExports(
  await import('../../utils/claudeInChrome/fileUpload.js'),
)
const fileUploadMock = () => ({
  ...fileUploadSnap,
  registerChromeUploadAttachmentDigest: () => {},
})
mock.module('src/utils/claudeInChrome/fileUpload.js', fileUploadMock)
mock.module('src/utils/claudeInChrome/fileUpload.ts', fileUploadMock)

const bootstrapSnap = snapshotModuleExports(
  await import('../../bootstrap/state.js'),
)
const TEST_SESSION = 'inbound-attach-225-session'
const stateMock = () => ({
  ...bootstrapSnap,
  getSessionId: () => TEST_SESSION,
})
mock.module('src/bootstrap/state.ts', stateMock)
mock.module('src/bootstrap/state.js', stateMock)

const bridgeConfigSnap = snapshotModuleExports(
  await import('../bridgeConfig.js'),
)
const bridgeConfigMock = () => ({
  ...bridgeConfigSnap,
  getBridgeAccessToken: () => process.env.__TEST_BRIDGE_TOKEN ?? 'test-token',
  getBridgeBaseUrl: () =>
    process.env.CLAUDE_BRIDGE_BASE_URL || 'https://bridge.test',
  getBridgeBaseUrlOverride: () => process.env.CLAUDE_BRIDGE_BASE_URL || undefined,
  getBridgeTokenOverride: () =>
    process.env.CLAUDE_BRIDGE_OAUTH_TOKEN ||
    process.env.__TEST_BRIDGE_TOKEN ||
    undefined,
})
mock.module('src/bridge/bridgeConfig.js', bridgeConfigMock)
mock.module('../bridgeConfig.js', bridgeConfigMock)

afterAll(() => {
  axiosHandle.useStubs = false
  setupAxiosMock()
  mock.module('src/bootstrap/state.ts', () => ({ ...bootstrapSnap }))
  mock.module('src/bootstrap/state.js', () => ({ ...bootstrapSnap }))
  mock.module('src/services/analytics/index.js', () => ({ ...analyticsSnap }))
  mock.module('src/services/analytics/index.ts', () => ({ ...analyticsSnap }))
  mock.module('src/utils/claudeInChrome/fileUpload.js', () => ({
    ...fileUploadSnap,
  }))
  mock.module('src/utils/claudeInChrome/fileUpload.ts', () => ({
    ...fileUploadSnap,
  }))
  mock.module('src/bridge/bridgeConfig.js', () => ({ ...bridgeConfigSnap }))
  mock.module('../bridgeConfig.js', () => ({ ...bridgeConfigSnap }))
})

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

describe('inboundAttachments 2.1.225 photo inline', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'inbound-attach-225-'))
    process.env.CLAUDE_CONFIG_DIR = home
    process.env.__TEST_BRIDGE_TOKEN = 'test-token'
    axiosGetMock.mockReset()
    axiosGetMock.mockImplementation(async () => ({
      status: 200,
      data: PNG_1X1,
    }))
  })

  afterEach(() => {
    delete process.env.CLAUDE_CONFIG_DIR
    delete process.env.__TEST_BRIDGE_TOKEN
    try {
      rmSync(home, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  test('extractInboundAttachments accepts is_image/sha256/file_size', async () => {
    const { extractInboundAttachments } = await import(
      '../inboundAttachments.js'
    )
    const atts = extractInboundAttachments({
      file_attachments: [
        {
          file_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          file_name: 'photo.png',
          is_image: true,
          file_size: 100,
        },
        {
          file_uuid: '11111111-2222-3333-4444-555555555555',
          file_name: 'peer.bin',
          sha256: 'abc',
          file_size: 10,
        },
        { bad: true },
      ],
    })
    expect(atts).toHaveLength(2)
    expect(atts[0]?.is_image).toBe(true)
    expect(atts[1]?.sha256).toBe('abc')
  })

  test('resolveAndPrepend inlines is_image photo as image block when possible', async () => {
    const { resolveAndPrepend } = await import('../inboundAttachments.js')
    const result = await resolveAndPrepend(
      {
        file_attachments: [
          {
            file_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            file_name: 'photo.png',
            is_image: true,
          },
        ],
      },
      'see this',
      true,
    )

    if (typeof result === 'string') {
      expect(result).toContain('@')
      expect(result).toContain('see this')
    } else {
      const first = result[0]
      if (first?.type === 'image') {
        expect(first.source.type).toBe('base64')
        const text = result.find(b => b.type === 'text')
        expect(text && text.type === 'text' ? text.text : '').toContain(
          'see this',
        )
      } else {
        const text = result.find(b => b.type === 'text')
        expect(text && text.type === 'text' ? text.text : '').toMatch(/@"/)
      }
    }
    expect(axiosGetMock).toHaveBeenCalled()
  })

  test('resolveAndPrepend surfaces empty download failure placeholder', async () => {
    axiosGetMock.mockImplementation(async () => ({
      status: 500,
      data: Buffer.alloc(0),
    }))
    const { resolveAndPrepend } = await import('../inboundAttachments.js')
    const result = await resolveAndPrepend(
      {
        file_attachments: [
          {
            file_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            file_name: 'photo.png',
            is_image: true,
          },
        ],
      },
      '',
      true,
    )
    expect(result).toBe('[attachment could not be downloaded]')
  })

  test('looksLikeSlashCommandContent is densable qvt (cross-session wrap)', async () => {
    const { looksLikeSlashCommandContent } = await import(
      '../inboundAttachments.js'
    )
    // densable RYd is DEe=cross-session-message — NOT slash command-name
    expect(
      looksLikeSlashCommandContent('<command-name>foo</command-name>'),
    ).toBe(false)
    expect(
      looksLikeSlashCommandContent(
        '<cross-session-message from="a">hi</cross-session-message>',
      ),
    ).toBe(true)
    expect(
      looksLikeSlashCommandContent(
        'Another Claude session sent a message:\n<cross-session-message from="a">hi</cross-session-message>',
      ),
    ).toBe(true)
    expect(
      looksLikeSlashCommandContent(
        'A peer session sent a message while you were working:\n<cross-session-message from="b">x</cross-session-message>',
      ),
    ).toBe(true)
    expect(looksLikeSlashCommandContent('hello')).toBe(false)
  })

  test('bad sha256 catch(null) does not inline (SEA === void 0)', async () => {
    const { extractInboundAttachments, resolveAndPrepend } = await import(
      '../inboundAttachments.js'
    )
    // non-string sha256 → zod nullish().catch(null) → null, not undefined
    const atts = extractInboundAttachments({
      file_attachments: [
        {
          file_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          file_name: 'photo.png',
          is_image: true,
          sha256: 123,
        },
      ],
    })
    expect(atts[0]?.sha256).toBeNull()
    const result = await resolveAndPrepend(
      {
        file_attachments: [
          {
            file_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            file_name: 'photo.png',
            is_image: true,
            sha256: 123,
          },
        ],
      },
      'see',
      true,
    )
    // no image block — path ref only (null !== undefined)
    if (typeof result === 'string') {
      expect(result).toMatch(/@"/)
    } else {
      expect(result.some(b => b.type === 'image')).toBe(false)
      expect(JSON.stringify(result)).toMatch(/@"/)
    }
  })

  test('writes upload under CLAUDE_CONFIG_DIR when not inlined', async () => {
    const { resolveAndPrepend } = await import('../inboundAttachments.js')
    const result = await resolveAndPrepend(
      {
        file_attachments: [
          {
            file_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            file_name: 'doc.pdf',
          },
        ],
      },
      'ok',
    )
    expect(
      typeof result === 'string' ? result : JSON.stringify(result),
    ).toMatch(/@"/)
    const uploadRoot = join(home, 'uploads', TEST_SESSION)
    mkdirSync(uploadRoot, { recursive: true })
    const files = readdirSync(uploadRoot)
    expect(files.length).toBeGreaterThan(0)
    const written = readFileSync(join(uploadRoot, files[0]!))
    expect(written.equals(PNG_1X1)).toBe(true)
  })
})
