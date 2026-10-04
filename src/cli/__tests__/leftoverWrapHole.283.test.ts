/**
 * densable 2.1.283 leftover wrap-hole unique strings next to existing minify hosts.
 */
import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { analyticsMock } from '../../../tests/mocks/analytics.js'
import { debugMock } from '../../../tests/mocks/debug.js'

mock.module('../../utils/debug.js', () => debugMock())
mock.module('../../utils/debug.ts', () => debugMock())
mock.module('src/utils/debug.js', () => debugMock())
mock.module('src/utils/debug.ts', () => debugMock())
mock.module('../../services/analytics/index.js', () => analyticsMock())
mock.module('../../services/analytics/index.ts', () => analyticsMock())
mock.module('src/services/analytics/index.js', () => analyticsMock())
mock.module('src/services/analytics/index.ts', () => analyticsMock())

const { toolsAnnounceOffReason } = await import('../cloudToolsPack.js')
const { CLOUD_CLIENT_IS_CLOSING } = await import('../cloudRefuse.js')
const {
  CLOUD_MESSAGE_NOT_DELIVERED,
  POLICY_INVALID_REASON,
  truncateHeadlessError,
  isHeadlessPartialFrame,
  applyInterruptCancelQueued,
} = await import('../leftoverUnique.js')

const dir = import.meta.dir
const src = (rel: string) => readFileSync(join(dir, rel), 'utf8')

describe('leftover wrap-hole unique strings', () => {
  test('source-locks leftover unique next to existing hosts', () => {
    expect(src('../cloudToolsPack.ts')).toContain('not_announced')
    expect(src('../linkDeviceRetry.ts')).toContain(
      '[attach-serve] link failed unexpectedly',
    )
    expect(src('../leftoverUnique.ts')).toContain(
      'tengu_remote_headless_client_agent_request',
    )
    expect(src('../leftoverUnique.ts')).toContain('dropped a cloud_session key')
    expect(src('../leftoverUnique.ts')).toContain(
      'Your message was not delivered to the cloud session',
    )
    expect(src('../leftoverUnique.ts')).toContain('the cloud client is closing')
    expect(src('../leftoverUnique.ts')).toContain(
      'tengu_remote_headless_client_worker_initialize',
    )
    expect(src('../cloudPluginForward.ts')).toContain(
      'ccr_cloud_plugins_forward',
    )
    expect(src('../leftoverCloudCopy.ts')).toContain('policy_invalid')
    expect(src('../leftoverCloudCopy.ts')).toContain('Tgt("policy_invalid")')
    expect(src('../cloudToolsPack.ts')).toContain('createCloudToolsPack')
    expect(src('../leftoverUnique.ts')).toContain('truncateHeadlessError')
    expect(src('../leftoverUnique.ts')).toContain('isHeadlessPartialFrame')
    expect(src('../leftoverUnique.ts')).toContain('applyInterruptCancelQueued')
  })

  test('existing minify hosts stay; leftover unique is additive', () => {
    expect(toolsAnnounceOffReason({ at: 'pending' })).toBe('not_announced')
    expect(toolsAnnounceOffReason({ at: 'withdrawn' })).toBe('serving_off')
    expect(truncateHeadlessError('x'.repeat(10))).toBe('x'.repeat(10))
    expect(isHeadlessPartialFrame({ type: 'stream_event' })).toBe(true)
    expect(
      applyInterruptCancelQueued(
        { cancel_queued: true },
        { subtype: 'interrupt' },
      ).cancel_queued,
    ).toBe(true)
    expect(CLOUD_MESSAGE_NOT_DELIVERED).toBe(
      'Your message was not delivered to the cloud session',
    )
    expect(CLOUD_CLIENT_IS_CLOSING).toBe('the cloud client is closing')
    expect(POLICY_INVALID_REASON).toBe('policy_invalid')
  })
})
