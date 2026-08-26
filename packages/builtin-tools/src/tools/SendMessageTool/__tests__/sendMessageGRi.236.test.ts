import { describe, expect, test } from 'bun:test'
import { isNotifyWhenIdleStrippedByHandler } from '../SendMessageTool.js'
import {
  NO_IDLE_SUB_HANDLER_STRIPPED,
  NO_IDLE_SUB_HANDLER_STRIPPED_EITHER,
} from 'src/utils/udsIdleNotify.js'

const assistant = {
  message: {
    content: [
      {
        type: 'tool_use',
        id: 'tu_1',
        input: { to: 'uds:/tmp/x.sock', message: 'hi', notify_when_idle: true },
      },
    ],
  },
}

describe('SendMessage GRi / handler-stripped notify_when_idle', () => {
  test('true when original tool_use had notify_when_idle and executed input does not', () => {
    expect(
      isNotifyWhenIdleStrippedByHandler(
        { to: 'uds:/tmp/x.sock', message: 'hi' },
        assistant,
        'tu_1',
      ),
    ).toBe(true)
  })

  test('false when executed input still has notify_when_idle', () => {
    expect(
      isNotifyWhenIdleStrippedByHandler(
        { to: 'uds:/tmp/x.sock', message: 'hi', notify_when_idle: true },
        assistant,
        'tu_1',
      ),
    ).toBe(false)
  })

  test('false when toolUseId misses or original lacked the field', () => {
    expect(
      isNotifyWhenIdleStrippedByHandler(
        { to: 'uds:/tmp/x.sock', message: 'hi' },
        assistant,
        'tu_other',
      ),
    ).toBe(false)
    expect(
      isNotifyWhenIdleStrippedByHandler(
        { to: 'uds:/tmp/x.sock', message: 'hi' },
        {
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tu_1',
                input: { to: 'uds:/tmp/x.sock', message: 'hi' },
              },
            ],
          },
        },
        'tu_1',
      ),
    ).toBe(false)
  })

  test('official JZa / OCv copy is present', () => {
    expect(NO_IDLE_SUB_HANDLER_STRIPPED).toBe(
      'No idle subscription was made (a permission handler removed it from the call).',
    )
    expect(NO_IDLE_SUB_HANDLER_STRIPPED_EITHER).toBe(
      'Nothing was subscribed either: a permission handler removed notify_when_idle from this call.',
    )
  })
})
