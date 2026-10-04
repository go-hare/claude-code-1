/**
 * densable `xPe` @184763949 / `sdt` @183906925 — compact tail thinking strip.
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { growthbookMock } from '../../../tests/mocks/growthbook'
import * as realSettings from 'src/utils/settings/settings.js'
import {
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../tests/mocks/settings.js'
import { createAssistantMessage } from '../messages.js'

const settingsSnap = snapshotModuleExports(realSettings)

const realGrowthbook = await import('src/services/analytics/growthbook.js')
const growthbookSnap = snapshotModuleExports(realGrowthbook)
let wiseComet = false
mock.module('src/services/analytics/growthbook.js', () => ({
  ...growthbookSnap,
  ...growthbookMock(),
  getFeatureValue_CACHED_MAY_BE_STALE: (key: string, fallback: unknown) => {
    if (key === 'tengu_wise_comet') return wiseComet
    return fallback
  },
}))

mock.module('src/utils/settings/settings.js', () => ({
  ...settingsSnap,
  getSettingsWithErrors: () => ({ settings: {}, errors: [] }),
}))
afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap)
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
})

import { createAttachmentMessage } from '../attachments.js'
import {
  carryThinkingStripFromSummarized,
  resolveCompactThinkingStrip,
  resolveCompactThinkingStripFlag,
  thinkingStrippedAttachment,
} from '../thinking.js'

const thinkingMsg = () =>
  createAssistantMessage({
    content: [
      {
        type: 'thinking',
        thinking: 'plan',
        signature: 'sig',
      } as never,
      { type: 'text', text: 'hi' } as never,
    ],
  })

describe('densable 2.1.283 xPe / sdt compact thinking strip', () => {
  afterEach(() => {
    wiseComet = false
    delete process.env.CLAUDE_CODE_WISE_COMET
  })

  test('sdt: env defined wins; non-adaptive never strips; adaptive uses GB', () => {
    process.env.CLAUDE_CODE_WISE_COMET = '1'
    expect(resolveCompactThinkingStripFlag('enabled')).toEqual({
      strip: true,
      source: 'env',
    })
    process.env.CLAUDE_CODE_WISE_COMET = '0'
    expect(resolveCompactThinkingStripFlag('adaptive')).toEqual({
      strip: false,
      source: 'env',
    })
    delete process.env.CLAUDE_CODE_WISE_COMET
    expect(resolveCompactThinkingStripFlag('enabled')).toEqual({
      strip: false,
      source: 'thinking_type',
    })
    wiseComet = false
    expect(resolveCompactThinkingStripFlag('adaptive')).toEqual({
      strip: false,
      source: 'flag',
    })
    wiseComet = true
    expect(resolveCompactThinkingStripFlag('adaptive')).toEqual({
      strip: true,
      source: 'flag',
    })
  })

  test('xPe: zero thinking blocks → no strip, no source', () => {
    const r = resolveCompactThinkingStrip(
      [createAssistantMessage({ content: 'hi' })],
      'claude-opus-4-6',
    )
    expect(r).toEqual({ strip: false, thinkingBlockCount: 0 })
  })

  test('xPe: adaptive + GB on → strip; enabled type never strips without env', () => {
    wiseComet = true
    const adaptive = resolveCompactThinkingStrip(
      [thinkingMsg()],
      'claude-opus-4-6',
    )
    expect(adaptive.strip).toBe(true)
    expect(adaptive.source).toBe('flag')
    expect(adaptive.thinkingBlockCount).toBe(1)
    expect(adaptive.thinkingType).toBe('adaptive')

    const enabled = resolveCompactThinkingStrip(
      [thinkingMsg()],
      'claude-opus-4-0',
    )
    expect(enabled.strip).toBe(false)
    expect(enabled.source).toBe('thinking_type')
    expect(enabled.thinkingType).toBe('enabled')
  })

  test('compact.ts igo up_to calls xPe on KEEP suffix', () => {
    const compact = readFileSync(
      join(import.meta.dir, '../../services/compact/compact.ts'),
      'utf8',
    )
    expect(compact).toContain('resolveCompactThinkingStrip')
    expect(compact).toContain('getMainLoopModelFromLayers')
    expect(compact).toContain('carryThinkingStripFromSummarized')
    expect(compact).toContain("direction === 'up_to'")
    expect(compact).toContain('kept tail holds')
    expect(compact).toContain('messagesToKeep.push')
    expect(compact).toContain("m.type === 'assistant'")
    const thinking = readFileSync(
      join(import.meta.dir, '../thinking.ts'),
      'utf8',
    )
    expect(thinking).toContain('tengu_wise_comet')
    expect(thinking).toContain('CLAUDE_CODE_WISE_COMET')
    expect(
      readFileSync(join(import.meta.dir, '../managedEnvConstants.ts'), 'utf8'),
    ).toContain('CLAUDE_CODE_WISE_COMET')
  })

  test('WNn: scope all in summarized → carry all onto keep', () => {
    const keep = [thinkingMsg()]
    const summarized = [
      createAttachmentMessage(thinkingStrippedAttachment('all')),
    ]
    expect(carryThinkingStripFromSummarized(keep, summarized)).toEqual({
      type: 'thinking_stripped',
      scope: 'all',
    })
  })

  test('WNn: partial from pointing at KEEP assistant → partial', () => {
    const keepMsg = thinkingMsg()
    const keep = [keepMsg]
    const summarized = [
      createAttachmentMessage(
        thinkingStrippedAttachment('partial', {
          messageId: keepMsg.message.id,
          thinkingIndex: 0,
        }),
      ),
    ]
    expect(carryThinkingStripFromSummarized(keep, summarized)).toEqual({
      type: 'thinking_stripped',
      scope: 'partial',
      from: { messageId: keepMsg.message.id, thinkingIndex: 0 },
    })
  })

  test('WNn: partial whose target is still in summarized is skipped', () => {
    const keepMsg = thinkingMsg()
    const summarizedMsg = thinkingMsg()
    expect(
      carryThinkingStripFromSummarized(
        [keepMsg],
        [
          summarizedMsg,
          createAttachmentMessage(
            thinkingStrippedAttachment('partial', {
              messageId: summarizedMsg.message.id,
              thinkingIndex: 0,
            }),
          ),
        ],
      ),
    ).toBeUndefined()
  })
})
