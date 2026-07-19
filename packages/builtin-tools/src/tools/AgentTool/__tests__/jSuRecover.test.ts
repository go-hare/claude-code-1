import { describe, expect, test } from 'bun:test'
import { AbortError } from 'src/utils/errors.js'
import type { Message as MessageType } from 'src/types/message.js'
import {
  AgentApiErrorTerminationError,
  hasRecoverableAssistantText,
  recoverSyncAgentErrorHistory,
  tryRecoverApiErrorPartial,
} from '../syncAgentErrorRecover.js'
import { readFileSync } from 'fs'
import { join } from 'path'

function assistant(
  text: string,
  opts?: { isApiErrorMessage?: boolean },
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
  } as unknown as MessageType
}

describe('densable J$u / k6g / $er recoverSyncAgentErrorHistory', () => {
  test('$er hasRecoverableAssistantText skips isApiErrorMessage', () => {
    expect(hasRecoverableAssistantText([])).toBe(false)
    expect(
      hasRecoverableAssistantText([
        assistant('err', { isApiErrorMessage: true }),
      ]),
    ).toBe(false)
    expect(
      hasRecoverableAssistantText([
        assistant('good'),
        assistant('err', { isApiErrorMessage: true }),
      ]),
    ).toBe(true)
  })

  test('k6g tryRecoverApiErrorPartial rate_limit with text', () => {
    const err = new AgentApiErrorTerminationError('429 too many', 'rate_limit')
    const msgs = [
      assistant('partial work'),
      assistant('api fail', { isApiErrorMessage: true }),
    ]
    const r = tryRecoverApiErrorPartial(err, msgs)
    expect(r).not.toBeNull()
    expect(r!.history).toHaveLength(1)
    // gold: full Vio message prefix retained (Fer prependMarker:false)
    expect(r!.cutoffNote).toContain(
      'Agent terminated early due to an API error: 429 too many',
    )
    expect(r!.cutoffNote).toContain('PARTIAL output recovered')
  })

  test('k6g null when kind not recoverable', () => {
    const err = new AgentApiErrorTerminationError('ptl', 'prompt_too_long')
    expect(
      tryRecoverApiErrorPartial(err, [assistant('x')]),
    ).toBeNull()
  })

  test('J$u rethrows plain Error with no recoverable text', () => {
    expect(() =>
      recoverSyncAgentErrorHistory(new Error('boom'), []),
    ).toThrow('boom')
  })

  test('J$u returns history for plain Error with recoverable text', () => {
    const msgs = [assistant('done step 1')]
    const r = recoverSyncAgentErrorHistory(new Error('mid fail'), msgs)
    expect(r.history).toBe(msgs)
    expect(r.cutoffNote).toBeUndefined()
  })

  test('J$u AbortError always returns history even without text', () => {
    const r = recoverSyncAgentErrorHistory(new AbortError(), [])
    expect(r.history).toEqual([])
  })

  test('J$u Vio recoverable uses k6g path', () => {
    const err = new AgentApiErrorTerminationError('overloaded', 'overloaded')
    const msgs = [assistant('partial')]
    const r = recoverSyncAgentErrorHistory(err, msgs)
    expect(r.cutoffNote).toContain('PARTIAL')
    expect(r.history).toEqual(msgs)
  })

  test('J$u Vio non-recoverable kind rethrows', () => {
    const err = new AgentApiErrorTerminationError('x', 'auth_error')
    expect(() =>
      recoverSyncAgentErrorHistory(err, [assistant('y')]),
    ).toThrow(AgentApiErrorTerminationError)
  })

  test('AgentTool wires recoverSyncAgentErrorHistory + cutoffNote', () => {
    const agent = readFileSync(
      join(import.meta.dir, '../AgentTool.tsx'),
      'utf8',
    )
    expect(agent).toContain('recoverSyncAgentErrorHistory')
    expect(agent).toContain('cutoffNote')
  })
})
