import { describe, expect, test } from 'bun:test'
import { uiRenderUserMessageOrigin } from '../messages.js'

describe('densable 2.1.289 vzn UserMessage origin', () => {
  test('missing stored is unclassified', () => {
    expect(uiRenderUserMessageOrigin(undefined)).toEqual({
      kind: 'unclassified',
    })
    expect(uiRenderUserMessageOrigin(null)).toEqual({ kind: 'unclassified' })
    expect(uiRenderUserMessageOrigin('x')).toEqual({ kind: 'unclassified' })
  })

  test('human maps to composer when not a bridge origin', () => {
    expect(uiRenderUserMessageOrigin({ kind: 'human' })).toEqual({
      kind: 'composer',
    })
  })

  test('plugin keeps name and asUser', () => {
    expect(
      uiRenderUserMessageOrigin({ kind: 'plugin', name: 'diff@1' }),
    ).toEqual({ kind: 'plugin', name: 'diff@1' })
    expect(
      uiRenderUserMessageOrigin({
        kind: 'plugin',
        name: 'diff@1',
        asUser: true,
      }),
    ).toEqual({ kind: 'plugin', name: 'diff@1', asUser: true })
  })

  test('channel keeps server', () => {
    expect(
      uiRenderUserMessageOrigin({ kind: 'channel', server: 'mcp' }),
    ).toEqual({ kind: 'channel', server: 'mcp' })
  })

  test('task-notification subkinds that aCe promotes', () => {
    expect(
      uiRenderUserMessageOrigin({
        kind: 'task-notification',
        subkind: 'scheduled-trigger',
      }),
    ).toEqual({ kind: 'scheduled-trigger' })
    expect(
      uiRenderUserMessageOrigin({
        kind: 'task-notification',
        subkind: 'peer-send-message',
      }),
    ).toEqual({ kind: 'peer-send-message' })
    expect(
      uiRenderUserMessageOrigin({
        kind: 'task-notification',
        subkind: 'projects-relay',
      }),
    ).toEqual({ kind: 'projects-relay' })
    expect(
      uiRenderUserMessageOrigin({
        kind: 'task-notification',
        subkind: 'other',
      }),
    ).toEqual({ kind: 'task-notification' })
  })

  test('passthrough kinds keep kind only', () => {
    for (const kind of [
      'peer',
      'coordinator',
      'unclassified',
      'observer',
      'auto-continuation',
      'observer-activity',
      'slack-ping',
    ]) {
      expect(uiRenderUserMessageOrigin({ kind, extra: 1 })).toEqual({ kind })
    }
  })

  test('peer senderTaskId is stripped for TDe but not for Wr uM', () => {
    expect(
      uiRenderUserMessageOrigin({
        kind: 'peer',
        senderTaskId: 'a-1',
      }),
    ).toEqual({ kind: 'peer' })
  })

  test('unknown kind is unclassified', () => {
    expect(uiRenderUserMessageOrigin({ kind: 'sdk' })).toEqual({
      kind: 'unclassified',
    })
  })
})
