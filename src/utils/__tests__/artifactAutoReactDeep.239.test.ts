/**
 * densable deep-water: Gso GB, ledger I/O, aGi/_Wt arm (2.1.239).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { getSessionId } from '../../bootstrap/state.js'
import type { SetAppState } from '../../Task.js'
import {
  aGi,
  claimLedgerOwnership,
  flushLedgerNow,
  Gso,
  ledgerFilePath,
  Lkm,
  mI,
  registerAutoReactAvailability,
  rearmCarriedFrameLiveViaAgi,
  resetArtifactAutoReactStoreForTests,
  resetArtifactLiveArmDepsForTests,
  seedPendingLedgerForTests,
  setArtifactLiveArmDeps,
  Stn,
  un,
} from '../../services/artifactAutoReact/index.js'
import { readFileSync } from 'fs'

afterEach(() => {
  resetArtifactAutoReactStoreForTests()
  resetArtifactLiveArmDepsForTests()
  delete process.env.CLAUDE_CODE_ARTIFACT_COMMENTS_AUTOREACT
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resetArtifactAutoReactProductForTests } =
    require('../../services/artifactAutoReact/bootstrap.js') as typeof import('../../services/artifactAutoReact/bootstrap.js')
  resetArtifactAutoReactProductForTests()
})

describe('Gso GrowthBook tengu_sorrel_trellis', () => {
  test('source wires tengu_sorrel_trellis via getFeatureValue_CACHED_MAY_BE_STALE', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../services/artifactAutoReact/gates.ts'),
      'utf8',
    )
    expect(src).toContain('tengu_sorrel_trellis')
    expect(src).toContain('getFeatureValue_CACHED_MAY_BE_STALE')
  })

  test('env unset → GrowthBook default false', () => {
    expect(Gso()).toBe(false)
  })

  test('env on / off', () => {
    process.env.CLAUDE_CODE_ARTIFACT_COMMENTS_AUTOREACT = '1'
    expect(Gso()).toBe(true)
    resetArtifactAutoReactStoreForTests()
    process.env.CLAUDE_CODE_ARTIFACT_COMMENTS_AUTOREACT = 'false'
    expect(Gso()).toBe(false)
  })
})

describe('ledger I/O ($ot / RAm / ykl)', () => {
  test('flush writes artifact-autoreact-ledger envelope', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ar-ledger-'))
    const prevHome = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = dir
    const { getClaudeConfigHomeDir } = await import('../../utils/envUtils.js')
    getClaudeConfigHomeDir.cache?.clear?.()
    try {
      const sid = getSessionId()
      seedPendingLedgerForTests({
        sid,
        accountUuid: null,
        slugs: new Map([
          [
            'art-a',
            {
              savedAt: Date.now(),
              stampHighWater: null,
              everBaselined: false,
              everHadThreads: false,
              turnTimestamps: [],
              interrupted: true,
            },
          ],
        ]),
      })
      claimLedgerOwnership()
      flushLedgerNow({ force: true, urgent: true })
      await un().autoReact.ledgerLastAppend
      const raw = await readFile(ledgerFilePath(sid), 'utf8')
      const env = JSON.parse(raw)
      expect(env.type).toBe('artifact-autoreact-ledger')
      expect(env.v).toBe(1)
      expect(env.sessionId).toBe(sid)
      expect(env.artifacts['art-a'].interrupted).toBe(true)
    } finally {
      if (prevHome === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prevHome
      getClaudeConfigHomeDir.cache?.clear?.()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('aGi / _Wt / Lkm arm', () => {
  beforeEach(() => {
    resetArtifactAutoReactStoreForTests()
    resetArtifactLiveArmDepsForTests()
  })

  function setApp(): SetAppState {
    let state = { tasks: {} as Record<string, unknown> }
    return updater => {
      state = updater(state as never) as typeof state
    }
  }

  test('without mint → no_subscription_token', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_COMMENTS_AUTOREACT = '1'
    registerAutoReactAvailability(() => true)
    mI()
    const out = await aGi({
      slug: 'slug1',
      url: 'https://claude.ai/artifacts/slug1',
      publishContext: 'interactive',
      commentVerbsInSchema: true,
      tool: {},
      setAppState: setApp(),
      context: { abortController: new AbortController() },
    })
    expect(out).toEqual({
      outcome: 'skipped',
      reason: 'no_subscription_token',
    })
  })

  test('localArmWithoutSocket arms monitor_ws + Stn', async () => {
    setArtifactLiveArmDeps({ localArmWithoutSocket: true })
    process.env.CLAUDE_CODE_ARTIFACT_COMMENTS_AUTOREACT = '1'
    registerAutoReactAvailability(() => true)
    mI()
    let tasks: Record<string, unknown> = {}
    const setAppState: SetAppState = updater => {
      const next = updater({ tasks } as never) as {
        tasks: Record<string, unknown>
      }
      tasks = next.tasks
      return next as never
    }
    const out = await aGi({
      slug: 'slug2',
      url: 'https://claude.ai/artifacts/slug2',
      publishContext: 'interactive',
      title: 'T',
      commentVerbsInSchema: true,
      tool: {},
      setAppState,
      context: { abortController: new AbortController() },
    })
    expect(out.outcome).toBe('armed')
    expect(Stn().has('slug2')).toBe(true)
    expect(
      Object.values(tasks).some(
        t => (t as { type?: string }).type === 'monitor_ws',
      ),
    ).toBe(true)
  })

  test('Lkm rejects non-interactive publishContext', async () => {
    const out = await Lkm({
      slug: 'x',
      url: 'https://claude.ai/artifacts/x',
      publishContext: 'subagent',
      setAppState: setApp(),
      context: { abortController: new AbortController() },
    })
    expect(out).toEqual({ outcome: 'skipped', reason: 'publish_context' })
  })

  test('ws_open_error rolls back monitor_ws + supervisor', async () => {
    setArtifactLiveArmDeps({
      mintSubscription: async () => ({ err: null, token: 'tok' }),
      openLiveSocket: async () => {
        throw new Error('ws down')
      },
    })
    process.env.CLAUDE_CODE_ARTIFACT_COMMENTS_AUTOREACT = '1'
    registerAutoReactAvailability(() => true)
    mI()
    let tasks: Record<string, unknown> = {}
    const setAppState: SetAppState = updater => {
      const next = updater({ tasks } as never) as {
        tasks: Record<string, unknown>
      }
      tasks = next.tasks
      return next as never
    }
    const out = await aGi({
      slug: 'ws-fail',
      url: 'https://claude.ai/code/artifact/ws-fail',
      publishContext: 'interactive',
      commentVerbsInSchema: true,
      tool: {},
      setAppState,
      context: { abortController: new AbortController() },
    })
    expect(out).toEqual({ outcome: 'skipped', reason: 'ws_open_error' })
    expect(un().live.supervisors.has('ws-fail')).toBe(false)
    expect(
      Object.values(tasks).some(
        t => (t as { type?: string }).type === 'monitor_ws',
      ),
    ).toBe(false)
    expect(un().durable.stopLatches.isStopped('ws-fail')).toBe(false)
  })

  test('rearmCarriedFrameLiveViaAgi uses aGi path', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_COMMENTS_AUTOREACT = '1'
    registerAutoReactAvailability(() => true)
    mI()
    let tasks: Record<string, unknown> = {}
    const setAppState: SetAppState = updater => {
      const next = updater({ tasks } as never) as {
        tasks: Record<string, unknown>
      }
      tasks = next.tasks
      return next as never
    }
    const result = await rearmCarriedFrameLiveViaAgi(
      [{ slug: 'via-agi', writtenAtMs: Date.now(), title: 'V' }],
      { setAppState, autoReactEnabled: true },
    )
    expect(result.rearmed).toEqual(['via-agi'])
    expect(Stn().has('via-agi')).toBe(true)
    expect(un().live.supervisors.get('via-agi')?.url).toBe(
      'https://claude.ai/code/artifact/via-agi',
    )
  })
})
