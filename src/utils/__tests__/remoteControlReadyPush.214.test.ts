import { describe, expect, test } from 'bun:test'
import {
  createReadyPushSdkMessage,
  nextReadyPushImpressionState,
  parseKairosReadyNudge,
  READY_PUSH_SYNTHETIC_MODEL,
  READY_PUSH_TOOL_NAME,
  REMOTE_CONTROL_READY_PUSH_MESSAGE,
  shouldEmitReadyPushByProbability,
  shouldSendRemoteControlReadyPush,
  type ReadyNudgeConfig,
} from '../remoteControlReadyPush.js'

const baseCfg: ReadyNudgeConfig = {
  probability: 1,
  maxImpressions: 5,
  impressionKey: '',
}

describe('parseKairosReadyNudge (densable nZp)', () => {
  test('push notifications off → null', () => {
    expect(parseKairosReadyNudge(true, false)).toBe(null)
    expect(parseKairosReadyNudge({ probability: 1 }, false)).toBe(null)
  })

  test('raw true → default maxImpressions 5', () => {
    expect(parseKairosReadyNudge(true, true)).toEqual({
      probability: 1,
      maxImpressions: 5,
      impressionKey: '',
    })
  })

  test('null / non-object → null', () => {
    expect(parseKairosReadyNudge(null, true)).toBe(null)
    expect(parseKairosReadyNudge('x', true)).toBe(null)
    expect(parseKairosReadyNudge(1, true)).toBe(null)
  })

  test('object clamps probability and truncates maxImpressions', () => {
    expect(
      parseKairosReadyNudge(
        { probability: 1.5, maxImpressions: 2.9, impressionKey: 'k1' },
        true,
      ),
    ).toEqual({ probability: 1, maxImpressions: 2, impressionKey: 'k1' })
    expect(
      parseKairosReadyNudge({ probability: -0.2, maxImpressions: NaN }, true),
    ).toEqual({ probability: 0, maxImpressions: 5, impressionKey: '' })
  })
})

describe('shouldSendRemoteControlReadyPush (densable oZp)', () => {
  const open = {
    explicitRemoteControl: true,
    outboundOnlyOrReattach: false,
    isBg: false,
    agentId: undefined as string | undefined,
    remoteControlReadyPushKey: undefined as string | undefined,
    remoteControlReadyPushCount: undefined as number | undefined,
  }

  test('requires explicit RC', () => {
    expect(
      shouldSendRemoteControlReadyPush(baseCfg, {
        ...open,
        explicitRemoteControl: false,
      }),
    ).toBe(false)
  })

  test('rejects outboundOnly / reattach', () => {
    expect(
      shouldSendRemoteControlReadyPush(baseCfg, {
        ...open,
        outboundOnlyOrReattach: true,
      }),
    ).toBe(false)
  })

  test('rejects bg session', () => {
    expect(
      shouldSendRemoteControlReadyPush(baseCfg, { ...open, isBg: true }),
    ).toBe(false)
  })

  test('rejects agentId set', () => {
    expect(
      shouldSendRemoteControlReadyPush(baseCfg, {
        ...open,
        agentId: 'agent-1',
      }),
    ).toBe(false)
  })

  test('maxImpressions 0 never; <0 always (unlimited)', () => {
    expect(
      shouldSendRemoteControlReadyPush({ ...baseCfg, maxImpressions: 0 }, open),
    ).toBe(false)
    expect(
      shouldSendRemoteControlReadyPush(
        { ...baseCfg, maxImpressions: -1 },
        {
          ...open,
          remoteControlReadyPushCount: 999,
          remoteControlReadyPushKey: '',
        },
      ),
    ).toBe(true)
  })

  test('impression key mismatch resets count', () => {
    expect(
      shouldSendRemoteControlReadyPush(
        { ...baseCfg, impressionKey: 'v2', maxImpressions: 1 },
        {
          ...open,
          remoteControlReadyPushKey: 'v1',
          remoteControlReadyPushCount: 5,
        },
      ),
    ).toBe(true)
  })

  test('same key blocks when count >= max', () => {
    expect(
      shouldSendRemoteControlReadyPush(
        { ...baseCfg, impressionKey: 'v1', maxImpressions: 2 },
        {
          ...open,
          remoteControlReadyPushKey: 'v1',
          remoteControlReadyPushCount: 2,
        },
      ),
    ).toBe(false)
    expect(
      shouldSendRemoteControlReadyPush(
        { ...baseCfg, impressionKey: 'v1', maxImpressions: 2 },
        {
          ...open,
          remoteControlReadyPushKey: 'v1',
          remoteControlReadyPushCount: 1,
        },
      ),
    ).toBe(true)
  })
})

describe('shouldEmitReadyPushByProbability', () => {
  test('probability >= 1 always emits', () => {
    expect(shouldEmitReadyPushByProbability(1, 0.99)).toBe(true)
    expect(shouldEmitReadyPushByProbability(2, 0)).toBe(true)
  })

  test('random compared to probability', () => {
    expect(shouldEmitReadyPushByProbability(0.5, 0.49)).toBe(true)
    expect(shouldEmitReadyPushByProbability(0.5, 0.5)).toBe(false)
    expect(shouldEmitReadyPushByProbability(0, 0)).toBe(false)
  })
})

describe('nextReadyPushImpressionState (densable iZp pr)', () => {
  test('unlimited maxImpressions < 0 → null (no write)', () => {
    expect(
      nextReadyPushImpressionState(
        { ...baseCfg, maxImpressions: -1 },
        { remoteControlReadyPushKey: '', remoteControlReadyPushCount: 0 },
      ),
    ).toBe(null)
  })

  test('same key increments; new key resets to 1', () => {
    expect(
      nextReadyPushImpressionState(
        { ...baseCfg, impressionKey: 'a' },
        { remoteControlReadyPushKey: 'a', remoteControlReadyPushCount: 2 },
      ),
    ).toEqual({
      remoteControlReadyPushKey: 'a',
      remoteControlReadyPushCount: 3,
    })
    expect(
      nextReadyPushImpressionState(
        { ...baseCfg, impressionKey: 'b' },
        { remoteControlReadyPushKey: 'a', remoteControlReadyPushCount: 2 },
      ),
    ).toEqual({
      remoteControlReadyPushKey: 'b',
      remoteControlReadyPushCount: 1,
    })
  })
})

describe('createReadyPushSdkMessage (densable bzu)', () => {
  test('meta assistant PushNotification proactive wire shape', () => {
    const msg = createReadyPushSdkMessage(
      REMOTE_CONTROL_READY_PUSH_MESSAGE,
      'sess-1',
    ) as Record<string, unknown>
    expect(msg.type).toBe('assistant')
    expect(msg.is_meta).toBe(true)
    expect(msg.session_id).toBe('sess-1')
    expect(msg.parent_tool_use_id).toBe(null)
    const message = msg.message as Record<string, unknown>
    expect(message.model).toBe(READY_PUSH_SYNTHETIC_MODEL)
    expect(message.stop_reason).toBe('tool_use')
    const content = message.content as Array<Record<string, unknown>>
    expect(content).toHaveLength(1)
    expect(content[0]!.type).toBe('tool_use')
    expect(content[0]!.name).toBe(READY_PUSH_TOOL_NAME)
    expect(content[0]!.input).toEqual({
      message: REMOTE_CONTROL_READY_PUSH_MESSAGE,
      status: 'proactive',
    })
  })
})
