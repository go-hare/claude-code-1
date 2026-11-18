import { describe, expect, test } from 'bun:test'
import { PushNotificationTool } from './PushNotificationTool.js'

describe('2.1.293-2.1.295 PushNotificationTool alignment', () => {
  test('#304 mapToolResultToToolResultBlockParam formats disabledReason messages', () => {
    expect(
      PushNotificationTool.mapToolResultToToolResultBlockParam(
        { sent: false, localSent: true, disabledReason: 'no_transport' } as any,
        't1',
      ).content,
    ).toBe(
      'Terminal notification sent. Mobile push not sent (Remote Control inactive).',
    )

    expect(
      PushNotificationTool.mapToolResultToToolResultBlockParam(
        {
          sent: false,
          localSent: false,
          disabledReason: 'no_transport',
        } as any,
        't2',
      ).content,
    ).toBe('Mobile push not sent (Remote Control inactive).')

    expect(
      PushNotificationTool.mapToolResultToToolResultBlockParam(
        { sent: false, disabledReason: 'config_off' } as any,
        't3',
      ).content,
    ).toBe('Push not sent \u2014 mobile push is disabled in /config.')

    expect(
      PushNotificationTool.mapToolResultToToolResultBlockParam(
        { sent: false, disabledReason: 'user_present' } as any,
        't4',
      ).content,
    ).toBe(
      'Not sent \u2014 this terminal is active, so your output here already reaches the user; a separate notification would be redundant.',
    )

    expect(
      PushNotificationTool.mapToolResultToToolResultBlockParam(
        { sent: true, pushSent: true, localSent: true } as any,
        't5',
      ).content,
    ).toBe('Terminal notification sent. Mobile push requested.')
  })

  test('#304/#369 call() returns no_transport when inactive and bypasses config_off in remote-control', async () => {
    const prevDisablePresence =
      process.env.CLAUDE_CODE_DISABLE_NOTIFICATION_PRESENCE_CHECK
    process.env.CLAUDE_CODE_DISABLE_NOTIFICATION_PRESENCE_CHECK = '1'
    try {
      const resNoTransport = await PushNotificationTool.call(
        { title: 'Done', body: 'Finished' },
        {
          options: { isNonInteractiveSession: false },
          getAppState: () => ({
            replBridgeEnabled: false,
            replBridgeExplicit: false,
            replBridgeSessionActive: false,
            replBridgeConnected: false,
          }),
        } as any,
      )
      expect((resNoTransport.data as any).disabledReason).toBe('no_transport')
      expect((resNoTransport.data as any).localSent).toBe(true)
    } finally {
      if (prevDisablePresence === undefined) {
        delete process.env.CLAUDE_CODE_DISABLE_NOTIFICATION_PRESENCE_CHECK
      } else {
        process.env.CLAUDE_CODE_DISABLE_NOTIFICATION_PRESENCE_CHECK =
          prevDisablePresence
      }
    }

    // In remote-control session (replBridgeExplicit: true), config_off & user_present are bypassed
    const resRemoteControl = await PushNotificationTool.call(
      { title: 'Done', body: 'Finished' },
      {
        options: { isNonInteractiveSession: false },
        getAppState: () => ({
          replBridgeEnabled: true,
          replBridgeExplicit: true,
          replBridgeSessionActive: true,
          replBridgeConnected: false,
        }),
      } as any,
    )
    expect((resRemoteControl.data as any).disabledReason).not.toBe('config_off')
    expect((resRemoteControl.data as any).disabledReason).not.toBe(
      'user_present',
    )
  })
})
