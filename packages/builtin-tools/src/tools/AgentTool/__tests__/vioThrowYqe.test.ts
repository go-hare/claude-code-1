import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { Message as MessageType } from 'src/types/message.js'
import { INTERRUPT_MESSAGE } from 'src/utils/messages.js'
import {
  AgentApiErrorTerminationError,
  recoverSyncAgentErrorHistory,
  throwIfLastAssistantIsApiError,
} from '../syncAgentErrorRecover.js'

function assistant(
  text: string,
  opts?: { isApiErrorMessage?: boolean; error?: string },
): MessageType {
  return {
    type: 'assistant',
    uuid: 'u',
    message: {
      id: 'm',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text }],
      model: 'x',
      stop_reason: null,
      stop_sequence: null,
      usage: {},
    },
    ...(opts?.isApiErrorMessage ? { isApiErrorMessage: true } : {}),
    ...(opts?.error !== undefined ? { error: opts.error } : {}),
  } as unknown as MessageType
}

describe('densable Yqe Vio throwIfLastAssistantIsApiError', () => {
  test('no-op when last assistant is normal text', () => {
    expect(() =>
      throwIfLastAssistantIsApiError([assistant('ok')]),
    ).not.toThrow()
  })

  test('no-op on empty history', () => {
    expect(() => throwIfLastAssistantIsApiError([])).not.toThrow()
  })

  test('throws Vio with Tu text + errorKind from last isApiErrorMessage', () => {
    const msgs = [
      assistant('partial work'),
      assistant('429 too many', {
        isApiErrorMessage: true,
        error: 'rate_limit',
      }),
    ]
    try {
      throwIfLastAssistantIsApiError(msgs)
      expect.unreachable('should throw')
    } catch (e) {
      expect(e).toBeInstanceOf(AgentApiErrorTerminationError)
      const err = e as AgentApiErrorTerminationError
      expect(err.errorKind).toBe('rate_limit')
      expect(err.message).toContain(
        'Agent terminated early due to an API error: 429 too many',
      )
    }
  })

  test('skips synthetic interrupt api-error assistant (_ce)', () => {
    // isSyntheticMessage requires first content text in SYNTHETIC_MESSAGES
    const synth = assistant(INTERRUPT_MESSAGE, {
      isApiErrorMessage: true,
      error: 'unknown',
    })
    expect(() => throwIfLastAssistantIsApiError([synth])).not.toThrow()
  })

  test('uses last assistant only (FH findLast)', () => {
    const msgs = [
      assistant('old err', { isApiErrorMessage: true, error: 'server_error' }),
      assistant('recovered later'),
    ]
    expect(() => throwIfLastAssistantIsApiError(msgs)).not.toThrow()
  })

  test('empty errorKind when message.error missing', () => {
    try {
      throwIfLastAssistantIsApiError([
        assistant('fail', { isApiErrorMessage: true }),
      ])
      expect.unreachable('should throw')
    } catch (e) {
      expect(e).toBeInstanceOf(AgentApiErrorTerminationError)
      expect((e as AgentApiErrorTerminationError).errorKind).toBe('')
    }
  })

  test('thrown Vio + partial history recovers via J$u/k6g', () => {
    const msgs = [
      assistant('done step 1'),
      assistant('overloaded', {
        isApiErrorMessage: true,
        error: 'overloaded',
      }),
    ]
    let thrown: unknown
    try {
      throwIfLastAssistantIsApiError(msgs)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(AgentApiErrorTerminationError)
    const r = recoverSyncAgentErrorHistory(thrown, msgs)
    expect(r.history).toHaveLength(1)
    expect(r.cutoffNote).toContain('PARTIAL')
    expect(r.cutoffNote).toContain('overloaded')
  })

  test('runAsyncAgentLifecycle wires throwIfLastAssistantIsApiError', () => {
    const utils = readFileSync(
      join(import.meta.dir, '../agentToolUtils.ts'),
      'utf8',
    )
    expect(utils).toContain('throwIfLastAssistantIsApiError')
    // after stream progress rebuild, before stopSummarization/Jeo
    const throwIdx = utils.indexOf('throwIfLastAssistantIsApiError(agentMessages)')
    const stopIdx = utils.indexOf('stopSummarization?.()', throwIdx)
    const jeoComment = utils.indexOf('// Official: Jeo(e,s)', throwIdx)
    expect(throwIdx).toBeGreaterThan(0)
    expect(stopIdx).toBeGreaterThan(throwIdx)
    expect(jeoComment).toBeGreaterThan(throwIdx)
  })
})
