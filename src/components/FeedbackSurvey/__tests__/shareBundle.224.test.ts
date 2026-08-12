/**
 * densable Y7t / hBa / m0t — share bundle helpers.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { unzipSync } from 'fflate'
import { logMock } from '../../../../tests/mocks/log.js'
import { debugMock } from '../../../../tests/mocks/debug.js'

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/log.js', logMock)
mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/debug.js', debugMock)

let authError: string | undefined
mock.module('src/utils/http.ts', () => ({
  getAuthHeaders: () =>
    authError
      ? { headers: {}, error: authError }
      : { headers: { Authorization: 'Bearer t' } },
  getUserAgent: () => 'test-agent',
}))
mock.module('src/utils/http.js', () => ({
  getAuthHeaders: () =>
    authError
      ? { headers: {}, error: authError }
      : { headers: { Authorization: 'Bearer t' } },
  getUserAgent: () => 'test-agent',
}))

let mockProvider: string = 'firstParty'
const realProviders = await import('../../../utils/model/providers.js')
const providersOverlay = () => ({
  ...realProviders,
  getAPIProvider: () => mockProvider,
})
mock.module('src/utils/model/providers.ts', providersOverlay)
mock.module('src/utils/model/providers.js', providersOverlay)

const {
  encodeShareRequestBody,
  resolveTranscriptShareMode,
  writeFeedbackBundleZip,
  SHARE_STREAM_ARRAY_KEYS,
  SHARE_STREAM_OBJECT_ARRAY_KEYS,
} = await import('../shareBundle.js')

describe('densable Y7t encodeShareRequestBody', () => {
  test('wraps payload in content string + extraOuterFields', () => {
    const buf = encodeShareRequestBody(
      { trigger: 'frustration', transcript: [{ id: 1 }], n: 2 },
      { extraOuterFields: { appearance_id: 'app-x' } },
    )
    const outer = JSON.parse(buf.toString('utf8')) as {
      content: string
      appearance_id: string
    }
    expect(outer.appearance_id).toBe('app-x')
    const inner = JSON.parse(outer.content) as {
      trigger: string
      transcript: unknown[]
      n: number
    }
    expect(inner.trigger).toBe('frustration')
    expect(inner.transcript).toEqual([{ id: 1 }])
    expect(inner.n).toBe(2)
  })

  test('streams subagentTranscripts object-of-arrays', () => {
    const buf = encodeShareRequestBody({
      subagentTranscripts: {
        a1: [{ role: 'user' }],
        a2: [{ role: 'assistant' }, { role: 'user' }],
      },
    })
    const outer = JSON.parse(buf.toString('utf8')) as { content: string }
    const inner = JSON.parse(outer.content) as {
      subagentTranscripts: Record<string, unknown[]>
    }
    expect(inner.subagentTranscripts.a1).toEqual([{ role: 'user' }])
    expect(inner.subagentTranscripts.a2).toHaveLength(2)
  })

  test('skips undefined fields', () => {
    const buf = encodeShareRequestBody({
      a: 1,
      b: undefined,
    })
    const outer = JSON.parse(buf.toString('utf8')) as { content: string }
    expect(JSON.parse(outer.content)).toEqual({ a: 1 })
  })

  test('default stream key sets match densable mmh/hmh', () => {
    expect([...SHARE_STREAM_ARRAY_KEYS]).toEqual(['transcript'])
    expect([...SHARE_STREAM_OBJECT_ARRAY_KEYS]).toEqual(['subagentTranscripts'])
  })
})

describe('densable m0t resolveTranscriptShareMode', () => {
  beforeEach(() => {
    mockProvider = 'firstParty'
    authError = undefined
  })

  test('firstParty + auth → post', () => {
    expect(resolveTranscriptShareMode()).toEqual({ kind: 'post' })
  })

  test('non-firstParty → bundle provider', () => {
    mockProvider = 'bedrock'
    expect(resolveTranscriptShareMode()).toEqual({
      kind: 'bundle',
      cause: 'provider',
      label: 'bedrock',
    })
  })

  test('firstParty no creds → bundle no_creds', () => {
    authError = 'No API key available'
    expect(resolveTranscriptShareMode()).toEqual({
      kind: 'bundle',
      cause: 'no_creds',
      label: 'no Anthropic credentials',
    })
  })
})

describe('densable hBa writeFeedbackBundleZip', () => {
  let tmpConfig: string
  const prevConfig = process.env.CLAUDE_CONFIG_DIR

  beforeEach(() => {
    tmpConfig = mkdtempSync(join(tmpdir(), 'cc-feedback-bundle-'))
    process.env.CLAUDE_CONFIG_DIR = tmpConfig
    // clear memoize on getClaudeConfigHomeDir
    const { getClaudeConfigHomeDir } =
      require('../../../utils/envUtils.js') as {
        getClaudeConfigHomeDir: { cache?: { clear?: () => void } }
      }
    getClaudeConfigHomeDir.cache?.clear?.()
  })

  afterEach(() => {
    if (prevConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevConfig
    const { getClaudeConfigHomeDir } =
      require('../../../utils/envUtils.js') as {
        getClaudeConfigHomeDir: { cache?: { clear?: () => void } }
      }
    getClaudeConfigHomeDir.cache?.clear?.()
    rmSync(tmpConfig, { recursive: true, force: true })
  })

  test('writes zip with transcript.json entry under feedback-bundles/', async () => {
    const body = encodeShareRequestBody(
      { trigger: 'bad_feedback_survey', transcript: [] },
      { extraOuterFields: { appearance_id: 'a1' } },
    )
    const result = await writeFeedbackBundleZip(body, 'transcript.json')
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.bundleId.startsWith('cc-')).toBe(true)
    expect(result.zipPath).toContain('feedback-bundles')
    expect(result.zipPath.endsWith('.zip')).toBe(true)
    expect(existsSync(result.zipPath)).toBe(true)

    const zipBytes = new Uint8Array(readFileSync(result.zipPath))
    const files = unzipSync(zipBytes)
    expect(Object.keys(files)).toEqual(['transcript.json'])
    const entry = Buffer.from(files['transcript.json']!).toString('utf8')
    const parsed = JSON.parse(entry) as {
      content: string
      appearance_id: string
    }
    expect(parsed.appearance_id).toBe('a1')
    expect(JSON.parse(parsed.content)).toMatchObject({
      trigger: 'bad_feedback_survey',
    })
  })
})
