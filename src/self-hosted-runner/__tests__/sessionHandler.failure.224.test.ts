/**
 * densable 2.1.224 #1 — rBh failure classification helpers + result shape.
 */
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import type { SelfHostedRunnerApi } from '../runnerApi.js'
import {
  extractErrorHttpStatus,
  handleSession,
  isSourceRefNotFoundMessage,
  truncateSessionErrorText,
} from '../sessionHandler.js'

const sessionHandlerSrc = readFileSync(
  join(import.meta.dir, '../sessionHandler.ts'),
  'utf8',
)

describe('densable 2.1.224 #1 sessionHandler failure helpers', () => {
  test('truncateSessionErrorText (TE)', () => {
    expect(truncateSessionErrorText('short')).toBe('short')
    const long = 'x'.repeat(600)
    const t = truncateSessionErrorText(long)
    expect(t.length).toBe(501)
    expect(t.endsWith('…')).toBe(true)
  })

  test('extractErrorHttpStatus (qrr)', () => {
    expect(extractErrorHttpStatus({ httpStatus: 503 })).toBe(503)
    expect(extractErrorHttpStatus({ response: { status: 429 } })).toBe(429)
    expect(extractErrorHttpStatus({ status: 400 })).toBe(400)
    expect(extractErrorHttpStatus(new Error('x'))).toBeUndefined()
  })

  test('isSourceRefNotFoundMessage (v4o)', () => {
    expect(
      isSourceRefNotFoundMessage('fatal: could not find remote ref main'),
    ).toBe(true)
    expect(isSourceRefNotFoundMessage('pathspec foo did not match')).toBe(true)
    expect(isSourceRefNotFoundMessage('random checkout error')).toBe(false)
  })

  test('densable 2.1.228 #6 non-work checkout hook fail skip gold', () => {
    expect(sessionHandlerSrc).toContain(
      '[runner:warn] checkout hook failed for context source',
    )
    expect(sessionHandlerSrc).toContain(
      'not a work repo (no push_targets entry), skipping it:',
    )
    expect(sessionHandlerSrc).toContain(
      'its checkout hook failed; continuing without this context repo',
    )
    expect(sessionHandlerSrc).toContain('context_source_checkout_hook_failed')
    // skip only when checkoutHookPath && !isWorkRepo && !signal.aborted
    expect(sessionHandlerSrc).toContain(
      'if (checkoutHookPath && !isWorkRepo && !signal.aborted)',
    )
  })
})

describe('densable 2.1.224 #1 sessionHandler auth remote re-fetch gold', () => {
  test('pre-spawn /remote re-fetch full-replaces Y (SEA if(jt)Y=jt)', () => {
    // densable rBh: if(jt)Y=jt — not inference_auth patch-only
    expect(sessionHandlerSrc).toContain('remote = freshRemote')
    expect(sessionHandlerSrc).toContain(
      'Re-fetched /remote for fresh inference token',
    )
    // must not regress to patch-only assignment on inference_auth
    expect(sessionHandlerSrc).not.toContain('inference_auth = fa')
  })

  test('apiBaseUrl re-syncs from post-replace remote (SEA Y.api_base_url)', () => {
    // densable: after if(jt)Y=jt, sjv/Y2h/Fjv use Y.api_base_url — not first-fetch freeze
    expect(sessionHandlerSrc).toContain('let apiBaseUrl = String(')
    // re-fetch success path reassigns apiBaseUrl + apiBaseUrlLive from remote
    const reFetchBlock = sessionHandlerSrc.slice(
      sessionHandlerSrc.indexOf('remote = freshRemote'),
      sessionHandlerSrc.indexOf('Re-fetched /remote for fresh inference token'),
    )
    expect(reFetchBlock).toContain('apiBaseUrl = String(')
    expect(reFetchBlock).toContain('apiBaseUrlLive = apiBaseUrl')
    expect(reFetchBlock).toContain('remote.api_base_url')
  })

  test('git-proxy SESSION_ACCESS is process-global (densable A — invent-ban per-session)', () => {
    // densable rBh: if(A)process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN=...; finally delete
    // capacity>1 races are densable-shared; do not invent per-session storage
    expect(sessionHandlerSrc).toContain(
      'process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN = sessionToken',
    )
    expect(sessionHandlerSrc).toContain(
      'process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN = nextTok',
    )
    expect(sessionHandlerSrc).toContain(
      'delete process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN',
    )
  })

  test('spawn uses post-replace api_base_url (behavioral Y.api_base_url)', async () => {
    // densable: registerWorker uses early Y.api_base_url; sjv after if(jt)Y=jt uses new Y
    const firstBase = 'https://api-first.example.test'
    const secondBase = 'https://api-post-replace.example.test'
    const remoteCalls: string[] = []
    const registerBases: string[] = []
    let spawnBase: string | undefined
    let remoteN = 0

    const api: SelfHostedRunnerApi = {
      registerRunner: async () => ({ runner_id: 'r' }),
      pollSpawnHints: async () => ({
        hints: [],
        warm_hints: [],
        pending_count: 0,
        backing_off_count: 0,
        circuit_broken_count: 0,
        pool_pending_session_count: 0,
        pool_active_session_count: 0,
        server_date: null,
      }),
      nackSpawnHint: async () => {},
      pollWork: async () => ({ assignment_ids: [], session_assignments: [] }),
      issueSessionToken: async () => ({ session_token: 'sess-tok' }),
      reportSessionFailure: async () => ({}),
      releaseSession: async () => ({ released: true }),
      deregisterRunner: async () => {},
      refreshToken: async () => ({ token: 'sess-tok-refreshed' }),
      getSessionRemoteConfig: async () => {
        remoteN += 1
        remoteCalls.push(`remote#${remoteN}`)
        if (remoteN === 1) {
          return {
            api_base_url: firstBase,
            sources: [],
            push_targets: [],
            inference_auth: {
              access_token: 'inf-1',
              expires_in_seconds: 3600,
            },
            environment_variables: {},
            claude_code_args: {},
          }
        }
        return {
          api_base_url: secondBase,
          sources: [],
          push_targets: [],
          inference_auth: {
            access_token: 'inf-2',
            expires_in_seconds: 3600,
          },
          environment_variables: {},
          claude_code_args: {},
        }
      },
      registerWorker: async base => {
        registerBases.push(base)
        return 7
      },
      postWorkerEvents: async () => {},
      updateSessionWorkerState: async () => {},
      heartbeat: async () => {},
      forwardDiagnostics: async () => {},
    }

    const baseDir = await mkdtemp(join(tmpdir(), 'shr-api-base-'))
    const ac = new AbortController()
    try {
      const result = await handleSession(
        'sess_api_base_flip',
        {
          apiClient: api,
          getRunnerToken: () => 'runner-tok',
          baseDir,
          execPath: process.execPath,
          execArgs: [],
          capacity: 1,
          onDebug: () => {},
          onStatus: () => {},
          spawnChild: async opts => {
            spawnBase = opts.apiBaseUrl
            return {
              result: 'completed',
              exitCode: 0,
              stderrTail: '',
            }
          },
        },
        ac.signal,
      )
      expect(result.result).toBe('completed')
      expect(remoteCalls.length).toBeGreaterThanOrEqual(2)
      expect(registerBases).toEqual([firstBase])
      expect(spawnBase).toBe(secondBase)
    } finally {
      ac.abort()
      await rm(baseDir, { recursive: true, force: true })
    }
  })
})
