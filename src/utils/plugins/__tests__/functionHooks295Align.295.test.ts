import { describe, expect, test } from 'bun:test'
import {
  getLoadedFunctionHooksModules,
  handleHostOp,
  setLoadedFunctionHooksModules,
  setUiCancelNotifyHandler,
  setUiNotifyHandler,
} from '../functionHooksModules.js'

function registerLoadedFunctionHooksModule(
  mod: Parameters<typeof setLoadedFunctionHooksModules>[0][number],
) {
  setLoadedFunctionHooksModules([...getLoadedFunctionHooksModules(), mod])
  return mod
}

describe('v2.1.295 functionHooks UI alignment', () => {
  test('#354 $.ui.notify and $.ui.cancelNotify validate inputs, forward to handler, and map channel results', async () => {
    setUiNotifyHandler(async input => {
      expect(input.plugin).toBe('notify-mod')
      expect(input.message).toBe('Build finished')
      expect(input.title).toBe('CI')
      expect(input.notificationType).toBe('plugin_notification')
      return 'iterm2' as const
    })
    setUiCancelNotifyHandler(async input => {
      expect(input.plugin).toBe('notify-mod')
      expect(input.key).toBe('build-1')
      return true
    })

    const sent = await handleHostOp(
      'ui.notify',
      [{ text: 'Build finished', title: 'CI', key: 'build-1', delayMs: 0 }],
      'notify-mod',
    )
    expect(sent).toEqual({ isSent: true, channel: 'iterm2' })

    const cancelled = await handleHostOp(
      'ui.cancelNotify',
      [{ key: 'build-1' }],
      'notify-mod',
    )
    expect(cancelled).toEqual({ isSent: true })

    // Invalid key (prototype property) rejected
    await expect(
      handleHostOp('ui.cancelNotify', [{ key: 'constructor' }], 'notify-mod'),
    ).rejects.toThrow('ui.cancelNotify: key is a string')

    // delayMs and at together rejected
    await expect(
      handleHostOp(
        'ui.notify',
        [{ text: 'hi', delayMs: 100, at: Date.now() + 100 }],
        'notify-mod',
      ),
    ).rejects.toThrow('give delayMs or at, not both')

    // disabled channel maps to { isSent: false, reason: 'disabled' }
    setUiNotifyHandler(async () => 'disabled' as const)
    expect(
      await handleHostOp('ui.notify', [{ text: 'hi' }], 'notify-mod'),
    ).toEqual({ isSent: false, reason: 'disabled' })

    // no surface maps to { isSent: false, reason: 'no-surface' }
    setUiNotifyHandler(undefined)
    expect(
      await handleHostOp('ui.notify', [{ text: 'hi' }], 'notify-mod'),
    ).toEqual({ isSent: false, reason: 'no-surface' })

    setUiCancelNotifyHandler(undefined)
  })

  test('#355 mod Button keeps strings and Text as children and rejects non-Text elements', async () => {
    setLoadedFunctionHooksModules([])
    registerLoadedFunctionHooksModule({
      name: 'button-mod',
      patterns: [],
      hooks: [],
    })

    const resolved = (await handleHostOp(
      'ui.resolve',
      [{ component: 'AskUserQuestion', surface: 'terminal' }],
      'button-mod',
    )) as Record<string, (props?: Record<string, unknown>) => unknown>

    const buttonNode = resolved.Button!({
      key: 'row-1',
      children: [
        'Run ',
        resolved.Text!({ dimColor: true, children: 'details' }),
      ],
    }) as {
      type: string
      props: Record<string, unknown>
      children: unknown[]
    }

    expect(buttonNode.type).toBe('Button')
    expect(buttonNode.props.key).toBe('row-1')
    expect(buttonNode.props.label).toBe('Run details')
    expect(Array.isArray(buttonNode.children)).toBe(true)
    expect(buttonNode.children.length).toBe(2)
    expect(buttonNode.children[0]).toBe('Run ')
    expect((buttonNode.children[1] as { type: string }).type).toBe('Text')

    // Rejects Box inside Button
    expect(() =>
      resolved.Button!({
        key: 'bad-row',
        children: [resolved.Box!({ children: 'nope' })],
      }),
    ).toThrow('Box inside Button "bad-row" (a Button holds strings and Text)')

    setLoadedFunctionHooksModules([])
  })
})
