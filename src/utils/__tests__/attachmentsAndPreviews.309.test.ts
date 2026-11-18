import { describe, expect, test } from 'bun:test'
import type { Command } from '../../types/command.js'
import type { Message } from '../../types/message.js'
import {
  collectPriorSkillListings,
  filterUnsentSkillsFromTranscript,
  getNestedMemoryCharLimit,
  memoryFilesToAttachments,
  truncateNestedMemoryToStart,
} from '../attachments.js'
import { QueuedNowCoordinator } from '../foregroundToolCalls.js'
import { generatePreview, sliceSurrogateSafe } from '../toolResultStorage.js'

function makeSkill(name: string, description = 'desc'): Command {
  return {
    type: 'prompt',
    name,
    description,
    hasUserSpecifiedDescription: true,
    allowedTools: [],
    disableModelInvocation: false,
    userInvocable: true,
    contentLength: 10,
    source: 'plugin',
    loadedFrom: 'plugin',
    userFacingName: () => name,
    getPromptForCommand: async () => [],
  } as unknown as Command
}

describe('#988, #1129, #1130, #1133', () => {
  test('#988 filterUnsentSkillsFromTranscript avoids re-sending skills already in transcript', () => {
    const s1 = makeSkill('alpha', 'A')
    const s2 = makeSkill('beta', 'B')

    const first = filterUnsentSkillsFromTranscript([s1, s2], [])
    expect(first.isInitial).toBe(true)
    expect(first.newSkills.map(s => s.name)).toEqual(['alpha', 'beta'])

    const transcript: Message[] = [
      {
        type: 'attachment',
        uuid: 'att-1',
        attachment: {
          type: 'skill_listing',
          content: '...',
          skillCount: 2,
          isInitial: true,
          names: ['alpha', 'beta'],
          digests: first.digests,
        },
      } as unknown as Message,
    ]

    expect(collectPriorSkillListings(transcript).size).toBe(2)

    const afterReload = filterUnsentSkillsFromTranscript([s1, s2], transcript)
    expect(afterReload.newSkills).toEqual([])

    const s3 = makeSkill('gamma', 'C')
    const delta = filterUnsentSkillsFromTranscript([s1, s2, s3], transcript)
    expect(delta.isInitial).toBe(false)
    expect(delta.newSkills.map(s => s.name)).toEqual(['gamma'])
  })

  test('#1129 memoryFilesToAttachments truncates oversized non-Managed nested CLAUDE.md', () => {
    const limit = getNestedMemoryCharLimit('claude-sonnet-4-6')
    expect(limit).toBeGreaterThanOrEqual(40_000)

    const huge = Array.from(
      { length: 5000 },
      (_, i) => `line ${i} padding text`,
    ).join('\n')
    expect(huge.length).toBeGreaterThan(limit)

    const truncated = truncateNestedMemoryToStart(
      huge,
      '/repo/sub/CLAUDE.md',
      limit,
    )
    expect(truncated.length).toBeLessThan(huge.length)
    expect(truncated).toContain('> Only the start of this file is shown.')
    expect(truncated).toContain('offset=')

    const readFileState = new Map()
    const attachments = memoryFilesToAttachments(
      [
        {
          path: '/repo/sub/CLAUDE.md',
          type: 'Project',
          content: huge,
          contentDiffersFromDisk: false,
        } as never,
      ],
      {
        options: { mainLoopModel: 'claude-sonnet-4-6' },
        readFileState,
      } as never,
    )

    expect(attachments.length).toBe(1)
    const att = attachments[0] as { content: { content: string } }
    expect(att.content.content).toContain(
      '> Only the start of this file is shown.',
    )
    expect(readFileState.get('/repo/sub/CLAUDE.md')?.isPartialView).toBe(true)
  })

  test('#1130 QueuedNowCoordinator arms when guard.isDispatchingForModel is true', () => {
    const queue = [
      {
        uuid: 'q-1',
        agentId: 'main',
        mode: 'prompt',
        priority: 'next',
      },
    ]
    const coord = new QueuedNowCoordinator({
      turn: {
        agentId: 'main',
        guard: {
          isActive: true,
          isRunning: false,
          isDispatchingForModel: true,
          subscribe: () => () => {},
        },
        abortController: new AbortController(),
        readEvidence: () => ({
          isHeldByDialog: false,
          isToolCallStarting: false,
          isCompacting: false,
          isMainRequestAnnounced: false,
        }),
        endsUnmovableShells: true,
      },
      messageQueue: {
        getCommandQueueSnapshot: () => queue,
        getCommandQueue: () => queue,
        subscribe: () => () => {},
        isFoldInFlight: () => false,
        isMidTurnFoldSuspended: () => false,
        promoteToNow: () => true,
        demoteFromNow: () => {},
      },
      transcript: { getSnapshot: () => [] },
      session: {},
      taskRegistry: {
        get: () => undefined,
        list: () => [],
      } as never,
      clock: {
        setTimeout: () => () => {},
      },
      featureName: 'test',
    })

    expect(coord.sendQueuedNow()).toBe(true)
    coord.dispose()
  })

  test('#1133 generatePreview never splits a UTF-16 emoji surrogate pair', () => {
    const content = 'abc😀def'
    // index 0='a',1='b',2='c',3=high surrogate,4=low surrogate
    expect(sliceSurrogateSafe(content, 4)).toBe('abc')
    const { preview, hasMore } = generatePreview(content, 4)
    expect(hasMore).toBe(true)
    expect(preview).toBe('abc')
    // Verify no lone surrogate at end
    const last = preview.charCodeAt(preview.length - 1)
    expect(last < 0xd800 || last > 0xdbff).toBe(true)
  })
})
