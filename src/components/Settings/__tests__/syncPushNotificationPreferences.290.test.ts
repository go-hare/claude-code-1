import { describe, expect, test } from 'bun:test'
import { syncPushNotificationPreferences } from '../Config.js'

describe('#652 syncPushNotificationPreferences', () => {
  test('catches errors thrown by isSubscriber, getTokens, and getConfig without rejecting', async () => {
    await expect(
      syncPushNotificationPreferences(
        { agentPushNotifEnabled: true },
        async () => {},
        {
          isSubscriber: () => {
            throw new Error('isSubscriber boom')
          },
        },
      ),
    ).resolves.toBeUndefined()

    await expect(
      syncPushNotificationPreferences(
        { agentPushNotifEnabled: true },
        async () => {},
        {
          isSubscriber: () => true,
          getTokens: () => {
            throw new Error('getTokens boom')
          },
        },
      ),
    ).resolves.toBeUndefined()

    await expect(
      syncPushNotificationPreferences(
        { agentPushNotifEnabled: true },
        async () => {},
        {
          isSubscriber: () => true,
          getTokens: () => ({ accessToken: 'tok-123' }),
          getConfig: () => {
            throw new Error('getConfig boom')
          },
        },
      ),
    ).resolves.toBeUndefined()
  })

  test('uses timeout: 10000 when patching notification preferences and catches patchFn errors', async () => {
    let capturedTimeout: number | undefined
    await syncPushNotificationPreferences(
      { agentPushNotifEnabled: true, inputNeededNotifEnabled: false },
      async (_url, _body, opts) => {
        capturedTimeout = opts.timeout
      },
      {
        isSubscriber: () => true,
        getTokens: () => ({ accessToken: 'tok-123' }),
        getConfig: () => ({}) as never,
      },
    )
    expect(capturedTimeout).toBe(10000)

    await expect(
      syncPushNotificationPreferences(
        { agentPushNotifEnabled: true },
        async () => {
          throw new Error('network error')
        },
        {
          isSubscriber: () => true,
          getTokens: () => ({ accessToken: 'tok-123' }),
          getConfig: () => ({}) as never,
        },
      ),
    ).resolves.toBeUndefined()
  })
})
