import { afterEach, describe, expect, test } from 'bun:test'
import {
  hydrateSessionAutoCompactWindows,
  persistSessionAutoCompactWindow,
  resolveAutoCompactWindow,
  resolveModelAutoCompactWindowEntry,
} from '../../../utils/autoCompactWindow.js'
import { setAutoCompactWindowSurface } from '../../../bootstrap/state.js'
import {
  calculateTokenWarningState,
  shouldAutoCompact,
} from '../autoCompact.js'

describe('Wave 3 #1082 & #1083 autoCompactWindow & shouldAutoCompact', () => {
  afterEach(() => {
    setAutoCompactWindowSurface(undefined)
    delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
  })

  test('#1083 getAutoCompactWindowSurface overrides CLAUDE_CODE_ENTRYPOINT in surface lookup', () => {
    setAutoCompactWindowSurface('remote_cowork')
    const resolved = resolveModelAutoCompactWindowEntry({
      surfaces: {
        remote_cowork: { default: 500_000 },
      },
      default: 1_000_000,
    })
    expect(resolved).toBe(500_000)
  })

  test('#1083 hydrateSessionAutoCompactWindows validates and persistSessionAutoCompactWindow notifies sink', () => {
    const host = {}
    const notified: Array<{
      auto_compact_windows: Record<string, 'auto' | number>
    }> = []
    const sink = {
      notifyInternalMetadataChanged: (meta: {
        auto_compact_windows: Record<string, 'auto' | number>
      }) => {
        notified.push(meta)
      },
    }
    let hydratedWindows: Record<string, 'auto' | number> | undefined
    hydrateSessionAutoCompactWindows(
      host,
      {
        internal: {
          auto_compact_windows: {
            'claude-sonnet-4-6': 250_000,
            bad_too_small: 50,
            toString: 200_000,
          },
        },
      },
      sink,
      w => {
        hydratedWindows = w
      },
    )
    expect(hydratedWindows).toEqual({ 'claude-sonnet-4-6': 250_000 })

    persistSessionAutoCompactWindow('claude-sonnet-4-6', 300_000, host)
    expect(notified).toEqual([
      { auto_compact_windows: { 'claude-sonnet-4-6': 300_000 } },
    ])
  })

  test('#1082 blocking limit uses model context window rather than autoCompactWindow override', () => {
    process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '200000'
    const resolved = resolveAutoCompactWindow('claude-opus-4-6')
    expect(resolved.window).toBe(200_000)

    const warn = calculateTokenWarningState(198_000, 'claude-opus-4-6')
    expect(warn.isAboveAutoCompactThreshold).toBe(true)
    // On a 1M/200k+ model, 198k should NOT hit blockingLimit when full model window is larger,
    // or if model window is 200k, blockingLimit is 200k - 20k - 3k = 177k.
    // Specifically on claude-sonnet-4-6[1m], 198k is above 200k autocompact window but well below 1M blocking limit!
    const warn1m = calculateTokenWarningState(198_000, 'claude-sonnet-4-6[1m]')
    expect(warn1m.isAboveAutoCompactThreshold).toBe(true)
    expect(warn1m.isAtBlockingLimit).toBe(false)
  })

  test('#1082 shouldAutoCompact returns false for compact/session_memory querySource', async () => {
    expect(await shouldAutoCompact([], 'claude-sonnet-4-6', 'compact')).toBe(
      false,
    )
    expect(
      await shouldAutoCompact([], 'claude-sonnet-4-6', 'session_memory'),
    ).toBe(false)
  })
})
