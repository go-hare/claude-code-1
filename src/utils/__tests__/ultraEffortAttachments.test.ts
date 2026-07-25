import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { Message } from 'src/types/message.js'
import type { ToolUseContext } from '../../Tool.js'

// Keep analytics quiet in unit tests
mock.module('src/services/analytics/index.js', () => ({
  logEvent: () => {},
}))

mock.module('src/services/analytics/growthbook.js', () => ({
  getFeatureValue_CACHED_MAY_BE_STALE: (_key: string, defaultValue: unknown) =>
    defaultValue ?? {},
}))

const {
  getUltraEffortAttachments,
  ULTRA_EFFORT_CONFIG,
  createAttachmentMessage,
} = await import('src/utils/attachments.js')
const { unpinAllEffortLaunchPins } = await import('src/utils/effort.js')

function makeCtx(opts: {
  model: string
  effortValue?: string
  ultracode?: boolean
}): ToolUseContext {
  return {
    options: { mainLoopModel: opts.model },
    getAppState: () => ({
      effortValue: opts.effortValue,
      ultracode: opts.ultracode ?? false,
    }),
  } as unknown as ToolUseContext
}

function attach(
  type: 'ultra_effort_enter' | 'ultra_effort_exit',
  reminderType?: 'full' | 'sparse',
): Message {
  return createAttachmentMessage(
    type === 'ultra_effort_enter'
      ? { type, reminderType: reminderType ?? 'full' }
      : { type },
  ) as unknown as Message
}

function humanUser(text: string): Message {
  return {
    type: 'user',
    isMeta: false,
    uuid: 'u',
    timestamp: new Date().toISOString(),
    message: { role: 'user', content: text },
  } as unknown as Message
}

describe('getUltraEffortAttachments (densable f2y)', () => {
  const savedEffort = process.env.CLAUDE_CODE_EFFORT_LEVEL

  beforeEach(() => {
    delete process.env.CLAUDE_CODE_EFFORT_LEVEL
    delete process.env.CLAUDE_CODE_DISABLE_WORKFLOWS
    unpinAllEffortLaunchPins()
  })

  afterEach(() => {
    if (savedEffort === undefined) {
      delete process.env.CLAUDE_CODE_EFFORT_LEVEL
    } else {
      process.env.CLAUDE_CODE_EFFORT_LEVEL = savedEffort
    }
  })

  test('full enter when ultracode becomes active with no prior enter', () => {
    const out = getUltraEffortAttachments(
      [],
      makeCtx({
        model: 'claude-opus-4-7',
        effortValue: 'xhigh',
        ultracode: true,
      }),
    )
    expect(out).toEqual([{ type: 'ultra_effort_enter', reminderType: 'full' }])
  })

  test('no attachment while active and recent enter exists', () => {
    const messages = [attach('ultra_effort_enter', 'full'), humanUser('hi')]
    const out = getUltraEffortAttachments(
      messages,
      makeCtx({
        model: 'claude-opus-4-7',
        effortValue: 'xhigh',
        ultracode: true,
      }),
    )
    expect(out).toEqual([])
  })

  test('sparse enter after TURNS_BETWEEN_MAINTENANCE human turns', () => {
    const turns = Array.from(
      { length: ULTRA_EFFORT_CONFIG.TURNS_BETWEEN_MAINTENANCE },
      (_, i) => humanUser(`turn ${i}`),
    )
    const messages = [attach('ultra_effort_enter', 'full'), ...turns]
    const out = getUltraEffortAttachments(
      messages,
      makeCtx({
        model: 'claude-opus-4-7',
        effortValue: 'xhigh',
        ultracode: true,
      }),
    )
    expect(out).toEqual([
      { type: 'ultra_effort_enter', reminderType: 'sparse' },
    ])
  })

  test('exit when mode turns off after enter', () => {
    const messages = [attach('ultra_effort_enter', 'full')]
    const out = getUltraEffortAttachments(
      messages,
      makeCtx({
        model: 'claude-opus-4-7',
        effortValue: 'xhigh',
        ultracode: false,
      }),
    )
    expect(out).toEqual([{ type: 'ultra_effort_exit' }])
  })

  test('no exit when never entered', () => {
    const out = getUltraEffortAttachments(
      [],
      makeCtx({
        model: 'claude-opus-4-7',
        effortValue: 'high',
        ultracode: false,
      }),
    )
    expect(out).toEqual([])
  })

  test('grok catalog top tier (high) can enter ultracode', () => {
    const out = getUltraEffortAttachments(
      [],
      makeCtx({
        model: 'grok-4.5',
        effortValue: 'high',
        ultracode: true,
      }),
    )
    expect(out).toEqual([{ type: 'ultra_effort_enter', reminderType: 'full' }])
  })
})
