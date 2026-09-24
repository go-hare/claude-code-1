/**
 * densable 2.1.251 #1 — hdt/ydt/KSn callees and PreModelSwitch proceed.
 */
import { describe, expect, test } from 'bun:test'
import { mock } from 'bun:test'
import { logMock } from '../../../../tests/mocks/log.js'
import { debugMock } from '../../../../tests/mocks/debug.js'

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)

import type { AssistantMessage, Message } from '../../../types/message.js'
import { getBootstrapSession } from '../../sessionRoot.js'
import {
  Ewe,
  GXe,
  Hye,
  KSn,
  LOe,
  Lsn,
  contextTokensAfterCompact,
  cre,
  gRn,
  hJ,
  lastRealAssistant,
  modelSwitchToolUseId,
  pEt,
  yBn,
} from '../modelSwitchHooks.js'
import { executePreModelSwitchHooks } from '../../hooks.js'

function assistant(over: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    type: 'assistant',
    uuid: '00000000-0000-4000-8000-000000000001',
    timestamp: '2026-01-01T00:00:00.000Z',
    message: {
      role: 'assistant',
      model: 'claude-opus-4-6',
      content: [],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: 30,
        cache_read_input_tokens: 10,
      },
    },
    ...over,
  } as AssistantMessage
}

describe('Hye', () => {
  test('default timeout is 30000', () => {
    expect(Hye).toBe(30_000)
  })
})

describe('yBn', () => {
  test('collects hook_system_message content', () => {
    const collected: string[] = []
    yBn(
      {
        type: 'attachment',
        uuid: '00000000-0000-4000-8000-000000000002',
        attachment: {
          type: 'hook_system_message',
          content: 'hello',
          addedNames: [],
          addedLines: [],
          removedNames: [],
        },
      } as Message & { type: 'attachment' },
      collected,
    )
    expect(collected).toEqual(['hello'])
  })

  test('formats PreModelSwitch hook failed', () => {
    const collected: string[] = []
    yBn(
      {
        type: 'attachment',
        uuid: '00000000-0000-4000-8000-000000000003',
        attachment: {
          type: 'hook_non_blocking_error',
          hookName: 'gate.sh',
          stderr: ' boom \n',
          addedNames: [],
          addedLines: [],
          removedNames: [],
        },
      } as Message & { type: 'attachment' },
      collected,
    )
    expect(collected).toEqual(['PreModelSwitch hook gate.sh failed: boom'])
  })
})

describe('LOe', () => {
  test('accepts family aliases and rejects a raw id', () => {
    expect(LOe('opus')).toBe(true)
    expect(LOe('sonnet')).toBe(true)
    expect(LOe('claude-opus-4-6')).toBe(false)
  })
})

describe('KSn', () => {
  test('empty messages return {}', () => {
    expect(KSn([], undefined, 'sess')).toEqual({})
  })

  test('assistant timestamp yields resume cache fields', () => {
    const fields = KSn([assistant()], 'claude-opus-4-6', 'sess')
    expect(fields.context_tokens).toBe(160)
    expect(typeof fields.seconds_since_last_response).toBe('number')
    expect(typeof fields.prompt_cache_likely_expired).toBe('boolean')
    expect(typeof fields.estimated_cache_write_usd).toBe('number')
  })
})

describe('contextTokensAfterCompact', () => {
  test('sums last assistant usage window', () => {
    expect(contextTokensAfterCompact([assistant()])).toBe(160)
  })
})

describe('lastRealAssistant', () => {
  test('skips synthetic model', () => {
    const synth = assistant({
      message: {
        role: 'assistant',
        model: '<synthetic>',
        content: [],
      },
    })
    const real = assistant()
    expect(lastRealAssistant([synth, real])).toBe(real)
  })
})

describe('Ewe', () => {
  test('returns jw cache fields', () => {
    const fields = Ewe('claude-opus-4-6', 0)
    expect(fields.context_tokens).toBe(0)
    expect(typeof fields.prompt_cache_warm).toBe('boolean')
    expect(fields.cache_ttl === '5m' || fields.cache_ttl === '1h').toBe(true)
    expect(typeof fields.estimated_cache_write_usd).toBe('number')
    expect(['configured', 'catalog', 'default']).toContain(fields.pricing)
  })
})

describe('Lsn', () => {
  test('returns false when plugin registration did not fail', async () => {
    expect(await Lsn(true)).toBe(false)
  })
})

describe('executePreModelSwitchHooks', () => {
  test('proceeds when no PreModelSwitch hooks are registered', async () => {
    const result = await executePreModelSwitchHooks({
      fromModel: 'claude-sonnet-4-6',
      toModel: 'claude-opus-4-6',
      requestedModel: 'opus',
      source: 'command',
    })
    expect(result.decision).toBe('proceed')
    if (result.decision === 'proceed') {
      expect(result.skipConfirm).toBe(false)
    }
    expect(result.messages).toEqual([])
  })
})

describe('gRn', () => {
  test('applyResumeSeed when sessionId matches; else stageResumeSeed', () => {
    const session = getBootstrapSession()
    const id = session.id as string
    gRn({
      sessionId: id,
      contextTokens: 42,
      requestAt: 1000,
      ttlMs: 300_000,
    })
    expect(session.requestJournal.resumeSeed()).toEqual({
      sessionId: id,
      contextTokens: 42,
      requestAt: 1000,
      ttlMs: 300_000,
    })
    expect(session.requestJournal.stagedResumeSeed()).toBeNull()

    gRn({
      sessionId: 'other-session',
      contextTokens: 7,
      requestAt: null,
      ttlMs: null,
    })
    expect(session.requestJournal.stagedResumeSeed()).toEqual({
      sessionId: 'other-session',
      contextTokens: 7,
      requestAt: null,
      ttlMs: null,
    })
  })
})

describe('cre / hJ', () => {
  const profile =
    'arn:aws:bedrock:us-east-1:123:application-inference-profile/gate-251'
  // densable hr strips ARN → profile id key
  const profileKey = 'gate-251'
  const map = () =>
    getBootstrapSession().host.requestLatches.inferenceProfileBackingModels()

  test('non-profile model is not an unresolved profile', () => {
    expect(cre('claude-opus-4-6')).toBe(false)
  })

  test('profile without a cached backing string is unresolved', () => {
    map().delete(profile)
    map().delete(profileKey)
    expect(cre(profile)).toBe(true)
  })

  test('cached backing string is enough — cre becomes false', async () => {
    map().set(profileKey, 'anthropic.claude-opus-4-6')
    try {
      await expect(hJ(profile)).resolves.toBe('anthropic.claude-opus-4-6')
      expect(cre(profile)).toBe(false)
    } finally {
      map().delete(profileKey)
      map().delete(profile)
    }
  })
})

describe('pEt', () => {
  test('GXe is the gold consent id; Kt(we(), GXe) hop stays ABSENT', () => {
    expect(GXe).toBe('remote-settings-helper-consent')
    expect(modelSwitchToolUseId).toBe(pEt)
    expect(pEt()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })
})
