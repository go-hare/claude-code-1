import { describe, expect, test } from 'bun:test'
import type { Message } from '../../../types/message.js'
import { createUserMessage } from '../../messages.js'
import {
  elideByteIdenticalSkillReinvocation,
  findPriorSkillContentSite,
} from '../skillReinvocation.js'

describe('densable 2.1.289 SkillTool Be re-invocation', () => {
  test('unique English: NEW invocation when prior is invoked_skills attachment', () => {
    const body = 'skill body here'
    const prior = {
      type: 'attachment' as const,
      uuid: '00000000-0000-0000-0000-000000000001',
      timestamp: new Date().toISOString(),
      attachment: {
        type: 'invoked_skills',
        skills: [{ content: body }],
        addedNames: [],
        addedLines: [],
        removedNames: [],
      },
    } as Message
    const messages = [createUserMessage({ content: body, isMeta: true })]
    const next = elideByteIdenticalSkillReinvocation({
      messages,
      contextMessages: [prior],
      commandName: 'demo',
      args: 'x',
      priorContent: body,
      renderedContent: body,
    })
    const text = (next[0] as { message: { content: string } }).message.content
    expect(text).toContain(
      'Skill /demo was loaded earlier (see the invoked-skills reminder above); this is a NEW invocation',
    )
    expect(text).toContain('Arguments: x')
  })

  test('unique English: already loaded above when prior is meta body', () => {
    const body = 'skill body here'
    const prior = createUserMessage({ content: body, isMeta: true })
    const messages = [createUserMessage({ content: body, isMeta: true })]
    const next = elideByteIdenticalSkillReinvocation({
      messages,
      contextMessages: [prior],
      commandName: 'demo',
      priorContent: body,
      renderedContent: body,
    })
    const text = (next[0] as { message: { content: string } }).message.content
    expect(text).toBe(
      'Skill /demo is already loaded above; instructions unchanged.',
    )
  })

  test('promptShellHandOff skips elision', () => {
    const body = 'skill body here'
    const prior = createUserMessage({ content: body, isMeta: true })
    const messages = [
      createUserMessage({
        content: body,
        isMeta: true,
        promptShellHandOff: { agentId: null, commands: [] },
      }),
    ]
    const next = elideByteIdenticalSkillReinvocation({
      messages,
      contextMessages: [prior],
      commandName: 'demo',
      priorContent: body,
      renderedContent: body,
    })
    expect((next[0] as { message: { content: string } }).message.content).toBe(
      body,
    )
  })

  test('qdt returns attachment vs body', () => {
    const body = 'x'
    expect(
      findPriorSkillContentSite(
        [
          {
            type: 'attachment',
            uuid: '00000000-0000-0000-0000-000000000002',
            timestamp: new Date().toISOString(),
            attachment: {
              type: 'invoked_skills',
              skills: [{ content: body }],
              addedNames: [],
              addedLines: [],
              removedNames: [],
            },
          } as Message,
        ],
        body,
      ),
    ).toBe('attachment')
    expect(
      findPriorSkillContentSite(
        [createUserMessage({ content: body, isMeta: true })],
        body,
      ),
    ).toBe('body')
  })
})
