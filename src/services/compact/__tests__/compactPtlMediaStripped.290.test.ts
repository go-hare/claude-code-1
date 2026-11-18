import { describe, expect, test } from 'bun:test'
import type {
  AssistantMessage,
  Message,
  UserMessage,
} from 'src/types/message.js'
import { truncateHeadForPTLRetry } from '../compact.js'

function makeUser(
  content: UserMessage['message']['content'],
  uuid: string,
): UserMessage {
  return {
    type: 'user',
    uuid,
    message: { role: 'user', content },
  } as unknown as UserMessage
}

function makeAssistant(text: string, uuid: string): AssistantMessage {
  return {
    type: 'assistant',
    uuid,
    message: {
      id: `msg_${uuid}`,
      role: 'assistant',
      content: [{ type: 'text', text }],
    },
  } as unknown as AssistantMessage
}

describe('v2.1.290 #99: truncateHeadForPTLRetry mediaStripped token accounting', () => {
  test('counts stripped-media tokens when mediaStripped=true so PTL retry drops enough groups', () => {
    const hugeBase64 = 'A'.repeat(20_000)
    const messages: Message[] = [
      // Group 0: small text + huge image (stripped in fallback path!)
      makeUser(
        [
          { type: 'text', text: 'look at this image' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: hugeBase64,
            },
          },
        ],
        'u1',
      ),
      makeAssistant('I see it.', 'a1'),
      // Group 1: medium text
      makeUser('second turn ' + 'x'.repeat(800), 'u2'),
      makeAssistant('second reply', 'a2'),
      // Group 2: kept tail
      makeUser('latest turn', 'u3'),
    ]

    // PTL says we need to drop ~150 tokens of non-media text.
    // With mediaStripped=false, Group 0's base64 image looks like >5000 tokens,
    // so it stops after dropping only Group 0.
    // With mediaStripped=true, Group 0 is only ~10 tokens, so it drops Group 0 + Group 1.
    const ptlResp = makeAssistant(
      'Prompt is too long: 10150 tokens > 10000 maximum',
      'err',
    )

    const unstripped = truncateHeadForPTLRetry(messages, ptlResp, false)
    const stripped = truncateHeadForPTLRetry(messages, ptlResp, true)

    expect(unstripped).not.toBeNull()
    expect(stripped).not.toBeNull()
    expect(stripped!.length).toBeLessThan(unstripped!.length)
    expect(stripped!.some(m => (m.uuid as string) === 'u3')).toBe(true)
    expect(stripped!.some(m => (m.uuid as string) === 'u2')).toBe(false)
  })
})
