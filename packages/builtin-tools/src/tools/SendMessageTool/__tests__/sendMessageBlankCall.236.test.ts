import { describe, expect, test } from 'bun:test'
import {
  blankCallCausedByHandler,
  HANDLER_EMPTIED_MESSAGE,
  HANDLER_EMPTIED_MESSAGE_NO_REINTERPRET,
  HANDLER_REWROTE_NOTHING_LEFT,
  isNotifyWhenIdleStrippedByHandler,
  readOriginalSendMessageToolUse,
  udsBlankMessageGate,
} from '../SendMessageTool.js'
import { NOTIFY_WHEN_IDLE_MAIN_ONLY } from 'src/utils/udsIdleNotify.js'

const BARE = '<parameter name="message">'

function assistantWith(id: string, input: Record<string, unknown>) {
  return {
    message: {
      content: [{ type: 'tool_use', id, input }],
    },
  }
}

describe('densable x0m / C0m / GTl / c3i', () => {
  test('x0m reads vMi-split message from slipped summary', () => {
    const fields = readOriginalSendMessageToolUse(
      assistantWith('tu_1', {
        to: 'uds:/tmp/x.sock',
        summary: `preview</summary>\n${BARE}the real body`,
        notify_when_idle: true,
      }),
      'tu_1',
    )
    expect(fields?.message).toBe('the real body')
    expect(fields?.notify_when_idle).toBe(true)
  })

  test('c3i: LPi accepts notify_when_idle:"true" on the original tool_use', () => {
    expect(
      isNotifyWhenIdleStrippedByHandler(
        { to: 'uds:/tmp/x.sock', message: 'hi' },
        assistantWith('tu_1', {
          to: 'uds:/tmp/x.sock',
          message: 'hi',
          notify_when_idle: 'true',
        }),
        'tu_1',
      ),
    ).toBe(true)
  })

  test('C0m true when handler emptied a message that x0m still sees', () => {
    expect(
      blankCallCausedByHandler(
        { to: 'uds:/tmp/x.sock', message: '' },
        assistantWith('tu_1', {
          to: 'uds:/tmp/x.sock',
          message: 'keep this',
        }),
        'tu_1',
      ),
    ).toBe(true)
  })

  test('C0m true when only notify was stripped', () => {
    expect(
      blankCallCausedByHandler(
        { to: 'uds:/tmp/x.sock', message: '' },
        assistantWith('tu_1', {
          to: 'uds:/tmp/x.sock',
          notify_when_idle: true,
        }),
        'tu_1',
      ),
    ).toBe(true)
  })

  test('C0m false when executed still has text', () => {
    expect(
      blankCallCausedByHandler(
        { to: 'uds:/tmp/x.sock', message: 'still here' },
        assistantWith('tu_1', {
          to: 'uds:/tmp/x.sock',
          message: 'still here',
        }),
        'tu_1',
      ),
    ).toBe(false)
  })

  test('C0m false for a genuine empty+notify subscribe', () => {
    const input = {
      to: 'uds:/tmp/x.sock',
      message: '',
      notify_when_idle: true,
    }
    expect(
      blankCallCausedByHandler(input, assistantWith('tu_1', input), 'tu_1'),
    ).toBe(false)
  })

  test('GTl nonempty plainMessage is a no-op', () => {
    const emit = (_route: 'uds', _cls: string) => {
      throw new Error('emit must not run')
    }
    expect(
      udsBlankMessageGate({
        input: { to: 'u', message: 'hi' },
        plainMessage: 'hi',
        notify: false,
        refusedForPrincipal: false,
        assistantMessage: undefined,
        toolUseId: undefined,
        emit,
      }),
    ).toBeUndefined()
  })

  test('GTl C0m + notify left on + !principal → QRw (never reinterpret)', () => {
    const emitted: string[] = []
    const out = udsBlankMessageGate({
      input: { to: 'u', message: '', notify_when_idle: true },
      plainMessage: '',
      notify: true,
      refusedForPrincipal: false,
      assistantMessage: assistantWith('tu_1', {
        to: 'u',
        message: 'was here',
        notify_when_idle: true,
      }),
      toolUseId: 'tu_1',
      emit: (route, cls) => {
        emitted.push(`${route}:${cls}`)
      },
    })
    expect(emitted).toEqual(['uds:handler_rewrite'])
    expect(out).toEqual({
      data: { success: false, message: HANDLER_EMPTIED_MESSAGE_NO_REINTERPRET },
    })
  })

  test('GTl C0m + notify left on + principal → eIw', () => {
    const out = udsBlankMessageGate({
      input: { to: 'u', message: '', notify_when_idle: true },
      plainMessage: '',
      notify: false,
      refusedForPrincipal: true,
      assistantMessage: assistantWith('tu_1', {
        to: 'u',
        message: 'was here',
        notify_when_idle: true,
      }),
      toolUseId: 'tu_1',
      emit: () => {},
    })
    expect(out).toEqual({
      data: { success: false, message: HANDLER_EMPTIED_MESSAGE },
    })
  })

  test('GTl C0m + notify stripped → R0m', () => {
    const out = udsBlankMessageGate({
      input: { to: 'u', message: '' },
      plainMessage: '',
      notify: false,
      refusedForPrincipal: false,
      assistantMessage: assistantWith('tu_1', {
        to: 'u',
        message: 'was here',
        notify_when_idle: true,
      }),
      toolUseId: 'tu_1',
      emit: () => {},
    })
    expect(out).toEqual({
      data: { success: false, message: HANDLER_REWROTE_NOTHING_LEFT },
    })
  })

  test('GTl !C0m + !notify + principal → u3i', () => {
    const emitted: string[] = []
    const out = udsBlankMessageGate({
      input: { to: 'u', message: '', notify_when_idle: true },
      plainMessage: '',
      notify: false,
      refusedForPrincipal: true,
      assistantMessage: assistantWith('tu_1', {
        to: 'u',
        message: '',
        notify_when_idle: true,
      }),
      toolUseId: 'tu_1',
      emit: (route, cls) => {
        emitted.push(`${route}:${cls}`)
      },
    })
    expect(emitted).toEqual(['uds:permission_denied'])
    expect(out).toEqual({
      data: { success: false, message: NOTIFY_WHEN_IDLE_MAIN_ONLY },
    })
  })

  test('GTl !C0m + !notify → k0m', () => {
    const emitted: string[] = []
    const out = udsBlankMessageGate({
      input: { to: 'u', message: '' },
      plainMessage: '',
      notify: false,
      refusedForPrincipal: false,
      assistantMessage: undefined,
      toolUseId: undefined,
      emit: (route, cls) => {
        emitted.push(`${route}:${cls}`)
      },
    })
    expect(emitted).toEqual(['uds:empty_message'])
    expect(out).toEqual({
      data: { success: false, message: 'message must not be empty' },
    })
  })

  test('GTl !C0m + notify → allow pure subscribe', () => {
    const input = { to: 'u', message: '', notify_when_idle: true }
    expect(
      udsBlankMessageGate({
        input,
        plainMessage: '',
        notify: true,
        refusedForPrincipal: false,
        assistantMessage: assistantWith('tu_1', input),
        toolUseId: 'tu_1',
        emit: () => {
          throw new Error('emit must not run')
        },
      }),
    ).toBeUndefined()
  })
})
