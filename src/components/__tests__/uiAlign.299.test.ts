import { describe, expect, test } from 'bun:test'
import fs from 'fs'
import path from 'path'
import { syncPushNotificationPreferences } from '../Settings/Config.js'
import type { GlobalConfig } from '../../utils/config.js'

describe('2.1.299 UI & Settings alignment', () => {
  test('#652 syncPushNotificationPreferences sends newly chosen setting to /api/claude_code/notification/preferences', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    await syncPushNotificationPreferences(
      { agentPushNotifEnabled: true },
      async (url, body) => {
        calls.push({ url, body })
        return { status: 200 }
      },
      {
        isSubscriber: () => true,
        getTokens: () => ({ accessToken: 'test-token' }),
        getConfig: () =>
          ({
            agentPushNotifEnabled: false,
            inputNeededNotifEnabled: true,
          }) as GlobalConfig,
      },
    )

    expect(calls.length).toBe(1)
    expect(calls[0]!.url).toContain('/api/claude_code/notification/preferences')
    expect(calls[0]!.body).toEqual({
      preferences: {
        feature_preference: {
          bogosort: { enable_push: true },
          code_requires_action: { enable_push: true },
        },
      },
    })
  })

  test('#624 Usage, BuiltinStatusLine, and ExtraUsageDialog clamp utilization to [0, 100]', () => {
    const usageSrc = fs.readFileSync(
      path.resolve(__dirname, '../Settings/Usage.tsx'),
      'utf8',
    )
    expect(usageSrc).toContain('Math.min(100, Math.max(0, utilization))')
    expect(usageSrc).toContain(
      'Math.min(1, Math.max(0, clampedUtilization / 100))',
    )

    const bslSrc = fs.readFileSync(
      path.resolve(__dirname, '../BuiltinStatusLine.tsx'),
      'utf8',
    )
    expect(bslSrc).toContain(
      'Math.min(100, Math.max(0, Math.round(rateLimits.five_hour!.utilization * 100)))',
    )
    expect(bslSrc).toContain(
      'Math.min(100, Math.max(0, Math.round(rateLimits.seven_day!.utilization * 100)))',
    )

    const eudSrc = fs.readFileSync(
      path.resolve(__dirname, '../ExtraUsageDialog.tsx'),
      'utf8',
    )
    expect(eudSrc).toContain(
      'Math.min(100, Math.max(0, Math.round(extraUsage.utilization)))',
    )
  })

  test('#613 Notifications renders autoUpdaterElement beside ActiveGoalIndicator in fullscreen', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../PromptInput/Notifications.tsx'),
      'utf8',
    )
    expect(src).toContain(
      'autoUpdaterElement={isFullscreen ? null : autoUpdaterElement}',
    )
    expect(src).toContain("maxWidth={hasLeftOrGoalOrStash ? '60%' : undefined}")
    expect(src).toContain(
      'onCriticalMemoryShowingChange={setCriticalMemoryShowing}',
    )
  })

  test('#789 PromptInput handleNewline passes "\\n" to trackAndSetInput after updating cursorOffsetRef', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../PromptInput/PromptInput.tsx'),
      'utf8',
    )
    expect(src).toContain('cursorOffsetRef.current = nextCursor;')
    expect(src).toContain("trackAndSetInput(newInput, '\\n');")
    expect(src).toContain('...(key !== undefined ? { key } : {})')
  })
})
