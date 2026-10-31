/**
 * densable 2.1.289 Art/yn remaining print-drain stamps.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  assignQueuedIdentityStamps,
  formatInlinedImagePathsPrompt,
  formatThreadStatePrompt,
  hasHearthRelayStamps,
  inputPromptStampTelemetry,
  originIsTypedOrUnset,
  pickQueuedIdentityStamps,
  pollEventDeclaredFromCommands,
  resolvePromptSource,
  resolveQueuedMessageUuid,
  resolveTurnOrigin,
  snapshotThreadState,
  stampHearthRelay,
  stampQueueSkipAttachments,
  stampVerifiedSlackHumanTurn,
} from '../artStamps.js'

const ROOT = join(import.meta.dir, '../../../..')

describe('densable 2.1.289 art stamps helpers', () => {
  test('formatInlinedImagePathsPrompt matches gold g_n 1 vs many', () => {
    expect(formatInlinedImagePathsPrompt(['/tmp/a.png'])).toContain(
      'The attached image is also saved at "/tmp/a.png"',
    )
    expect(
      formatInlinedImagePathsPrompt(['/tmp/a.png', '/tmp/b.png']),
    ).toContain(
      'The 2 attached images, in display order, are also saved at "/tmp/a.png" "/tmp/b.png"',
    )
    expect(formatInlinedImagePathsPrompt(['say "hi".png'])).toContain(
      '"say &quot;hi&quot;.png"',
    )
  })

  test('formatThreadStatePrompt matches gold KJe guards', () => {
    expect(formatThreadStatePrompt('3m ago', 1)).toBe(
      'Thread state: the user last wrote 3m ago. Claude has sent 1 reply since then.',
    )
    expect(formatThreadStatePrompt('1h 2m ago', 4)).toBe(
      'Thread state: the user last wrote 1h 2m ago. Claude has sent 4 replies since then.',
    )
    expect(formatThreadStatePrompt('yesterday', 1)).toBeUndefined()
    expect(formatThreadStatePrompt('3m ago', 1.5)).toBeUndefined()
    expect(formatThreadStatePrompt('3m ago', -1)).toBeUndefined()
  })

  test('snapshotThreadState is gold pDo no-op without projects host', () => {
    expect(snapshotThreadState()).toBeUndefined()
  })

  test('inputPromptStampTelemetry is gold ELt allowlists', () => {
    expect(
      inputPromptStampTelemetry({
        wakeupSource: 'loop_wakeup',
        hostInitiator: 'scheduled-task',
        artifactCommentTurn: 'handoff',
      }),
    ).toEqual({
      wakeup_source: 'loop_wakeup',
      host_initiator: 'scheduled-task',
      artifact_comment_turn: 'handoff',
    })
    expect(
      inputPromptStampTelemetry({
        wakeupSource: 'user',
        hostInitiator: 'not-a-host',
        artifactCommentTurn: 'nope',
      }),
    ).toEqual({ host_initiator: 'other' })
  })

  test('resolveTurnOrigin is gold KOo', () => {
    expect(resolveTurnOrigin({ wakeupSource: 'loop_wakeup' })).toBe('scheduled')
    expect(resolveTurnOrigin({ origin: { kind: 'human' } })).toBe('human')
    expect(
      resolveTurnOrigin({
        origin: { kind: 'human' },
        hostInitiator: 'scheduled-task',
      }),
    ).toBe('scheduled')
    expect(
      resolveTurnOrigin({
        origin: { kind: 'task-notification', subkind: 'peer-send-message' },
      }),
    ).toBe('peer')
    expect(resolveTurnOrigin({ origin: { kind: 'plugin' } })).toBe('system')
    expect(resolveTurnOrigin({ isMeta: true })).toBe('system')
    expect(resolveTurnOrigin({ promptSource: 'sdk' })).toBe('sdk')
    expect(resolveTurnOrigin({})).toBe('unknown')
  })

  test('pollEventDeclaredFromCommands is gold VXe', () => {
    expect(pollEventDeclaredFromCommands([{}])).toBeUndefined()
    expect(
      pollEventDeclaredFromCommands([
        { pollEvent: { kind: 'wake', declared: { foo: 1 } } },
        { pollEvent: { kind: 'other' } },
      ]),
    ).toEqual([{ kind: 'wake', foo: 1 }, null])
  })

  test('stampQueueSkipAttachments is gold dun', () => {
    const messages = [
      { type: 'user' as const },
      { type: 'assistant' as const },
      { type: 'user' as const },
    ]
    stampQueueSkipAttachments(messages)
    expect(
      (messages[0] as { queueSkipAttachments?: boolean }).queueSkipAttachments,
    ).toBe(true)
    expect(
      (messages[1] as { queueSkipAttachments?: boolean }).queueSkipAttachments,
    ).toBeUndefined()
    expect(
      (messages[2] as { queueSkipAttachments?: boolean }).queueSkipAttachments,
    ).toBe(true)
  })

  test('resolvePromptSource is gold e9e', () => {
    expect(resolvePromptSource({ isMeta: true })).toBe('system')
    expect(resolvePromptSource({ callerSource: 'system' })).toBe('system')
    expect(resolvePromptSource({ isNonInteractive: true })).toBe('sdk')
    expect(resolvePromptSource({})).toBe('typed')
    expect(resolvePromptSource({ callerSource: 'queued' })).toBe('queued')
    expect(originIsTypedOrUnset(undefined)).toBe(true)
    expect(originIsTypedOrUnset({ kind: 'human' })).toBe(true)
    expect(originIsTypedOrUnset({ kind: 'task-notification' })).toBe(false)
  })

  test('Y9t / $8o / rrr / X9t identity stamps', () => {
    expect(
      pickQueuedIdentityStamps({
        verifiedSlackHumanTurn: true,
        projectsUserTurn: true,
        hearthRelayRows: [{ id: 1 }],
      }),
    ).toEqual({
      verifiedSlackHumanTurn: true,
      projectsUserTurn: true,
      hearthRelayRows: [{ id: 1 }],
    })
    const messages = [
      { type: 'user' as const, uuid: 'a' },
      { type: 'assistant' as const, uuid: 'a' },
      { type: 'user' as const, uuid: 'b' },
    ]
    stampVerifiedSlackHumanTurn(messages, 'a', { projectsUserTurn: true })
    expect(
      (
        messages[0] as {
          verifiedSlackHumanTurn?: boolean
          projectsUserTurn?: boolean
        }
      ).verifiedSlackHumanTurn,
    ).toBe(true)
    expect(
      (messages[0] as { projectsUserTurn?: boolean }).projectsUserTurn,
    ).toBe(true)
    expect(
      (messages[1] as { verifiedSlackHumanTurn?: boolean })
        .verifiedSlackHumanTurn,
    ).toBeUndefined()
    expect(
      (messages[2] as { verifiedSlackHumanTurn?: boolean })
        .verifiedSlackHumanTurn,
    ).toBeUndefined()
    stampHearthRelay(messages, 'b', {
      messageIds: ['cmsg_1'],
      rows: [1],
      threadTs: 't',
    })
    expect(
      (messages[2] as { hearthRelayMessageIds?: unknown })
        .hearthRelayMessageIds,
    ).toEqual(['cmsg_1'])
    assignQueuedIdentityStamps(messages, 'missing', {
      verifiedSlackHumanTurn: true,
    })
    expect(hasHearthRelayStamps({})).toBe(false)
    expect(hasHearthRelayStamps({ hearthRelayThreadTs: 't' })).toBe(true)
    expect(resolveQueuedMessageUuid('kept', true)).toBe('kept')
    expect(resolveQueuedMessageUuid(undefined, false)).toBeUndefined()
    expect(resolveQueuedMessageUuid(undefined, true)).toMatch(
      /^[0-9a-f-]{36}$/i,
    )
  })
})

describe('densable 2.1.289 art stamp plumbing', () => {
  test('print drain ask bag stamps remaining Art fields', () => {
    const print = readFileSync(join(ROOT, 'src/cli/print.ts'), 'utf8')
    expect(print).toContain('pollEventDelivery:')
    expect(print).toContain('pollEventProvenance:')
    expect(print).toContain('pollEventDeclared:')
    expect(print).toContain('skipSkillPermissionReset:')
    expect(print).toContain('pollEmptyDispatch:')
    expect(print).toContain('fileAttachments:')
    expect(print).toContain('inlinedImagePaths:')
    expect(print).toContain('stampThreadState:')
    expect(print).toContain('localStdinOrigin:')
    expect(print).toContain('sessionChannelPersonTyped:')
    expect(print).toContain('hostInitiator:')
    expect(print).toContain('artifactCommentTurn:')
    expect(print).toContain('clientPlatform:')
    expect(print).toContain('verifiedSlackHumanTurn:')
    expect(print).toContain('projectsUserTurn:')
    expect(print).toContain('hearthRelayRows:')
    expect(print).toContain('hearthRelayThreadTs:')
    expect(print).toContain('hearthRelayMessageIds:')
    expect(print).toContain('setProjectsThreadStateSource')
    expect(print).toContain('refreshTools:')
    expect(print).toContain('refreshMcpClients:')
    expect(print).toContain('parseInboundFileAttachments')
    expect(print).toContain('tengu_ccr_replay_acks_at_request_dispatch')
  })

  test('QueryEngine ask/submitMessage thread Art stamps', () => {
    const qe = readFileSync(join(ROOT, 'src/QueryEngine.ts'), 'utf8')
    expect(qe).toContain('pollEventDelivery:')
    expect(qe).toContain('skipSkillPermissionReset')
    expect(qe).toContain('stampQueueSkipAttachments')
    expect(qe).toContain('file_attachments')
    expect(qe).toContain('messageClientPlatform')
    expect(qe).toContain('inlinedImagePaths:')
    expect(qe).toContain('stampThreadState:')
    expect(qe).toContain('stampVerifiedSlackHumanTurn')
    expect(qe).toContain('stampHearthRelay')
    expect(qe).toContain('projectsUserTurn')
    expect(qe).toContain('hearthRelayRows')
    expect(qe).toContain('hearthRelayMessageIds')
    expect(qe).toContain('createPromptSubmitEntries')
    expect(qe).toContain('aheadOfSessionStart:')
    expect(qe).toContain('promptSubmitEntries.handedOff()')
    expect(qe).toContain('refreshTools')
    expect(qe).toContain('replayAcksAtRequestDispatch')
  })

  test('processUserInput consumes yn/Art stamps', () => {
    const src = readFileSync(
      join(ROOT, 'src/utils/processUserInput/processUserInput.ts'),
      'utf8',
    )
    expect(src).toContain('inlined_image_paths')
    expect(src).toContain('thread_state')
    expect(src).toContain("deliveredVia: 'value_dispatch'")
    expect(src).toContain('resolveTurnOrigin')
    expect(src).toContain('submissionVerifiedSlackHumanTurn')
    expect(src).toContain('submittedOnLocalStdin')
    expect(src).toContain('submittedBySessionChannelPerson')
    expect(src).toContain('resolvePromptSource')
    expect(src).toContain('originIsTypedOrUnset')
    expect(src).toContain('aheadOfSessionStart')
    expect(src).toContain('registerPromptSubmitEntry')
    expect(src).toContain('isComposerEnter')
  })

  test('PromptInput mints composerEnter on Enter', () => {
    const src = readFileSync(
      join(ROOT, 'src/components/PromptInput/PromptInput.tsx'),
      'utf8',
    )
    expect(src).toContain('mintComposerEnter')
    expect(src).toContain('composerEnter')
  })
})
