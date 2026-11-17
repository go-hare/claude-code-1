import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isDetachedToolCallNotification,
  parseDetachedToolCallNotification,
} from '../UserAgentNotificationMessage.js'

const bx = readFileSync(join(import.meta.dir, '../UserTextMessage.tsx'), 'utf8')
const as = readFileSync(
  join(import.meta.dir, '../UserAgentNotificationMessage.tsx'),
  'utf8',
)

describe('densable 2.1.289 gVn / el detached tool_call result', () => {
  test('o9e matches gold envelope and rejects As-shaped notifications', () => {
    const id = 'toolu_abc'
    const ok = `<task-notification>\n<tool-use-id>${id}</tool-use-id>\n<task-type>tool_call</task-type>\n<result>hi</result>\n</task-notification>`
    expect(parseDetachedToolCallNotification(ok)).toBe(id)
    expect(isDetachedToolCallNotification(ok)).toBe(true)
    expect(
      isDetachedToolCallNotification(
        `<task-notification>\n<task-id>t</task-id>\n<summary>Background command "x" completed</summary>\n</task-notification>`,
      ),
    ).toBe(false)
  })

  test('UPt in-place row when registry has a settled call', () => {
    expect(as).toContain('getDetachedToolCall')
    expect(as).toContain('subscribeDetachedToolCalls')
    expect(as).toContain('userFacingName')
    expect(bx).toContain('isDetachedToolCallNotification')
  })

  test('Li paints ToolUseLoader + renderToolUseMessage + renderToolResultMessage', () => {
    expect(as).toContain('ToolUseLoader')
    expect(as).toContain('shouldAnimate={false}')
    expect(as).toContain('isUnresolved={false}')
    expect(as).toContain('renderToolUseMessage')
    expect(as).toContain('renderToolResultMessage')
  })

  test('UPt letGo/ended/owesResult exist on the store', () => {
    const store = readFileSync(
      join(import.meta.dir, '../../../utils/detachedToolCallStore.ts'),
      'utf8',
    )
    expect(store).toContain('detachedToolCallLetGo')
    expect(store).toContain('detachedToolCallEnded')
    expect(store).toContain('detachedToolCallWasLetGo')
    expect(store).toContain('detachedToolCallsOweResult')
    expect(store).toContain('detachedToolCallsAwaitingResult')
    const exec = readFileSync(
      join(import.meta.dir, '../../../services/tools/StreamingToolExecutor.ts'),
      'utf8',
    )
    expect(exec).toContain('detachedToolCallLetGo')
    expect(exec).toContain('detachedToolCallEnded')
    expect(exec).toContain('detachedAt: Date.now()')
    expect(as).toContain('UserToolCanceledMessage')
    expect(as).toContain('FallbackToolUseErrorMessage')
  })

  test('BX routes gVn to el before As', () => {
    expect(bx).toContain('isDetachedToolCallNotification(param.text)')
    expect(bx).toContain('<DetachedToolCallResultMessage')
    expect(bx).toContain('verbose={verbose}')
    expect(as).toContain("An earlier tool call's result arrived here")
    expect(as).not.toContain('export function el(')
    expect(as).not.toContain('export function gVn(')
    expect(as).toContain('isTranscriptV2RowsEnabled')
    expect(as).toContain('TranscriptV2Row')
  })
})
