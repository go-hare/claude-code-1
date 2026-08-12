/**
 * densable 2.1.224 #16/#25 — share payload ladder + lastApiRequest pick + fail codes.
 *
 * Avoid mock.module on bootstrap/state (process-global pollution of addSlowOperation).
 * Use real setLastAPIRequest / getLastAPIRequest / setIsRemoteMode.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  getLastAPIRequest,
  setIsRemoteMode,
  setLastAPIRequest,
} from '../../../bootstrap/state.js'
import { logMock } from '../../../../tests/mocks/log.js'
import { debugMock } from '../../../../tests/mocks/debug.js'

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/log.js', logMock)
mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/debug.js', debugMock)

// Overlay only the OAuth refresh used by share — keep rest of auth real
// so process-global mock.module does not strip getRateLimitTier / etc.
const realAuth = await import('../../../utils/auth.js')
const authOverlay = () => ({
  ...realAuth,
  checkAndRefreshOAuthTokenIfNeeded: async () => {},
})
mock.module('src/utils/auth.ts', authOverlay)
mock.module('src/utils/auth.js', authOverlay)

mock.module('src/utils/http.ts', () => ({
  getAuthHeaders: () => ({ headers: { Authorization: 'Bearer t' } }),
  getUserAgent: () => 'test-agent',
}))
mock.module('src/utils/http.js', () => ({
  getAuthHeaders: () => ({ headers: { Authorization: 'Bearer t' } }),
  getUserAgent: () => 'test-agent',
}))

mock.module('src/utils/messages.ts', () => ({
  normalizeMessagesForAPI: (m: unknown) => m,
}))
mock.module('src/utils/messages.js', () => ({
  normalizeMessagesForAPI: (m: unknown) => m,
}))

// densable FNi headSha via getHead (mock only git head, not bootstrap/state).
let mockHeadSha = 'abc123deadbeef'
const realGit = await import('../../../utils/git.js')
const gitOverlay = () => ({
  ...realGit,
  getHead: async () => mockHeadSha,
})
mock.module('src/utils/git.ts', gitOverlay)
mock.module('src/utils/git.js', gitOverlay)

let mockSubagentTranscripts: Record<string, unknown[]> = {}
let mockRawTranscriptPath = '/tmp/no-such-transcript.jsonl'
mock.module('src/utils/sessionStorage.ts', () => ({
  extractAgentIdsFromMessages: () => Object.keys(mockSubagentTranscripts),
  getTranscriptPath: () => mockRawTranscriptPath,
  loadSubagentTranscripts: async () => mockSubagentTranscripts,
  MAX_TRANSCRIPT_READ_BYTES: 1024 * 1024,
}))
mock.module('src/utils/sessionStorage.js', () => ({
  extractAgentIdsFromMessages: () => Object.keys(mockSubagentTranscripts),
  getTranscriptPath: () => mockRawTranscriptPath,
  loadSubagentTranscripts: async () => mockSubagentTranscripts,
  MAX_TRANSCRIPT_READ_BYTES: 1024 * 1024,
}))

// Controllable redact — default identity; fail-closed tests override.
let redactImpl: (s: string) => string = (s: string) => s
mock.module('../../Feedback.js', () => ({
  redactSensitiveInfo: (s: string) => redactImpl(s),
}))
mock.module('../Feedback.js', () => ({
  redactSensitiveInfo: (s: string) => redactImpl(s),
}))

// densable early gates — default allow; tests flip via env / policy mock
let policyAllowed = true
mock.module('src/services/policyLimits/index.ts', () => ({
  isPolicyAllowed: () => policyAllowed,
}))
mock.module('src/services/policyLimits/index.js', () => ({
  isPolicyAllowed: () => policyAllowed,
}))
mock.module('../../../services/policyLimits/index.js', () => ({
  isPolicyAllowed: () => policyAllowed,
}))

// Prefer setupAxiosMock (hygiene) over bare mock.module('axios')
import { setupAxiosMock } from '../../../../tests/mocks/axios.js'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const axiosHandle = setupAxiosMock()
const axiosPost = mock(
  async (
    ..._args: unknown[]
  ): Promise<{ status: number; data: Record<string, unknown> }> => ({
    status: 200,
    data: { transcript_id: 't1' },
  }),
)
axiosHandle.stubs.post = axiosPost
axiosHandle.useStubs = true

// densable m0t provider — default firstParty so ladder tests stay on post path.
let mockProvider: string = 'firstParty'
const realProviders = await import('../../../utils/model/providers.js')
const providersOverlay = () => ({
  ...realProviders,
  getAPIProvider: () => mockProvider,
})
mock.module('src/utils/model/providers.ts', providersOverlay)
mock.module('src/utils/model/providers.js', providersOverlay)

;(globalThis as { MACRO?: { VERSION: string } }).MACRO = {
  VERSION: '2.1.224-test',
}

const {
  pickLastApiRequestForShare,
  LAST_API_REQUEST_SHARE_KEYS,
  MAX_SHARE_PAYLOAD_BYTES,
  THIRD_PARTY_TRANSCRIPT_MARKERS,
  hasThirdPartyTranscriptMarkers,
  subagentTranscriptHasThirdPartyMarkers,
  stripThirdPartyTranscriptFields,
  submitTranscriptShare,
} = await import('../submitTranscriptShare.js')

describe('densable 2.1.224 #25 pickLastApiRequestForShare', () => {
  test('picks densable PEv keys only', () => {
    const picked = pickLastApiRequestForShare({
      model: 'claude-opus',
      system: 'sys',
      tools: [{ name: 'Bash' }],
      max_tokens: 100,
      messages: [{ role: 'user', content: 'secret' }],
      stream: true,
    } as never)
    expect(picked).toEqual({
      model: 'claude-opus',
      system: 'sys',
      tools: [{ name: 'Bash' }],
      max_tokens: 100,
    })
    expect(picked).not.toHaveProperty('messages')
    expect(picked).not.toHaveProperty('stream')
  })

  test('returns undefined when empty', () => {
    expect(pickLastApiRequestForShare(null)).toBeUndefined()
    expect(pickLastApiRequestForShare({} as never)).toBeUndefined()
  })

  test('key list matches densable PEv', () => {
    expect([...LAST_API_REQUEST_SHARE_KEYS]).toEqual([
      'model',
      'system',
      'tools',
      'tool_choice',
      'betas',
      'max_tokens',
      'thinking',
      'temperature',
      'context_management',
      'output_config',
    ])
  })
})

describe('densable JHS / oot / _1r third-party markers', () => {
  test('JHS list matches densable SEA exactly (bolt-inf- hyphen)', () => {
    expect([...THIRD_PARTY_TRANSCRIPT_MARKERS]).toEqual([
      'msg_bdrk_',
      'msg_vrtx_',
      'bolt-inf-',
      'toolu_bdrk_',
      'toolu_vrtx_',
      'srvtoolu_bdrk_',
      'srvtoolu_vrtx_',
      'req_bdrk_',
      'req_vrtx_',
    ])
  })

  test('oot detects each marker substring', () => {
    for (const m of THIRD_PARTY_TRANSCRIPT_MARKERS) {
      expect(hasThirdPartyTranscriptMarkers(`prefix ${m}id suffix`)).toBe(true)
    }
    expect(hasThirdPartyTranscriptMarkers('msg_firstparty_clean')).toBe(false)
  })

  test('_1r true when any message JSON includes marker', () => {
    expect(
      subagentTranscriptHasThirdPartyMarkers([
        { id: 'msg_bdrk_abc', role: 'assistant' },
      ]),
    ).toBe(true)
    expect(
      subagentTranscriptHasThirdPartyMarkers([{ id: 'msg_ok', role: 'user' }]),
    ).toBe(false)
  })

  test('stripThirdPartyTranscriptFields drops marked subagent + raw', () => {
    const out = stripThirdPartyTranscriptFields({
      subagentTranscripts: {
        clean: [{ id: 'msg_ok' }],
        dirty: [{ id: 'toolu_vrtx_xyz' }],
      },
      rawTranscriptJsonl: 'line with msg_bdrk_1\n',
    })
    expect(out.subagentTranscripts).toEqual({ clean: [{ id: 'msg_ok' }] })
    expect(out.rawTranscriptJsonl).toBeUndefined()
  })
})

describe('densable 2.1.224 #16/#25 submitTranscriptShare ladder', () => {
  const prevEssential = process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC

  beforeEach(() => {
    axiosPost.mockClear()
    policyAllowed = true
    mockProvider = 'firstParty'
    redactImpl = (s: string) => s
    setIsRemoteMode(false)
    mockHeadSha = 'abc123deadbeef'
    mockSubagentTranscripts = {}
    mockRawTranscriptPath = '/tmp/no-such-transcript.jsonl'
    delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
    setLastAPIRequest({
      model: 'm',
      system: 's',
      tools: [],
    } as never)
    axiosPost.mockImplementation(async () => ({
      status: 200,
      data: { transcript_id: 'ok' },
    }))
  })

  afterEach(() => {
    setIsRemoteMode(false)
    if (prevEssential === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
    } else {
      process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = prevEssential
    }
  })

  test('includes lastApiRequest + commitSha on first successful attempt', async () => {
    expect(getLastAPIRequest()).toMatchObject({ model: 'm' })
    const result = await submitTranscriptShare(
      [],
      'bad_feedback_survey',
      'app-1',
    )
    expect(result.success).toBe(true)
    // densable success return is {success, transcriptId} only — never errorCode
    expect(result.errorCode).toBeUndefined()
    expect(axiosPost).toHaveBeenCalledTimes(1)
    const call = axiosPost.mock.calls[0] as unknown as [
      string,
      { content: string },
    ]
    const parsed = JSON.parse(call[1].content) as Record<string, unknown>
    expect(parsed.lastApiRequest).toEqual({
      model: 'm',
      system: 's',
      tools: [],
    })
    // densable commitSha:a||null from Iar/jJr head
    expect(parsed.commitSha).toBe('abc123deadbeef')
  })

  test('remote mode → commitSha null (Is skip head)', async () => {
    setIsRemoteMode(true)
    const result = await submitTranscriptShare(
      [],
      'bad_feedback_survey',
      'app-remote',
    )
    expect(result.success).toBe(true)
    const call = axiosPost.mock.calls[0] as unknown as [
      string,
      { content: string },
    ]
    const parsed = JSON.parse(call[1].content) as Record<string, unknown>
    expect(parsed.commitSha).toBeNull()
  })

  test('post path strips 3p-marker subagent transcripts', async () => {
    mockSubagentTranscripts = {
      agent_clean: [{ id: 'msg_ok' }],
      agent_dirty: [{ id: 'msg_bdrk_xyz' }],
    }
    const result = await submitTranscriptShare([], 'frustration', 'app-3p')
    expect(result.success).toBe(true)
    const call = axiosPost.mock.calls[0] as unknown as [
      string,
      { content: string },
    ]
    const parsed = JSON.parse(call[1].content) as {
      subagentTranscripts?: Record<string, unknown>
    }
    expect(parsed.subagentTranscripts).toEqual({
      agent_clean: [{ id: 'msg_ok' }],
    })
    expect(parsed.subagentTranscripts).not.toHaveProperty('agent_dirty')
  })

  test('strips lastApiRequest first when precheck size exceeded', async () => {
    setLastAPIRequest({
      model: 'm',
      system: 'x'.repeat(MAX_SHARE_PAYLOAD_BYTES),
    } as never)
    const result = await submitTranscriptShare(
      [],
      'good_feedback_survey',
      'app-2',
    )
    expect(result.success).toBe(true)
    expect(result.errorCode).toBeUndefined()
    expect(axiosPost.mock.calls.length).toBeGreaterThanOrEqual(1)
    const lastCall = axiosPost.mock.calls.at(-1) as unknown as [
      string,
      { content: string },
    ]
    const parsed = JSON.parse(lastCall[1].content) as Record<string, unknown>
    expect(parsed.lastApiRequest).toBeUndefined()
  })

  test('http 413 returns errorCode http_413 when ladder exhausted', async () => {
    setLastAPIRequest(null as never)
    axiosPost.mockImplementation(async () => ({ status: 413, data: {} }))
    const result = await submitTranscriptShare(
      [{ type: 'user', message: { role: 'user', content: 'hi' } } as never],
      'frustration',
      'app-3',
    )
    expect(result.success).toBe(false)
    expect(
      result.errorCode === 'http_413' || result.errorCode?.startsWith('http_'),
    ).toBe(true)
  })

  test('essential traffic only → essential_traffic_only before post', async () => {
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    const result = await submitTranscriptShare(
      [],
      'bad_feedback_survey',
      'app-ess',
    )
    expect(result).toEqual({
      success: false,
      errorCode: 'essential_traffic_only',
    })
    expect(axiosPost).not.toHaveBeenCalled()
  })

  test('policy allow_product_feedback false → policy_blocked before post', async () => {
    policyAllowed = false
    const result = await submitTranscriptShare(
      [],
      'good_feedback_survey',
      'app-pol',
    )
    expect(result).toEqual({ success: false, errorCode: 'policy_blocked' })
    expect(axiosPost).not.toHaveBeenCalled()
  })

  test('MAX_SHARE_PAYLOAD_BYTES is densable S1r 8MiB', () => {
    expect(MAX_SHARE_PAYLOAD_BYTES).toBe(8_388_608)
  })

  test('provider≠firstParty → bundle path (no POST, zip written)', async () => {
    mockProvider = 'bedrock'
    const prevConfig = process.env.CLAUDE_CONFIG_DIR
    const tmp = mkdtempSync(join(tmpdir(), 'cc-share-bundle-'))
    process.env.CLAUDE_CONFIG_DIR = tmp
    const { getClaudeConfigHomeDir } = await import(
      '../../../utils/envUtils.js'
    )
    ;(
      getClaudeConfigHomeDir as unknown as { cache?: { clear?: () => void } }
    ).cache?.clear?.()
    try {
      const result = await submitTranscriptShare(
        [],
        'bad_feedback_survey',
        'app-bundle',
      )
      expect(result.success).toBe(true)
      expect(result.errorCode).toBeUndefined()
      expect(result.transcriptId).toBeUndefined()
      expect(result.bundlePath).toBeDefined()
      expect(result.bundlePath).toContain('feedback-bundles')
      expect(result.bundlePath!.endsWith('.zip')).toBe(true)
      expect(axiosPost).not.toHaveBeenCalled()
    } finally {
      if (prevConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prevConfig
      ;(
        getClaudeConfigHomeDir as unknown as { cache?: { clear?: () => void } }
      ).cache?.clear?.()
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('bundle path fail-closed when redact throws (no unredacted zip)', async () => {
    mockProvider = 'bedrock'
    redactImpl = () => {
      throw new Error('redact boom')
    }
    const prevConfig = process.env.CLAUDE_CONFIG_DIR
    const tmp = mkdtempSync(join(tmpdir(), 'cc-share-bundle-fail-'))
    process.env.CLAUDE_CONFIG_DIR = tmp
    const { getClaudeConfigHomeDir } = await import(
      '../../../utils/envUtils.js'
    )
    ;(
      getClaudeConfigHomeDir as unknown as { cache?: { clear?: () => void } }
    ).cache?.clear?.()
    try {
      const result = await submitTranscriptShare(
        [],
        'bad_feedback_survey',
        'app-bundle-fail',
      )
      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('bundle_redact_failed')
      expect(result.bundlePath).toBeUndefined()
      expect(axiosPost).not.toHaveBeenCalled()
      // No zip under feedback-bundles
      const { readdirSync, existsSync } = await import('fs')
      const bundleDir = join(tmp, 'feedback-bundles')
      if (existsSync(bundleDir)) {
        expect(readdirSync(bundleDir).filter(f => f.endsWith('.zip'))).toEqual(
          [],
        )
      }
    } finally {
      if (prevConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prevConfig
      ;(
        getClaudeConfigHomeDir as unknown as { cache?: { clear?: () => void } }
      ).cache?.clear?.()
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('bundle path RangeError → payload_range_error (no zip)', async () => {
    mockProvider = 'bedrock'
    redactImpl = () => {
      throw new RangeError('Invalid string length')
    }
    const prevConfig = process.env.CLAUDE_CONFIG_DIR
    const tmp = mkdtempSync(join(tmpdir(), 'cc-share-bundle-range-'))
    process.env.CLAUDE_CONFIG_DIR = tmp
    const { getClaudeConfigHomeDir } = await import(
      '../../../utils/envUtils.js'
    )
    ;(
      getClaudeConfigHomeDir as unknown as { cache?: { clear?: () => void } }
    ).cache?.clear?.()
    try {
      const result = await submitTranscriptShare(
        [],
        'bad_feedback_survey',
        'app-bundle-range',
      )
      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('payload_range_error')
      expect(result.bundlePath).toBeUndefined()
      expect(axiosPost).not.toHaveBeenCalled()
    } finally {
      if (prevConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prevConfig
      ;(
        getClaudeConfigHomeDir as unknown as { cache?: { clear?: () => void } }
      ).cache?.clear?.()
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('bundle path non-JSON redact output → fail-closed', async () => {
    mockProvider = 'bedrock'
    redactImpl = () => 'not-valid-json{'
    const prevConfig = process.env.CLAUDE_CONFIG_DIR
    const tmp = mkdtempSync(join(tmpdir(), 'cc-share-bundle-parse-'))
    process.env.CLAUDE_CONFIG_DIR = tmp
    const { getClaudeConfigHomeDir } = await import(
      '../../../utils/envUtils.js'
    )
    ;(
      getClaudeConfigHomeDir as unknown as { cache?: { clear?: () => void } }
    ).cache?.clear?.()
    try {
      const result = await submitTranscriptShare(
        [],
        'bad_feedback_survey',
        'app-bundle-parse',
      )
      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('bundle_redact_failed')
      expect(result.bundlePath).toBeUndefined()
    } finally {
      if (prevConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prevConfig
      ;(
        getClaudeConfigHomeDir as unknown as { cache?: { clear?: () => void } }
      ).cache?.clear?.()
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
