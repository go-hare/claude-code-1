import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  BG_DISPATCHER_RATE_LIMIT_TIER,
  BG_DISPATCHER_SUBSCRIPTION_TYPE,
  dispatcherReattachEnv,
  rateLimitTierFromTokenOrDispatcher,
  readBgDispatcherAccount,
  reattachEnvWithDispatcherAccount,
  subscriptionFromTokenOrDispatcher,
} from '../bgDispatcherAccount.js'

const TIER = 'default_claude_max_20x'

function bgEnv(
  subscription: string | undefined,
  tier: string | undefined,
  kind: string | undefined = 'bg',
): NodeJS.ProcessEnv {
  return {
    CLAUDE_CODE_SESSION_KIND: kind,
    ...(subscription !== undefined
      ? { [BG_DISPATCHER_SUBSCRIPTION_TYPE]: subscription }
      : {}),
    ...(tier !== undefined ? { [BG_DISPATCHER_RATE_LIMIT_TIER]: tier } : {}),
  }
}

describe('bg dispatcher account (251 #41)', () => {
  test('urr writes subscription and rate-limit tier when set', () => {
    expect(
      dispatcherReattachEnv({
        subscriptionType: 'max',
        rateLimitTier: TIER,
      }),
    ).toEqual({
      [BG_DISPATCHER_SUBSCRIPTION_TYPE]: 'max',
      [BG_DISPATCHER_RATE_LIMIT_TIER]: TIER,
    })
  })

  test('urr omits null fields', () => {
    expect(
      dispatcherReattachEnv({
        subscriptionType: null,
        rateLimitTier: null,
      }),
    ).toEqual({})
  })

  test('oEn reads only when session kind is bg', () => {
    const env = bgEnv('team', TIER, 'repl')
    expect(readBgDispatcherAccount(env)).toEqual({
      subscriptionType: undefined,
      rateLimitTier: undefined,
    })
    expect(readBgDispatcherAccount(bgEnv('enterprise', TIER))).toEqual({
      subscriptionType: 'enterprise',
      rateLimitTier: TIER,
    })
  })

  test('oEn treats an empty string as missing', () => {
    expect(readBgDispatcherAccount(bgEnv('', ''))).toEqual({
      subscriptionType: undefined,
      rateLimitTier: undefined,
    })
  })

  test('oI maps max, pro, team, and enterprise', () => {
    for (const plan of ['max', 'pro', 'team', 'enterprise'] as const) {
      expect(
        subscriptionFromTokenOrDispatcher(null, bgEnv(plan, undefined)),
      ).toBe(plan)
    }
    expect(
      subscriptionFromTokenOrDispatcher(null, bgEnv('plus', undefined)),
    ).toBeNull()
    expect(
      subscriptionFromTokenOrDispatcher('pro', bgEnv('max', undefined)),
    ).toBe('pro')
    expect(
      subscriptionFromTokenOrDispatcher(null, bgEnv('max', undefined, 'repl')),
    ).toBeNull()
    expect(
      subscriptionFromTokenOrDispatcher(null, bgEnv('max', undefined), false),
    ).toBeNull()
  })

  test('iI accepts a lowercase tier and rejects others', () => {
    expect(
      rateLimitTierFromTokenOrDispatcher(null, bgEnv(undefined, TIER)),
    ).toBe(TIER)
    expect(
      rateLimitTierFromTokenOrDispatcher(null, bgEnv(undefined, 'Bad-Tier')),
    ).toBeNull()
    expect(
      rateLimitTierFromTokenOrDispatcher('kept', bgEnv(undefined, TIER)),
    ).toBe('kept')
    expect(
      rateLimitTierFromTokenOrDispatcher(null, bgEnv(undefined, TIER), false),
    ).toBeNull()
  })

  test('dispatch reattach includes urr unless exec', () => {
    const account = { subscriptionType: 'max', rateLimitTier: TIER }
    expect(
      reattachEnvWithDispatcherAccount({ OTHER: '1' }, undefined, account),
    ).toEqual({
      OTHER: '1',
      [BG_DISPATCHER_SUBSCRIPTION_TYPE]: 'max',
      [BG_DISPATCHER_RATE_LIMIT_TIER]: TIER,
    })
    expect(
      reattachEnvWithDispatcherAccount({ OTHER: '1' }, 'ls', account),
    ).toEqual({ OTHER: '1' })
    expect(
      reattachEnvWithDispatcherAccount(undefined, undefined, account)?.[
        BG_DISPATCHER_SUBSCRIPTION_TYPE
      ],
    ).toBe('max')
    expect(
      reattachEnvWithDispatcherAccount(undefined, ' ', {
        subscriptionType: null,
        rateLimitTier: null,
      }),
    ).toBeUndefined()
  })

  test('dispatch and session getters call urr and oEn', () => {
    const spawn = readFileSync(
      join(import.meta.dir, '../../daemon/xSeSpawn.ts'),
      'utf8',
    )
    const auth = readFileSync(join(import.meta.dir, '../auth.ts'), 'utf8')
    expect(spawn).toContain('reattachEnvWithDispatcherAccount(')
    expect(spawn).toContain('getDispatcherAccountFromOauthToken()')
    expect(auth).toContain('subscriptionFromTokenOrDispatcher(')
    expect(auth).toContain('canTrustOauthSubscriptionFields()')
    expect(auth).toContain('getDispatcherAccountFromOauthToken')
    expect(auth).toContain('isUsing3PServices()')
    expect(auth).toContain('process.env.CLAUDE_CODE_OAUTH_TOKEN')
    expect(auth).toContain('token.subscriptionType ?? null')
    expect(auth).toContain('token.rateLimitTier ?? null')
    expect(auth).toContain('rateLimitTierFromTokenOrDispatcher(')
  })
})
