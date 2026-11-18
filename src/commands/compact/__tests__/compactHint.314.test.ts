import { describe, expect, test } from 'bun:test'
import type { ToolUseContext } from '../../../Tool.js'
import { isEligibleBridgeMessage } from '../../../bridge/bridgeMessaging.js'
import type { Message } from '../../../types/message.js'
import { toSDKMessages } from '../../../utils/messages/mappers.js'
import { buildDisplayText } from '../compact.js'

function makeContext(verbose = false): ToolUseContext {
  return {
    options: { verbose },
  } as unknown as ToolUseContext
}

describe('compact command #1395 displayTextIsHintOnly', () => {
  test('marks displayTextIsHintOnly=true when only hint/token lines are present', () => {
    const res = buildDisplayText(makeContext(false), undefined, {
      pre: 50000,
      post: 10000,
    })
    expect(res.displayText).toContain('Compacted ')
    expect(res.displayText).toContain('to see full summary')
    expect(res.displayTextIsHintOnly).toBe(true)
  })

  test('marks displayTextIsHintOnly=false when userDisplayMessage is present', () => {
    const res = buildDisplayText(makeContext(false), 'Hook ran', {
      pre: 50000,
      post: 10000,
    })
    expect(res.displayText).toContain('Hook ran')
    expect(res.displayTextIsHintOnly).toBe(false)
  })

  test('bridge consumers filter displayTextIsHintOnly and terminal-hint local_command messages', () => {
    const hintMsg = {
      type: 'system',
      subtype: 'local_command',
      content:
        '<local-command-stdout>Compacted (ctrl+o to see full summary)</local-command-stdout>',
      uuid: '11111111-1111-4111-8111-111111111111',
      timestamp: new Date().toISOString(),
      displayTextIsHintOnly: true,
      localCommandOutput: 'terminal-hint',
    } as unknown as Message
    expect(isEligibleBridgeMessage(hintMsg)).toBe(false)
    expect(toSDKMessages([hintMsg])).toEqual([])

    const normalMsg = {
      type: 'system',
      subtype: 'local_command',
      content: '<local-command-stdout>Hook ran</local-command-stdout>',
      uuid: '22222222-2222-4222-8222-222222222222',
      timestamp: new Date().toISOString(),
    } as unknown as Message
    expect(isEligibleBridgeMessage(normalMsg)).toBe(true)
    expect(toSDKMessages([normalMsg])).toHaveLength(1)
  })
})
