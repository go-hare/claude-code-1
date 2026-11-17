import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(
  join(import.meta.dir, '../UserTextMessage.tsx'),
  'utf8',
)
const teammate = readFileSync(
  join(import.meta.dir, '../UserTeammateMessage.tsx'),
  'utf8',
)
const channel = readFileSync(
  join(import.meta.dir, '../UserChannelMessage.tsx'),
  'utf8',
)
const notify = readFileSync(
  join(import.meta.dir, '../UserAgentNotificationMessage.tsx'),
  'utf8',
)

describe('densable 2.1.289 BX TDe messageId on channel/teammate/As', () => {
  test('UserTextMessage forwards messageId onto Qi / channel / As', () => {
    expect(src).toContain('<UserTeammateMessage')
    expect(src).toContain('<UserChannelMessage')
    expect(src).toContain('<UserAgentNotificationMessage')
    expect(src).toContain('messageId={resolvedMessageId}')
    expect(src).toContain('taskDelivery={taskDelivery}')
    expect(src).not.toContain(
      'return <UserChannelMessage addMargin={addMargin} param={param} />',
    )
    expect(src).not.toContain(
      'return <UserAgentNotificationMessage addMargin={addMargin} param={param} />',
    )
  })

  test('teammate Mp wraps PluginUserMessageSite with from when names match', () => {
    expect(teammate).toContain('PluginUserMessageSite')
    expect(teammate).toContain('uiRenderUserMessageOrigin(origin)')
    expect(teammate).toContain('from: { name: displayNames[0] }')
    expect(teammate).not.toContain('export function Qi(')
    expect(teammate).not.toContain('export function Mp(')
  })

  test('channel and As convert origin at TDe', () => {
    expect(channel).toContain('uiRenderUserMessageOrigin(origin)')
    expect(notify).toContain('uiRenderUserMessageOrigin(origin)')
    expect(notify).toContain('isExpanded={expanded}')
  })

  test('As gates GetTask delivery suffix on bashTaskDeliveryOutcomes !== no_host', () => {
    expect(notify).toContain('isBashTaskDeliveryHosted(messageId)')
    expect(notify).toContain('GET_TASK_TOOL_NAME')
    expect(notify).toContain(
      'delivered to Claude as a ${GET_TASK_TOOL_NAME} result',
    )
    expect(notify).toContain('messageId={messageId}')
    expect(notify).toContain('skipSite')
    expect(notify).toContain('messageId === undefined || skipSite')
  })

  test('TDe rewrite child is the engine, not a painted Box', () => {
    const wr = readFileSync(
      join(import.meta.dir, '../UserCrossSessionMessage.tsx'),
      'utf8',
    )
    expect(wr).toContain('rewrittenText')
    expect(wr).toContain('rewrittenText ?? parsedBody')
    expect(channel).toContain('rewrittenText ?? fullBody')
    expect(notify).toContain('rewrittenText ?? summary')
    expect(teammate).toContain('content: rewrittenText')
    expect(teammate).toContain(
      'tryRenderPlanApprovalMessage(only.content, onlyName)',
    )
    expect(wr).toContain('<UserCrossSessionMessage')
    expect(channel).toContain('<UserChannelMessage')
    expect(notify).toContain('<UserAgentNotificationMessage')
    expect(teammate).toContain('<UserTeammateMessage')
  })
})
