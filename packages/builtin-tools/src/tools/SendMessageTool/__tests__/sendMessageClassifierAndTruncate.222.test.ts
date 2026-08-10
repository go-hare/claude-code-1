import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const autoMode = { active: false }

mock.module('src/utils/permissions/autoModeState.js', () => ({
  isAutoModeActive: () => autoMode.active,
  setAutoModeActive: (v: boolean) => {
    autoMode.active = v
  },
}))

import { coerceSendMessageInput, SendMessageTool } from '../SendMessageTool.js'
import { SEND_MESSAGE_SUMMARY_MAX_CHARS } from '../constants.js'

describe('densable 2.1.222 SendMessage #17 classifier (Pjs)', () => {
  beforeEach(() => {
    autoMode.active = false
  })
  afterEach(() => {
    autoMode.active = false
  })

  test('auto mode → passthrough classifier message', async () => {
    const result = await SendMessageTool.checkPermissions!(
      { to: 'worker', message: 'hi' },
      {
        getAppState: () => ({
          toolPermissionContext: { mode: 'auto' },
        }),
      } as never,
    )
    expect(result.behavior).toBe('passthrough')
    if (result.behavior === 'passthrough') {
      expect(result.message).toBe(
        'Message to another agent requires classifier review.',
      )
    }
  })

  test('plan + isAutoModeActive → passthrough', async () => {
    autoMode.active = true
    const result = await SendMessageTool.checkPermissions!(
      { to: 'worker', message: 'hi' },
      {
        getAppState: () => ({
          toolPermissionContext: { mode: 'plan' },
        }),
      } as never,
    )
    expect(result.behavior).toBe('passthrough')
  })

  test('plan without auto active → allow', async () => {
    autoMode.active = false
    const result = await SendMessageTool.checkPermissions!(
      { to: 'worker', message: 'hi' },
      {
        getAppState: () => ({
          toolPermissionContext: { mode: 'plan' },
        }),
      } as never,
    )
    expect(result.behavior).toBe('allow')
  })

  test('default mode → allow', async () => {
    const result = await SendMessageTool.checkPermissions!(
      { to: 'worker', message: 'hi' },
      {
        getAppState: () => ({
          toolPermissionContext: { mode: 'default' },
        }),
      } as never,
    )
    expect(result.behavior).toBe('allow')
  })
})

describe('densable 2.1.222 SendMessage #12 summary truncate (OIp/Cpr=200)', () => {
  test('schema max is 200', () => {
    expect(SEND_MESSAGE_SUMMARY_MAX_CHARS).toBe(200)
    const schema = SendMessageTool.inputSchema
    const long = 'x'.repeat(201)
    expect(
      schema.safeParse({ to: 'a', message: 'm', summary: long }).success,
    ).toBe(false)
    expect(
      schema.safeParse({ to: 'a', message: 'm', summary: 'x'.repeat(200) })
        .success,
    ).toBe(true)
  })

  test('coerceInput truncates with ellipsis at Cpr', () => {
    const long = 'a'.repeat(250)
    const coerced = coerceSendMessageInput({
      to: 'worker',
      message: 'hi',
      summary: long,
    })
    expect(coerced).not.toBeNull()
    expect(coerced!.shapeClass).toBe('truncate_summary')
    expect(coerced!.input.summary?.length).toBe(200)
    expect(coerced!.input.summary?.endsWith('…')).toBe(true)
    // after coerce, schema accepts
    expect(SendMessageTool.inputSchema.safeParse(coerced!.input).success).toBe(
      true,
    )
  })

  test('coerceInput null when under max', () => {
    expect(
      coerceSendMessageInput({
        to: 'w',
        message: 'm',
        summary: 'short',
      }),
    ).toBeNull()
  })

  test('tool.coerceInput wired', () => {
    expect(typeof SendMessageTool.coerceInput).toBe('function')
    const long = 'b'.repeat(210)
    const out = SendMessageTool.coerceInput!({
      to: 'w',
      message: 'm',
      summary: long,
    })
    expect(out?.shapeClass).toBe('truncate_summary')
  })

  test('high-surrogate safe truncate (densable na)', () => {
    // Build a string where char at Cpr-1 is a high surrogate if we slice poorly.
    // Use emoji (surrogate pair) near the cut boundary.
    const prefix = 'x'.repeat(SEND_MESSAGE_SUMMARY_MAX_CHARS - 2)
    const withPair = prefix + '😀' + 'yyyy'
    const coerced = coerceSendMessageInput({
      to: 'w',
      message: 'm',
      summary: withPair,
    })
    expect(coerced).not.toBeNull()
    // Must not produce unpaired surrogate before …
    const s = coerced!.input.summary!
    const withoutEllipsis = s.slice(0, -1)
    if (withoutEllipsis.length > 0) {
      const last = withoutEllipsis.charCodeAt(withoutEllipsis.length - 1)
      expect(last < 0xd800 || last > 0xdbff).toBe(true)
    }
  })
})
