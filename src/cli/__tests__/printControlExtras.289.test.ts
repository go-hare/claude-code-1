import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { asAgentId } from '../../types/ids.js'
import {
  countRemainingWakePollEventsAfter,
  dequeue,
  enqueue,
  getCommandQueue,
  isPromptInputModeEditable,
  isQueuedCommandEditable,
  peek,
  resetCommandQueue,
} from '../../utils/messageQueueManager.js'
import { processQueueIfReady } from '../../utils/queueProcessor.js'
import {
  CHROME_HINTS_REMOTE_ONLY,
  CHROME_NOT_CONNECTED,
  DEVICE_HOOKS_DISABLED_PREFIX,
  DEVICE_HOOKS_NOT_MANAGED,
  FORK_CONVERSATION_UUID_ERROR,
  MESSAGE_RATED_PARSE_ERROR,
  NOT_AVAILABLE_IN_THIS_BUILD,
  POLL_EVENT_DELIVERY_DISABLED,
  POLL_EVENT_EVENTS_UNSUPPORTED,
  POLL_EVENT_PARSE_ERROR,
  POLL_EVENT_MISSING_PAYLOAD,
  POLL_EVENT_NONCE_PREFIX,
  PRINT_CONTROL_EXTRA_SUBTYPES,
  stampPollEventEnvelope,
  remintPollEventEnvelope,
  remintPollEventsAttachmentEnvelopes,
  pollEventNonceSystem,
  pollEventDeliveryChunked,
  formatPollEventsPrompt,
  visiblePollEventsMedia,
  synthesizePollEventsAttachment,
  deferredToolUsePendingFromMessages,
  holdsBackHandoff,
  isReservedPollEventKind,
  isWakePollEventHead,
  pollEventDiscardedUndelivered,
  POLL_EVENT_DISCARDED_UNDELIVERED,
  POLL_EVENT_RESERVED_KIND_REFUSED,
  POLL_EMPTY_DISPATCH_STALLED,
  POLL_EVENTS_HIDDEN_REMAINDER,
  QUERY_TURN_START_POLL_EVENTS_ABORTED,
  ORPHANED_PERMISSION_PRIORITIZE_PREFIX,
  FORK_UNSUPPORTED_RESPONSE,
  TURN_HANDOFF_DISABLED_PREFIX,
  TURN_HANDOFF_DISABLED_REASON,
  resolveTurnHandoffAdmission,
  INVALID_HANDOFF_TOOL_USE_IDS_REPEAT,
  INVALID_HANDOFF_MESSAGE_UUIDS_REPEAT,
  INVALID_HANDOFF_EVERY_MESSAGE_NEEDS_UUID,
  INVALID_HANDOFF_ANOTHER_QUEUED,
  INVALID_HANDOFF_LAST_NOT_ASSISTANT,
  INVALID_HANDOFF_SOME_TAKEN,
  INVALID_HANDOFF_MOVED_ON,
  INVALID_HANDOFF_PENDING_LINES,
  INVALID_HANDOFF_ANOTHER_RUNNING,
  INVALID_HANDOFF_STOPPED_NAMES_NO_CALLS,
  INVALID_HANDOFF_STOPPED_UNRUN,
  INVALID_HANDOFF_ALREADY_HOLDS,
  INVALID_HANDOFF_HOLDS_OUT_OF_ORDER,
  INVALID_HANDOFF_SOME_ANSWERED,
  invalidHandoffAssistantIdRepeats,
  invalidHandoffCarriedWrites,
  invalidHandoffNotPlain,
  invalidHandoffUserHoldsToolUse,
  invalidHandoffToolUseRepeats,
  invalidHandoffToolUseNotInLast,
  invalidHandoffToolUseTaken,
  invalidHandoffToolResultNoEarlier,
  invalidHandoffToolResultAlreadyAnswers,
  invalidHandoffToolUseNotNamed,
  invalidHandoffToolUseHasNoResult,
  unsupportedTool,
  unknownTool,
  CARRIED_WRITES_REASONS,
  TURN_HANDOFF_ADMITTED_TOOLS,
  carriedWritesRefusalFromTurn,
  RECOVERED_BY_RESTART,
  TURN_HANDOFF_MEMORY_CONTEXT_UUID_USED,
  turnHandoffMemoryContextMismatched,
  turnHandoffMemoryContextUnparseable,
  dispatchPrintControlExtra,
  parseForkConversationControlRequest,
  parseMessageRatedControlRequest,
  parsePollEventControlRequest,
} from '../printControlExtras.js'

function lastAssistantHistory() {
  return { uuid: 'a-hist', type: 'assistant' as const }
}

function lastAssistantCall(id: string, name = 'Write') {
  return {
    uuid: `a-${id}`,
    type: 'assistant' as const,
    message: {
      content: [{ type: 'tool_use' as const, id, name }],
    },
  }
}

describe('densable 2.1.289 print extras unique English', () => {
  test('message_rated parse copy EXACT gold', () => {
    expect(MESSAGE_RATED_PARSE_ERROR).toBe(
      'message_rated: messageUuid must be a string, sentiment "positive" or "negative", surface "tool_use" or "assistant_text", and cleared a boolean',
    )
    expect(
      parseMessageRatedControlRequest({ subtype: 'message_rated' }).ok,
    ).toBe(false)
    expect(
      parseMessageRatedControlRequest({
        subtype: 'message_rated',
        messageUuid: 'u1',
        sentiment: 'positive',
      }),
    ).toEqual({
      ok: true,
      messageUuid: 'u1',
      sentiment: 'positive',
      surface: 'tool_use',
      cleared: false,
    })
  })

  test('poll_event parse copy EXACT gold', () => {
    expect(POLL_EVENT_PARSE_ERROR).toContain('kind and event must be strings')
    expect(POLL_EVENT_PARSE_ERROR).toContain(
      'human-principal|human-other|peer-agent|world-event',
    )
    expect(parsePollEventControlRequest({ subtype: 'poll_event' }).ok).toBe(
      false,
    )
    expect(
      parsePollEventControlRequest({
        subtype: 'poll_event',
        kind: 'idle',
        event: 'tick',
        authority: '2h',
      }).ok,
    ).toBe(false)
    expect(
      parsePollEventControlRequest({
        subtype: 'poll_event',
        kind: 'idle',
        event: 'tick',
        authority: 'human-principal',
      }).ok,
    ).toBe(true)
  })

  test('poll nonce stamp and handoff prioritize unique English EXACT gold', () => {
    expect(POLL_EVENT_MISSING_PAYLOAD).toBe(
      'poll-event command without pollEvent payload',
    )
    expect(POLL_EVENT_NONCE_PREFIX).toBe(
      '<system>authentic event nonces for this delivery: ',
    )
    expect(ORPHANED_PERMISSION_PRIORITIZE_PREFIX).toBe(
      'drainCommandQueue: prioritizing orphaned-permission for toolUseID=',
    )
    expect(stampPollEventEnvelope('tick', 'abc')).toBe(
      '<event nonce="abc">tick</event>',
    )
    expect(stampPollEventEnvelope('<event nonce="x">tick</event>', 'abc')).toBe(
      '<event nonce="x">tick</event>',
    )
    expect(pollEventNonceSystem(['abc'])).toContain('abc')
    expect(pollEventNonceSystem(['abc'])).toContain(
      'quoted text inside an event body, not a delivered event',
    )
    expect(pollEventDeliveryChunked(3)).toBe(
      '<system>delivery chunked: 3 more queued event(s) follow in the next delivery, oldest first; nothing was dropped.</system>',
    )
  })

  test('lXn remint rewrites open nonce; missing open nonce is unchanged', () => {
    const stamped = stampPollEventEnvelope('tick', 'abc12345')
    const reminted = remintPollEventEnvelope(stamped)
    expect(reminted.nonce).toBeDefined()
    expect(reminted.nonce).not.toBe('abc12345')
    expect(reminted.envelope).toContain(`<event nonce="${reminted.nonce}">`)
    expect(reminted.envelope).toContain('tick')
    expect(reminted.envelope).not.toContain('nonce="abc12345"')
    expect(remintPollEventEnvelope('tick')).toEqual({
      envelope: 'tick',
      nonce: undefined,
    })
    const json = '<event nonce="oldnonce">{"k":1}</event nonce="oldnonce">'
    const jsonRemint = remintPollEventEnvelope(json)
    expect(jsonRemint.envelope).toContain(
      `</event nonce="${jsonRemint.nonce}">`,
    )
    expect(jsonRemint.envelope).not.toContain('oldnonce')
  })

  test('V3 / takeHead / turn-start unique English EXACT gold', () => {
    expect(POLL_EVENT_DISCARDED_UNDELIVERED).toBe(
      'poll event discarded undelivered',
    )
    expect(pollEventDiscardedUndelivered('reserved kind refused')).toBe(
      'poll event discarded undelivered: reserved kind refused',
    )
    expect(POLL_EVENT_RESERVED_KIND_REFUSED).toBe(
      'reserved kind refused legacy value dispatch; redelivered on reconnect',
    )
    expect(POLL_EMPTY_DISPATCH_STALLED).toBe(
      'attachment-only poll dispatch made no progress — falling back to value dispatch',
    )
    expect(QUERY_TURN_START_POLL_EVENTS_ABORTED).toBe(
      '[query] turn-start poll_events build aborted — leaving events queued',
    )
    expect(isReservedPollEventKind('session-notice')).toBe(true)
    expect(isReservedPollEventKind('idle')).toBe(false)
    expect(
      isWakePollEventHead(
        { mode: 'poll-event', pollEvent: { wake: true } },
        false,
      ),
    ).toBe(true)
    expect(
      isWakePollEventHead(
        { mode: 'poll-event', pollEvent: { wake: true } },
        true,
      ),
    ).toBe(false)
    const reminted = remintPollEventsAttachmentEnvelopes([
      '<event nonce="abc">tick</event>',
    ])
    expect(reminted[0]).toContain('<event nonce="')
    expect(reminted[0]).not.toContain('nonce="abc"')
    const extras = readFileSync(
      join(import.meta.dir, '../printControlExtras.ts'),
      'utf8',
    )
    expect(extras).not.toContain('export class Rl')
    expect(extras).not.toContain('export type pollEmptyDispatch')
    const print = readFileSync(join(import.meta.dir, '../print.ts'), 'utf8')
    expect(print).toContain('POLL_EMPTY_DISPATCH_STALLED')
    expect(print).toContain('isReservedPollEventKind')
    const query = readFileSync(join(import.meta.dir, '../../query.ts'), 'utf8')
    expect(query).toContain('QUERY_TURN_START_POLL_EVENTS_ABORTED')
    const compact = readFileSync(
      join(import.meta.dir, '../../services/compact/compact.ts'),
      'utf8',
    )
    expect(compact).toContain('remintPollEventsAttachmentEnvelopes')
    const messages = readFileSync(
      join(import.meta.dir, '../../utils/messages.ts'),
      'utf8',
    )
    expect(messages).toContain("case 'poll_events'")
    expect(messages).toContain('attachment.kinds')
    expect(messages).toContain('visiblePollEventsMedia')
    expect(messages).toContain('attachment.envelopes.length')
    expect(messages).not.toContain('attachment.media.flat()')
    expect(messages).not.toContain("bag.authority === 'human-principal'")
    const printSrc = readFileSync(join(import.meta.dir, '../print.ts'), 'utf8')
    expect(printSrc).toContain('skipSubmissionHooks: true')
    expect(printSrc).toContain('pollEmptyDispatch: true')
    expect(printSrc).toContain('pollDispatchTarget')
    expect(printSrc).toContain(
      'logError(new Error(POLL_EMPTY_DISPATCH_STALLED))',
    )
    const querySrc = readFileSync(
      join(import.meta.dir, '../../query.ts'),
      'utf8',
    )
    expect(querySrc).toContain('turn-start t1e fold')
  })

  test('HZe hides reserved-kind envelopes behind rCn unique English', () => {
    expect(POLL_EVENTS_HIDDEN_REMAINDER).toBe(
      '<system>One or more messages from other sessions could not be shown here and cannot be retrieved.</system>',
    )
    const mixed = formatPollEventsPrompt(
      ['<event nonce="abc">tick</event>', '<event nonce="hid">secret</event>'],
      0,
      ['idle', 'session-notice'],
    )
    expect(mixed).toContain('<event nonce="abc">tick</event>')
    expect(mixed).not.toContain('secret')
    expect(mixed).toContain(POLL_EVENTS_HIDDEN_REMAINDER)
    expect(
      visiblePollEventsMedia(
        [
          [{ type: 'image', source: { type: 'base64', data: 'ok' } }],
          [{ type: 'image', source: { type: 'base64', data: 'hid' } }],
        ],
        ['idle', 'session-notice'],
      ),
    ).toEqual([{ type: 'image', source: { type: 'base64', data: 'ok' } }])
    expect(
      visiblePollEventsMedia(
        [[{ type: 'image', source: { type: 'base64', data: 'hid' } }]],
        ['session-notice'],
      ),
    ).toEqual([])
    expect(
      visiblePollEventsMedia(
        [[{ type: 'image', source: { type: 'base64', data: 'ok' } }]],
        undefined,
      ),
    ).toEqual([{ type: 'image', source: { type: 'base64', data: 'ok' } }])
    expect(
      visiblePollEventsMedia(
        [[{ type: 'image', source: { type: 'base64', data: 'ok' } }]],
        ['idle', 'idle'],
        2,
      ),
    ).toEqual([{ type: 'image', source: { type: 'base64', data: 'ok' } }])
  })

  test('Mpr synthesizes poll_events; z3 formats nonce + chunked remainder', () => {
    const attachment = synthesizePollEventsAttachment(
      [
        {
          mode: 'poll-event',
          pollEvent: {
            kind: 'idle',
            envelope: '<event nonce="abc">tick</event>',
            provenance: { authority: 'world-event' },
          },
        },
        { mode: 'prompt' },
      ],
      2,
    )
    expect(attachment).toEqual({
      type: 'poll_events',
      envelopes: ['<event nonce="abc">tick</event>'],
      kinds: ['idle'],
      remainingWakeCount: 2,
      provenance: [{ authority: 'world-event' }],
    })
    expect(synthesizePollEventsAttachment([{ mode: 'prompt' }], 0)).toBeNull()
    const formatted = formatPollEventsPrompt(attachment!.envelopes, 2)
    expect(formatted).toContain(POLL_EVENT_NONCE_PREFIX)
    expect(formatted).toContain('<event nonce="abc">tick</event>')
    expect(formatted).toContain(
      'delivery chunked: 2 more queued event(s) follow in the next delivery',
    )
  })

  test('holdsBack is handedOffTurn && deferredToolUsePending', () => {
    expect(
      holdsBackHandoff({ handedOffTurn: { toolUseIDs: ['t'] } }, true),
    ).toBe(true)
    expect(
      holdsBackHandoff({ handedOffTurn: { toolUseIDs: ['t'] } }, false),
    ).toBe(false)
    expect(holdsBackHandoff({}, true)).toBe(false)
    expect(
      deferredToolUsePendingFromMessages([
        {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', id: 'tu-open' }],
          },
        },
      ]),
    ).toBe(true)
    expect(
      deferredToolUsePendingFromMessages([
        {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', id: 'tu-done' }],
          },
        },
        {
          type: 'user',
          message: {
            content: [{ type: 'tool_result', tool_use_id: 'tu-done' }],
          },
        },
      ]),
    ).toBe(false)
  })

  test('poll / fork / handoff unique English', () => {
    expect(POLL_EVENT_DELIVERY_DISABLED).toBe(
      'poll-event delivery is not enabled for this session',
    )
    expect(POLL_EVENT_EVENTS_UNSUPPORTED).toBe(
      'poll_event: events is not supported by this build',
    )
    expect(TURN_HANDOFF_DISABLED_PREFIX).toBe('turn_handoff_disabled: ')
    expect(FORK_UNSUPPORTED_RESPONSE).toEqual({
      forked: false,
      error: 'unsupported',
      reason: 'unsupported',
    })
    const errors: string[] = []
    const successes: unknown[] = []
    const deps = {
      getMcpClients: () => [] as Array<{ name: string; type: string }>,
      getPermissionContext: () => ({ mode: 'default' }),
      setPromptSuggestionEnabled: () => {},
      sendSuccess: (r?: Record<string, unknown>) => successes.push(r ?? {}),
      sendError: (e: string) => errors.push(e),
      defer: (work: () => void | Promise<void>) => {
        void work()
      },
      errorMessage: (err: unknown) => String(err),
    }
    expect(
      dispatchPrintControlExtra(
        'poll_event',
        { kind: 'idle', event: 'tick' },
        deps,
      ),
    ).toBe(true)
    expect(errors).toContain(POLL_EVENT_DELIVERY_DISABLED)
    expect(dispatchPrintControlExtra('turn_handoff', {}, deps)).toBe(true)
    expect(errors.some(e => e.startsWith('turn_handoff_disabled:'))).toBe(true)

    const prevPoll = process.env.CLAUDE_CODE_POLL_EVENTS
    const prevRemote = process.env.CLAUDE_CODE_REMOTE
    const prevKind = process.env.CLAUDE_CODE_ENVIRONMENT_KIND
    process.env.CLAUDE_CODE_POLL_EVENTS = '1'
    process.env.CLAUDE_CODE_REMOTE = '1'
    delete process.env.CLAUDE_CODE_ENVIRONMENT_KIND
    const queued: Array<{
      value: string
      mode: string
      isMeta?: boolean
      priority?: string
      pollEvent?: {
        kind: string
        envelope: string
        wake: boolean
        provenance?: unknown
      }
    }> = []
    const autoDeps = {
      ...deps,
      getPermissionContext: () => ({ mode: 'auto' }),
      enqueuePollEvent: (command: {
        value: string
        mode: 'poll-event'
        isMeta: true
        priority: 'next' | 'later'
        pollEvent: {
          kind: string
          envelope: string
          wake: boolean
          provenance?: unknown
        }
      }) => {
        queued.push(command)
      },
    }
    successes.length = 0
    expect(
      dispatchPrintControlExtra(
        'poll_event',
        { kind: 'idle', event: 'tick' },
        autoDeps,
      ),
    ).toBe(true)
    expect(successes).toEqual([{ delivered: true }])
    expect(queued).toHaveLength(1)
    expect(queued[0]?.mode).toBe('poll-event')
    expect(queued[0]?.isMeta).toBe(true)
    expect(queued[0]?.priority).toBe('next')
    expect(queued[0]?.value).toContain('<event nonce="')
    expect(queued[0]?.pollEvent?.kind).toBe('idle')
    expect(queued[0]?.pollEvent?.wake).toBe(true)
    expect(queued[0]?.pollEvent?.envelope).toBe(queued[0]?.value)
    expect(queued[0]?.pollEvent?.envelope).toContain('tick')
    expect(queued[0]?.pollEvent?.envelope).toContain('<event nonce="')
    const extrasSrc = readFileSync(
      join(import.meta.dir, '../printControlExtras.ts'),
      'utf8',
    )
    const printSrc = readFileSync(join(import.meta.dir, '../print.ts'), 'utf8')
    expect(extrasSrc).toContain('authentic event nonces for this delivery:')
    expect(extrasSrc).toContain('poll-event command without pollEvent payload')
    expect(extrasSrc).toContain(
      'drainCommandQueue: prioritizing orphaned-permission for toolUseID=',
    )
    expect(printSrc).toContain('orphanedPermissionPrioritizeLog')
    expect(printSrc).toContain('formatPollEventsPrompt')
    expect(printSrc).toContain('remintPollEventEnvelope')
    expect(printSrc).toContain("cmd.mode === 'orphaned-permission'")
    expect(printSrc).toContain('handedOffTurn?.continues === true')
    if (prevPoll === undefined) delete process.env.CLAUDE_CODE_POLL_EVENTS
    else process.env.CLAUDE_CODE_POLL_EVENTS = prevPoll
    if (prevRemote === undefined) delete process.env.CLAUDE_CODE_REMOTE
    else process.env.CLAUDE_CODE_REMOTE = prevRemote
    if (prevKind === undefined) delete process.env.CLAUDE_CODE_ENVIRONMENT_KIND
    else process.env.CLAUDE_CODE_ENVIRONMENT_KIND = prevKind
  })

  test('poll-event drain skips slash and is not editable', () => {
    expect(isPromptInputModeEditable('poll-event')).toBe(false)
    expect(
      isQueuedCommandEditable({
        value: '/help',
        mode: 'poll-event',
      } as never),
    ).toBe(false)

    resetCommandQueue()
    enqueue({
      value: '/help',
      mode: 'poll-event',
      isMeta: true,
      skipSlashCommands: true,
      pollEvent: { kind: 'idle', envelope: '/help', wake: true },
    })
    const executed: Array<{ value: string; mode: string; isMeta?: boolean }> =
      []
    const result = processQueueIfReady({
      executeInput: async cmds => {
        for (const cmd of cmds) {
          executed.push({
            value: cmd.value as string,
            mode: cmd.mode,
            isMeta: cmd.isMeta,
          })
        }
      },
    })
    expect(result.processed).toBe(true)
    expect(executed).toEqual([
      { value: '/help', mode: 'poll-event', isMeta: true },
    ])
    resetCommandQueue()
  })

  test('odo peeks handedOffTurn orphan before dequeue so prompt stays queued', () => {
    const print = readFileSync(join(import.meta.dir, '../print.ts'), 'utf8')
    expect(print).toContain('handedOffOrphan')
    expect(print).toContain('cmd === handedOffOrphan')
    expect(print).toContain('holdsBackHandoff')
    expect(print).toContain('deferredToolUsePendingFromMessages')
    expect(print).not.toContain(
      "command.mode === 'prompt' &&\n            command.handedOffTurn === undefined",
    )

    resetCommandQueue()
    enqueue({
      value: 'user prompt',
      mode: 'prompt',
    })
    enqueue({
      value: [],
      mode: 'orphaned-permission',
      isMeta: true,
      handedOffTurn: { toolUseIDs: ['tu-1'] },
    })
    const orphan = peek(
      (cmd: { mode: string; handedOffTurn?: unknown }) =>
        cmd.mode === 'orphaned-permission' && cmd.handedOffTurn !== undefined,
    )
    expect(orphan?.mode).toBe('orphaned-permission')
    const taken = dequeue((cmd: unknown) => cmd === orphan)
    expect(taken?.mode).toBe('orphaned-permission')
    const remaining = getCommandQueue()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.mode).toBe('prompt')
    expect(remaining[0]?.value).toBe('user prompt')
    resetCommandQueue()
  })

  test('odo prefers continues===true && !holdsBack over other orphans', () => {
    resetCommandQueue()
    enqueue({
      value: 'user prompt',
      mode: 'prompt',
    })
    enqueue({
      value: [],
      mode: 'orphaned-permission',
      isMeta: true,
      handedOffTurn: { toolUseIDs: ['tu-hold'] },
    })
    enqueue({
      value: [],
      mode: 'orphaned-permission',
      isMeta: true,
      handedOffTurn: { toolUseIDs: ['tu-cont'], continues: true },
    })
    const pending = deferredToolUsePendingFromMessages([])
    expect(pending).toBe(false)
    const preferred = peek(
      cmd =>
        cmd.mode === 'orphaned-permission' &&
        cmd.handedOffTurn?.continues === true &&
        !holdsBackHandoff(cmd, pending),
    )
    expect(preferred?.handedOffTurn?.toolUseIDs).toEqual(['tu-cont'])
    const taken = dequeue(cmd => cmd === preferred)
    expect(taken?.handedOffTurn?.toolUseIDs).toEqual(['tu-cont'])
    const remaining = getCommandQueue()
    expect(remaining.map(cmd => cmd.mode)).toEqual([
      'prompt',
      'orphaned-permission',
    ])
    resetCommandQueue()
  })

  test('countRemainingWakePollEventsAfter excludes taken wake events', () => {
    resetCommandQueue()
    enqueue({
      value: 'a',
      mode: 'poll-event',
      isMeta: true,
      pollEvent: {
        kind: 'idle',
        envelope: '<event nonce="a">a</event>',
        wake: true,
      },
    })
    enqueue({
      value: 'b',
      mode: 'poll-event',
      isMeta: true,
      priority: 'later',
      pollEvent: {
        kind: 'idle',
        envelope: '<event nonce="b">b</event>',
        wake: true,
      },
    })
    const taken = getCommandQueue()[0]!
    expect(countRemainingWakePollEventsAfter([taken])).toBe(1)
    expect(countRemainingWakePollEventsAfter(getCommandQueue())).toBe(0)
    resetCommandQueue()
  })

  test('poll_event wake false enqueues later', () => {
    const prevPoll = process.env.CLAUDE_CODE_POLL_EVENTS
    const prevRemote = process.env.CLAUDE_CODE_REMOTE
    const prevKind = process.env.CLAUDE_CODE_ENVIRONMENT_KIND
    process.env.CLAUDE_CODE_POLL_EVENTS = '1'
    process.env.CLAUDE_CODE_REMOTE = '1'
    delete process.env.CLAUDE_CODE_ENVIRONMENT_KIND
    const queued: Array<{
      priority?: string
      pollEvent?: { wake: boolean }
    }> = []
    const deps = {
      getMcpClients: () => [] as Array<{ name: string; type: string }>,
      getPermissionContext: () => ({ mode: 'auto' }),
      setPromptSuggestionEnabled: () => {},
      sendSuccess: () => {},
      sendError: () => {},
      defer: (work: () => void | Promise<void>) => {
        void work()
      },
      errorMessage: (err: unknown) => String(err),
      enqueuePollEvent: (command: {
        priority: 'next' | 'later'
        pollEvent: { wake: boolean }
      }) => {
        queued.push(command)
      },
    }
    expect(
      dispatchPrintControlExtra(
        'poll_event',
        { kind: 'idle', event: 'tick', wake: false },
        deps,
      ),
    ).toBe(true)
    expect(queued[0]?.priority).toBe('later')
    expect(queued[0]?.pollEvent?.wake).toBe(false)
    if (prevPoll === undefined) delete process.env.CLAUDE_CODE_POLL_EVENTS
    else process.env.CLAUDE_CODE_POLL_EVENTS = prevPoll
    if (prevRemote === undefined) delete process.env.CLAUDE_CODE_REMOTE
    else process.env.CLAUDE_CODE_REMOTE = prevRemote
    if (prevKind === undefined) delete process.env.CLAUDE_CODE_ENVIRONMENT_KIND
    else process.env.CLAUDE_CODE_ENVIRONMENT_KIND = prevKind
  })

  test('fork_conversation uuid unique English', async () => {
    expect(FORK_CONVERSATION_UUID_ERROR).toBe(
      'fork_conversation: target_message_uuid must be a string',
    )
    expect(
      parseForkConversationControlRequest({
        subtype: 'fork_conversation',
      }).ok,
    ).toBe(true)
    const bad = parseForkConversationControlRequest({
      subtype: 'fork_conversation',
      target_message_uuid: 1,
    })
    expect(bad.ok).toBe(false)
    if (bad.ok) throw new Error('expected fail')
    expect(bad.error).toBe(FORK_CONVERSATION_UUID_ERROR)
    const successes: unknown[] = []
    const errors: string[] = []
    const deps = {
      getMcpClients: () => [] as Array<{ name: string; type: string }>,
      getPermissionContext: () => null,
      setPromptSuggestionEnabled: () => {},
      sendSuccess: (r?: Record<string, unknown>) => successes.push(r ?? {}),
      sendError: (e: string) => errors.push(e),
      defer: (work: () => void | Promise<void>) => {
        void work()
      },
      errorMessage: (err: unknown) => String(err),
    }
    expect(dispatchPrintControlExtra('fork_conversation', {}, deps)).toBe(true)
    for (let i = 0; i < 40 && successes.length === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(errors).toEqual([])
    expect(successes).toEqual([{ ...FORK_UNSUPPORTED_RESPONSE }])
  })

  test('fork_conversation stays unsupported without sdkUrl or CCR host', async () => {
    const successes: unknown[] = []
    const errors: string[] = []
    const base = {
      getMcpClients: () => [] as Array<{ name: string; type: string }>,
      getPermissionContext: () => null,
      setPromptSuggestionEnabled: () => {},
      sendSuccess: (r?: Record<string, unknown>) => successes.push(r ?? {}),
      sendError: (e: string) => errors.push(e),
      defer: (work: () => void | Promise<void>) => {
        void work()
      },
      errorMessage: (err: unknown) => String(err),
    }
    successes.length = 0
    expect(
      dispatchPrintControlExtra('fork_conversation', { title: 't' }, base),
    ).toBe(true)
    for (let i = 0; i < 40 && successes.length === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(successes).toEqual([{ ...FORK_UNSUPPORTED_RESPONSE }])

    successes.length = 0
    expect(
      dispatchPrintControlExtra(
        'fork_conversation',
        {},
        {
          ...base,
          getSdkUrl: () => 'https://sdk.example',
          isCloudHosted: () => true,
          isFirstParty: () => true,
          createForkSession: async () => 'sess-should-not-run',
        },
      ),
    ).toBe(true)
    for (let i = 0; i < 40 && successes.length === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(successes).toEqual([{ ...FORK_UNSUPPORTED_RESPONSE }])

    successes.length = 0
    expect(
      dispatchPrintControlExtra(
        'fork_conversation',
        {},
        {
          ...base,
          getSdkUrl: () => 'https://sdk.example',
          isCloudHosted: () => false,
          isFirstParty: () => false,
          createForkSession: async () => 'sess-should-not-run',
        },
      ),
    ).toBe(true)
    for (let i = 0; i < 40 && successes.length === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(successes).toEqual([{ ...FORK_UNSUPPORTED_RESPONSE }])
    expect(errors).toEqual([])
  })

  test('fork_conversation injected CCR analog returns sessionId', async () => {
    const successes: unknown[] = []
    const created: Array<{
      sdkUrl: string
      target_message_uuid?: string
      title?: string
    }> = []
    const deps = {
      getMcpClients: () => [] as Array<{ name: string; type: string }>,
      getPermissionContext: () => null,
      setPromptSuggestionEnabled: () => {},
      sendSuccess: (r?: Record<string, unknown>) => successes.push(r ?? {}),
      sendError: () => {},
      defer: (work: () => void | Promise<void>) => {
        void work()
      },
      errorMessage: (err: unknown) => String(err),
      getSdkUrl: () => 'https://sdk.example',
      isCloudHosted: () => false,
      isFirstParty: () => true,
      createForkSession: async (input: {
        sdkUrl: string
        target_message_uuid?: string
        title?: string
      }) => {
        created.push(input)
        return 'sess-fork-289'
      },
    }
    expect(
      dispatchPrintControlExtra(
        'fork_conversation',
        { target_message_uuid: 'msg-1', title: 'forked' },
        deps,
      ),
    ).toBe(true)
    for (let i = 0; i < 40 && successes.length === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(created).toEqual([
      {
        sdkUrl: 'https://sdk.example',
        target_message_uuid: 'msg-1',
        title: 'forked',
      },
    ])
    expect(successes).toEqual([{ forked: true, sessionId: 'sess-fork-289' }])
  })

  test('UIn resolveTurnHandoffAdmission EXACT gold gates', () => {
    expect(resolveTurnHandoffAdmission({})).toEqual({
      admitted: false,
      reason: DEVICE_HOOKS_NOT_MANAGED,
    })
    expect(
      resolveTurnHandoffAdmission({
        sdkUrl: 'https://sdk.example',
      }),
    ).toEqual({ admitted: false, reason: DEVICE_HOOKS_NOT_MANAGED })
    expect(
      resolveTurnHandoffAdmission({
        sdkUrl: 'https://sdk.example',
        remoteSessionId: 'sess',
        environmentKind: 'bridge',
      }),
    ).toEqual({ admitted: false, reason: DEVICE_HOOKS_NOT_MANAGED })
    expect(
      resolveTurnHandoffAdmission({
        sdkUrl: 'https://sdk.example',
        remoteSessionId: 'sess',
        disabled: true,
      }),
    ).toEqual({ admitted: false, reason: TURN_HANDOFF_DISABLED_REASON })
    expect(
      resolveTurnHandoffAdmission({
        sdkUrl: 'https://sdk.example',
        remoteSessionId: 'sess',
      }),
    ).toEqual({
      admitted: true,
      tools: [...TURN_HANDOFF_ADMITTED_TOOLS],
    })
    expect(TURN_HANDOFF_ADMITTED_TOOLS).toEqual([
      'Bash',
      'Write',
      'Edit',
      'Read',
      'Glob',
      'Grep',
      'Agent',
      'NotebookEdit',
      'WebFetch',
      'WebSearch',
      'TaskStop',
      'SearchMcpRegistry',
      'SuggestConnectors',
      'ListConnectors',
      'Artifact',
    ])
  })

  test('turn_handoff default not_managed; admitted enqueues analog', () => {
    const errors: string[] = []
    const successes: unknown[] = []
    const queued: Array<{
      mode: string
      value: unknown
      isMeta?: boolean
      handedOffTurn?: { toolUseIDs: string[]; continues?: boolean }
    }> = []
    const deps = {
      getMcpClients: () => [] as Array<{ name: string; type: string }>,
      getPermissionContext: () => null,
      setPromptSuggestionEnabled: () => {},
      sendSuccess: (r?: Record<string, unknown>) => successes.push(r ?? {}),
      sendError: (e: string) => errors.push(e),
      defer: (work: () => void | Promise<void>) => {
        void work()
      },
      errorMessage: (err: unknown) => String(err),
    }
    expect(dispatchPrintControlExtra('turn_handoff', {}, deps)).toBe(true)
    expect(errors).toEqual([
      `${TURN_HANDOFF_DISABLED_PREFIX}${DEVICE_HOOKS_NOT_MANAGED}`,
    ])

    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {},
        {
          ...deps,
          turnHandoffAdmission: { admitted: false, reason: 'policy_blocked' },
        },
      ),
    ).toBe(true)
    expect(errors).toEqual([`${TURN_HANDOFF_DISABLED_PREFIX}policy_blocked`])

    errors.length = 0
    successes.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        { messages: [lastAssistantHistory()] },
        {
          ...deps,
          turnHandoffAdmission: { admitted: true, reason: 'managed' },
          enqueueHandoff: command => {
            queued.push(command)
          },
          getMainThreadAgentId: () => asAgentId('main-thread'),
        },
      ),
    ).toBe(true)
    expect(errors).toEqual([])
    expect(queued).toMatchObject([
      {
        mode: 'orphaned-permission',
        value: [],
        isMeta: true,
        agentId: 'main-thread',
        handedOffTurn: { toolUseIDs: [], kind: 'history' },
      },
    ])
    expect(successes).toEqual([{ status: 'accepted', tool_use_ids: [] }])

    queued.length = 0
    successes.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          tool_use_ids: ['tu-1'],
          messages: [lastAssistantCall('tu-1')],
        },
        {
          ...deps,
          turnHandoffAdmission: { admitted: true, reason: 'managed' },
          getHandoffToolUseIds: request =>
            Array.isArray(request.tool_use_ids)
              ? request.tool_use_ids.filter(
                  (id): id is string => typeof id === 'string',
                )
              : [],
          enqueueHandoff: command => {
            queued.push(command)
          },
        },
      ),
    ).toBe(true)
    expect(queued).toMatchObject([
      {
        mode: 'orphaned-permission',
        value: [],
        isMeta: true,
        handedOffTurn: { toolUseIDs: ['tu-1'], kind: 'run' },
      },
    ])
    expect(successes).toEqual([{ status: 'accepted', tool_use_ids: ['tu-1'] }])

    queued.length = 0
    successes.length = 0
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          tool_use_ids: ['tu-1'],
          messages: [lastAssistantCall('tu-1')],
          relay_marker: { uuid: 'r1', content: 'ok' },
          file_names: [{ file_uuid: 'f1', name: 'a.txt' }],
          memory_context: { uuid: 'mem-1', version: '1', content: 'm' },
        },
        {
          ...deps,
          turnHandoffAdmission: { admitted: true, reason: 'managed' },
          enqueueHandoff: command => {
            queued.push(command)
          },
        },
      ),
    ).toBe(true)
    expect(errors).toEqual([])
    expect(queued).toMatchObject([
      {
        mode: 'orphaned-permission',
        value: [],
        isMeta: true,
        handedOffTurn: {
          toolUseIDs: ['tu-1'],
          kind: 'run',
          relayMarker: { uuid: 'r1', content: 'ok' },
          fileNames: [{ fileUuid: 'f1', name: 'a.txt' }],
          memoryLine: {
            type: 'cowork_memory_context',
            uuid: 'mem-1',
            version: '1',
            content: 'm',
          },
        },
      },
    ])
    queued.length = 0
    successes.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          tool_use_ids: ['tu-2'],
          continues: true,
          messages: [lastAssistantCall('tu-2')],
        },
        {
          ...deps,
          turnHandoffAdmission: { admitted: true, reason: 'managed' },
          getHandoffToolUseIds: request =>
            Array.isArray(request.tool_use_ids)
              ? request.tool_use_ids.filter(
                  (id): id is string => typeof id === 'string',
                )
              : [],
          enqueueHandoff: command => {
            queued.push(command)
          },
        },
      ),
    ).toBe(true)
    expect(queued).toMatchObject([
      {
        mode: 'orphaned-permission',
        value: [],
        isMeta: true,
        handedOffTurn: { toolUseIDs: ['tu-2'], continues: true, kind: 'run' },
      },
    ])

    queued.length = 0
    successes.length = 0
    errors.length = 0
    const prevRemote = process.env.CLAUDE_CODE_REMOTE_SESSION_ID
    const prevKind = process.env.CLAUDE_CODE_ENVIRONMENT_KIND
    const prevDisable = process.env.CLAUDE_CODE_DISABLE_TURN_HANDOFF
    process.env.CLAUDE_CODE_REMOTE_SESSION_ID = 'sess-u'
    delete process.env.CLAUDE_CODE_ENVIRONMENT_KIND
    delete process.env.CLAUDE_CODE_DISABLE_TURN_HANDOFF
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          tool_use_ids: ['tu-env'],
          messages: [lastAssistantCall('tu-env')],
        },
        {
          ...deps,
          getSdkUrl: () => 'https://sdk.example',
          getHandoffToolUseIds: request =>
            Array.isArray(request.tool_use_ids)
              ? request.tool_use_ids.filter(
                  (id): id is string => typeof id === 'string',
                )
              : [],
          enqueueHandoff: command => {
            queued.push(command)
          },
        },
      ),
    ).toBe(true)
    expect(errors).toEqual([])
    expect(queued).toMatchObject([
      {
        mode: 'orphaned-permission',
        value: [],
        isMeta: true,
        handedOffTurn: { toolUseIDs: ['tu-env'], kind: 'run' },
      },
    ])
    if (prevRemote === undefined)
      delete process.env.CLAUDE_CODE_REMOTE_SESSION_ID
    else process.env.CLAUDE_CODE_REMOTE_SESSION_ID = prevRemote
    if (prevKind === undefined) delete process.env.CLAUDE_CODE_ENVIRONMENT_KIND
    else process.env.CLAUDE_CODE_ENVIRONMENT_KIND = prevKind
    if (prevDisable === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_TURN_HANDOFF
    } else {
      process.env.CLAUDE_CODE_DISABLE_TURN_HANDOFF = prevDisable
    }
  })

  test('fco invalid_handoff unique English EXACT gold', () => {
    expect(INVALID_HANDOFF_TOOL_USE_IDS_REPEAT).toBe(
      'invalid_handoff: tool_use_ids repeat',
    )
    expect(INVALID_HANDOFF_MESSAGE_UUIDS_REPEAT).toBe(
      'invalid_handoff: message uuids repeat',
    )
    expect(INVALID_HANDOFF_EVERY_MESSAGE_NEEDS_UUID).toBe(
      'invalid_handoff: every message needs a uuid',
    )
    expect(INVALID_HANDOFF_ANOTHER_QUEUED).toBe(
      'invalid_handoff: another handed-off turn is still queued',
    )
    const errors: string[] = []
    const successes: unknown[] = []
    const queued: unknown[] = []
    const deps = {
      getMcpClients: () => [] as Array<{ name: string; type: string }>,
      getPermissionContext: () => null,
      setPromptSuggestionEnabled: () => {},
      sendSuccess: (r?: Record<string, unknown>) => successes.push(r ?? {}),
      sendError: (e: string) => errors.push(e),
      defer: (work: () => void | Promise<void>) => {
        void work()
      },
      errorMessage: (err: unknown) => String(err),
      turnHandoffAdmission: { admitted: true, reason: 'managed' },
      enqueueHandoff: (command: unknown) => {
        queued.push(command)
      },
    }
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        { tool_use_ids: ['a', 'a'] },
        deps,
      ),
    ).toBe(true)
    expect(errors).toEqual([INVALID_HANDOFF_TOOL_USE_IDS_REPEAT])
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          messages: [{ uuid: 'u1' }, { uuid: 'u1' }],
        },
        deps,
      ),
    ).toBe(true)
    expect(errors).toEqual([INVALID_HANDOFF_MESSAGE_UUIDS_REPEAT])
    errors.length = 0
    expect(
      dispatchPrintControlExtra('turn_handoff', { messages: [{}] }, deps),
    ).toBe(true)
    expect(errors).toEqual([INVALID_HANDOFF_EVERY_MESSAGE_NEEDS_UUID])
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          tool_use_ids: ['tu-new'],
          messages: [lastAssistantCall('tu-new')],
        },
        {
          ...deps,
          peekHandoff: () => ({ handedOffTurn: { toolUseIDs: ['old'] } }),
        },
      ),
    ).toBe(true)
    expect(errors).toEqual([INVALID_HANDOFF_ANOTHER_QUEUED])
    expect(queued).toEqual([])
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        { messages: [{ uuid: 'u1', type: 'user' }] },
        deps,
      ),
    ).toBe(true)
    expect(errors).toEqual([INVALID_HANDOFF_LAST_NOT_ASSISTANT])
    errors.length = 0
    successes.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          tool_use_ids: ['tu-done'],
          messages: [lastAssistantCall('tu-done')],
        },
        {
          ...deps,
          getMessages: () => [
            {
              type: 'user',
              message: {
                content: [{ type: 'tool_result', tool_use_id: 'tu-done' }],
              },
            },
          ],
        },
      ),
    ).toBe(true)
    expect(successes).toEqual([{ status: 'duplicate' }])
    successes.length = 0
    expect(INVALID_HANDOFF_LAST_NOT_ASSISTANT).toBe(
      'invalid_handoff: the last message is not an assistant message',
    )
    expect(INVALID_HANDOFF_SOME_TAKEN).toBe(
      'invalid_handoff: some of the named calls are already taken or answered',
    )
    expect(INVALID_HANDOFF_MOVED_ON).toBe(
      'invalid_handoff: the conversation has moved on past the part of the turn it holds',
    )
    expect(INVALID_HANDOFF_PENDING_LINES).toBe(
      'invalid_handoff: the turn does not carry the lines of its pending delivery',
    )
    expect(INVALID_HANDOFF_ANOTHER_RUNNING).toBe(
      'invalid_handoff: another handed-off turn is still running',
    )
    errors.length = 0
    expect(dispatchPrintControlExtra('turn_handoff', {}, deps)).toBe(true)
    expect(errors).toEqual([INVALID_HANDOFF_LAST_NOT_ASSISTANT])
    errors.length = 0
    expect(
      dispatchPrintControlExtra('turn_handoff', { messages: [] }, deps),
    ).toBe(true)
    expect(errors).toEqual([INVALID_HANDOFF_LAST_NOT_ASSISTANT])
    errors.length = 0
    expect(invalidHandoffAssistantIdRepeats('msg-1')).toBe(
      'invalid_handoff: assistant message id msg-1 repeats or is already in the conversation',
    )
    expect(invalidHandoffCarriedWrites('switched_off')).toBe(
      `invalid_handoff: carried_writes_switched_off: ${CARRIED_WRITES_REASONS.switched_off}`,
    )
    const converted: Array<{ toolUseIDs: string[]; continues?: boolean }> = []
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          messages: [
            { uuid: 'u1', type: 'user' },
            { uuid: 'a1', type: 'assistant' },
          ],
        },
        {
          ...deps,
          peekHandoff: () => ({
            handedOffTurn: {
              toolUseIDs: ['tu-run'],
              kind: 'run',
              messages: [
                { uuid: 'u1', type: 'user' },
                { uuid: 'a1', type: 'assistant' },
              ],
            },
          }),
          convertHandoff: handedOffTurn => {
            converted.push(handedOffTurn)
          },
        },
      ),
    ).toBe(true)
    expect(converted).toMatchObject([
      { toolUseIDs: ['tu-run'], kind: 'history' },
    ])
    expect(successes).toEqual([{ status: 'accepted', tool_use_ids: [] }])
    expect(queued).toEqual([])
    successes.length = 0
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          messages: [
            { uuid: 'u-other', type: 'user' },
            { uuid: 'a1', type: 'assistant' },
          ],
        },
        {
          ...deps,
          peekHandoff: () => ({
            handedOffTurn: {
              toolUseIDs: ['tu-run'],
              kind: 'run',
              messages: [
                { uuid: 'u1', type: 'user' },
                { uuid: 'a1', type: 'assistant' },
              ],
            },
          }),
        },
      ),
    ).toBe(true)
    expect(errors).toEqual([INVALID_HANDOFF_PENDING_LINES])
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          messages: [
            { uuid: 'u1', type: 'user' },
            {
              uuid: 'a1',
              type: 'assistant',
              message: {
                content: [{ type: 'tool_use', id: 'tu-req', name: 'Write' }],
              },
            },
          ],
        },
        {
          ...deps,
          peekHandoff: () => ({
            handedOffTurn: {
              toolUseIDs: ['tu-run'],
              kind: 'run',
              messages: [
                { uuid: 'u1', type: 'user' },
                {
                  uuid: 'a1',
                  type: 'assistant',
                  message: {
                    content: [
                      { type: 'tool_use', id: 'tu-pend', name: 'Write' },
                    ],
                  },
                },
              ],
            },
          }),
        },
      ),
    ).toBe(true)
    expect(errors).toEqual([INVALID_HANDOFF_PENDING_LINES])
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          messages: [
            { uuid: 'u1', type: 'user' },
            {
              uuid: 'a1',
              type: 'assistant',
              message: {
                content: [{ type: 'tool_use', id: 'tu-a', name: 'Write' }],
              },
            },
          ],
        },
        {
          ...deps,
          peekHandoff: () => ({
            handedOffTurn: {
              toolUseIDs: ['tu-run'],
              kind: 'run',
              messages: [
                { uuid: 'u1', type: 'user' },
                {
                  uuid: 'a1',
                  type: 'assistant',
                  message: {
                    content: [
                      { type: 'tool_use', id: 'tu-a', name: 'Write' },
                      { type: 'tool_result', tool_use_id: 'tu-b' },
                    ],
                  },
                },
              ],
            },
          }),
        },
      ),
    ).toBe(true)
    expect(errors).toEqual([INVALID_HANDOFF_PENDING_LINES])
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          messages: [
            { uuid: 'u1', type: 'user' },
            { uuid: 'a1', type: 'assistant' },
          ],
        },
        {
          ...deps,
          peekHandoff: () => ({
            handedOffTurn: {
              toolUseIDs: [],
              kind: 'history',
              messages: [
                { uuid: 'u1', type: 'user' },
                { uuid: 'a1', type: 'assistant' },
              ],
            },
          }),
        },
      ),
    ).toBe(true)
    expect(successes).toEqual([{ status: 'duplicate' }])
    expect(queued).toEqual([])
    successes.length = 0
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          messages: [
            { uuid: 'u1', type: 'user' },
            { uuid: 'a1', type: 'assistant' },
          ],
        },
        {
          ...deps,
          peekHandoff: () => ({
            handedOffTurn: {
              toolUseIDs: [],
              kind: 'stopped',
              messages: [
                { uuid: 'u1', type: 'user' },
                { uuid: 'a1', type: 'assistant' },
              ],
            },
          }),
        },
      ),
    ).toBe(true)
    expect(successes).toEqual([{ status: 'duplicate' }])
    expect(queued).toEqual([])
    successes.length = 0
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          messages: [
            { uuid: 'u1', type: 'user' },
            { uuid: 'a1', type: 'assistant' },
          ],
        },
        {
          ...deps,
          peekHandoff: () => ({
            handedOffTurn: {
              toolUseIDs: ['tu-run'],
              kind: 'run',
              messages: [
                { uuid: 'u1', type: 'user' },
                { uuid: 'a1', type: 'assistant' },
              ],
            },
          }),
          peekRunningHandoff: () => ({
            handedOffTurn: { toolUseIDs: ['tu-run'], kind: 'run' },
            messages: [{ uuid: 'a-other' }],
          }),
        },
      ),
    ).toBe(true)
    expect(errors).toEqual([INVALID_HANDOFF_ANOTHER_RUNNING])
    errors.length = 0
    successes.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          messages: [
            { uuid: 'u1', type: 'user' },
            { uuid: 'a1', type: 'assistant' },
          ],
        },
        {
          ...deps,
          peekRunningHandoff: () => ({
            handedOffTurn: { toolUseIDs: ['tu-run'] },
            messages: [{ uuid: 'a1' }],
          }),
        },
      ),
    ).toBe(true)
    expect(successes).toEqual([{ status: 'duplicate' }])
    errors.length = 0
    successes.length = 0
    let stoppedRunning = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          stopped: true,
          messages: [
            { uuid: 'u1', type: 'user' },
            {
              uuid: 'a1',
              type: 'assistant',
              message: {
                content: [{ type: 'tool_use', id: 'tu-x', name: 'Write' }],
              },
            },
          ],
        },
        {
          ...deps,
          peekRunningHandoff: () => ({
            handedOffTurn: { toolUseIDs: ['tu-run'], kind: 'run' },
            messages: [{ uuid: 'a1' }],
          }),
          stopRunningHandoff: () => {
            stoppedRunning++
          },
        },
      ),
    ).toBe(true)
    expect(successes).toEqual([{ status: 'duplicate' }])
    expect(stoppedRunning).toBe(1)
    errors.length = 0
    successes.length = 0
    expect(RECOVERED_BY_RESTART).toBe(
      "recovered_by_restart: this worker restarted after the turn was appended and its recovery set the turn's unrun calls aside",
    )
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          tool_use_ids: ['tu-done'],
          messages: [lastAssistantCall('tu-done')],
        },
        {
          ...deps,
          recoveredToolUseIds: () => ['tu-done'],
          getMessages: () => [],
        },
      ),
    ).toBe(true)
    expect(errors).toEqual([RECOVERED_BY_RESTART])
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          messages: [
            { uuid: 'held', type: 'user' },
            { uuid: 'new-last', type: 'assistant' },
          ],
        },
        {
          ...deps,
          getMessages: () => [{ uuid: 'held', type: 'user' }],
        },
      ),
    ).toBe(true)
    expect(errors).toEqual([INVALID_HANDOFF_MOVED_ON])
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          messages: [
            {
              uuid: 'a-dup',
              type: 'assistant',
              message: { id: 'asst-1' },
            },
          ],
        },
        {
          ...deps,
          getMessages: () => [
            {
              type: 'assistant',
              uuid: 'old',
              message: { id: 'asst-1' },
            },
          ],
        },
      ),
    ).toBe(true)
    expect(errors).toEqual([invalidHandoffAssistantIdRepeats('asst-1')])
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          tool_use_ids: ['tu-new'],
          messages: [lastAssistantCall('tu-new')],
        },
        {
          ...deps,
          peekRunningHandoff: () => ({
            handedOffTurn: { toolUseIDs: ['tu-run'] },
            messages: [{ uuid: 'a-other' }],
          }),
        },
      ),
    ).toBe(true)
    expect(errors).toEqual([INVALID_HANDOFF_ANOTHER_RUNNING])
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          tool_use_ids: ['tu-write'],
          messages: [lastAssistantCall('tu-write')],
        },
        {
          ...deps,
          carriedWrites: () => ({ switchedOn: false }),
        },
      ),
    ).toBe(true)
    expect(errors).toEqual([invalidHandoffCarriedWrites('switched_off')])
    expect(invalidHandoffNotPlain(2)).toBe(
      'invalid_handoff: messages.2 is not a plain conversation line',
    )
    expect(invalidHandoffUserHoldsToolUse('u-hold')).toBe(
      'invalid_handoff: user message u-hold holds a tool_use block',
    )
    expect(invalidHandoffToolUseRepeats('tu-dup')).toBe(
      'invalid_handoff: tool_use tu-dup repeats',
    )
    expect(INVALID_HANDOFF_STOPPED_NAMES_NO_CALLS).toBe(
      'invalid_handoff: a stopped turn names no calls to run',
    )
    expect(INVALID_HANDOFF_STOPPED_UNRUN).toBe(
      'invalid_handoff: a stopped turn ends with calls that have not run',
    )
    expect(invalidHandoffToolUseNotInLast('tu-miss')).toBe(
      'invalid_handoff: tool_use tu-miss is not in the last message',
    )
    expect(unsupportedTool('Write')).toBe('unsupported_tool: Write')
    expect(unknownTool('Write')).toBe('unknown_tool: Write')
    expect(INVALID_HANDOFF_ALREADY_HOLDS).toBe(
      'invalid_handoff: the turn carries messages the conversation already holds',
    )
    expect(INVALID_HANDOFF_HOLDS_OUT_OF_ORDER).toBe(
      'invalid_handoff: the turn carries messages the conversation already holds out of order',
    )
    expect(INVALID_HANDOFF_SOME_ANSWERED).toBe(
      'invalid_handoff: some of the calls are already answered',
    )
    for (const reason of Object.keys(CARRIED_WRITES_REASONS) as Array<
      keyof typeof CARRIED_WRITES_REASONS
    >) {
      expect(invalidHandoffCarriedWrites(reason)).toBe(
        `invalid_handoff: carried_writes_${reason}: ${CARRIED_WRITES_REASONS[reason]}`,
      )
    }
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          messages: [
            { uuid: 'u1', type: 'user' },
            { uuid: 'a1', type: 'assistant', is_meta: true },
          ],
        },
        deps,
      ),
    ).toBe(true)
    expect(errors).toEqual([invalidHandoffNotPlain(1)])
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          messages: [
            {
              uuid: 'u-hold',
              type: 'user',
              message: { content: [{ type: 'tool_use', id: 'tu-x' }] },
            },
            { uuid: 'a1', type: 'assistant' },
          ],
        },
        deps,
      ),
    ).toBe(true)
    expect(errors).toEqual([invalidHandoffUserHoldsToolUse('u-hold')])
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          messages: [
            {
              uuid: 'a1',
              type: 'assistant',
              message: {
                content: [
                  { type: 'tool_use', id: 'tu-dup', name: 'Bash' },
                  { type: 'tool_use', id: 'tu-dup', name: 'Bash' },
                ],
              },
            },
          ],
        },
        deps,
      ),
    ).toBe(true)
    expect(errors).toEqual([invalidHandoffToolUseRepeats('tu-dup')])
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          stopped: true,
          tool_use_ids: ['tu-1'],
          messages: [
            {
              uuid: 'a1',
              type: 'assistant',
              message: {
                content: [{ type: 'tool_use', id: 'tu-1', name: 'Bash' }],
              },
            },
          ],
        },
        deps,
      ),
    ).toBe(true)
    expect(errors).toEqual([INVALID_HANDOFF_STOPPED_NAMES_NO_CALLS])
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          stopped: true,
          messages: [{ uuid: 'a1', type: 'assistant' }],
        },
        deps,
      ),
    ).toBe(true)
    expect(errors).toEqual([INVALID_HANDOFF_STOPPED_UNRUN])
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          tool_use_ids: ['tu-miss'],
          messages: [
            {
              uuid: 'a1',
              type: 'assistant',
              message: {
                content: [{ type: 'tool_use', id: 'tu-other', name: 'Bash' }],
              },
            },
          ],
        },
        deps,
      ),
    ).toBe(true)
    expect(errors).toEqual([invalidHandoffToolUseNotInLast('tu-miss')])
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          tool_use_ids: ['tu-1'],
          messages: [
            {
              uuid: 'a1',
              type: 'assistant',
              message: {
                content: [{ type: 'tool_use', id: 'tu-1', name: 'Bash' }],
              },
            },
          ],
        },
        {
          ...deps,
          acceptedTools: ['Write'],
        },
      ),
    ).toBe(true)
    expect(errors).toEqual([unsupportedTool('Bash')])
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          tool_use_ids: ['tu-1'],
          messages: [
            {
              uuid: 'a1',
              type: 'assistant',
              message: {
                content: [{ type: 'tool_use', id: 'tu-1', name: 'Bash' }],
              },
            },
          ],
        },
        {
          ...deps,
          knownTools: ['Write'],
        },
      ),
    ).toBe(true)
    expect(errors).toEqual([unknownTool('Bash')])
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          tool_use_ids: ['tu-1'],
          messages: [
            {
              uuid: 'held',
              type: 'assistant',
              message: {
                content: [{ type: 'tool_use', id: 'tu-1', name: 'Bash' }],
              },
            },
          ],
        },
        {
          ...deps,
          getMessages: () => [{ uuid: 'held', type: 'user' }],
        },
      ),
    ).toBe(true)
    expect(errors).toEqual([INVALID_HANDOFF_ALREADY_HOLDS])
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          messages: [
            { uuid: 'a', type: 'user' },
            { uuid: 'b', type: 'user' },
            { uuid: 'c', type: 'assistant' },
          ],
        },
        {
          ...deps,
          getMessages: () => [{ uuid: 'c', type: 'assistant' }],
        },
      ),
    ).toBe(true)
    expect(errors).toEqual([INVALID_HANDOFF_HOLDS_OUT_OF_ORDER])
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          messages: [
            {
              uuid: 'a1',
              type: 'assistant',
              message: {
                content: [
                  { type: 'tool_use', id: 'tu-a', name: 'Bash' },
                  { type: 'tool_use', id: 'tu-b', name: 'Bash' },
                ],
              },
            },
          ],
        },
        {
          ...deps,
          getMessages: () => [
            {
              type: 'user',
              message: {
                content: [{ type: 'tool_result', tool_use_id: 'tu-a' }],
              },
            },
          ],
        },
      ),
    ).toBe(true)
    expect(errors).toEqual([INVALID_HANDOFF_SOME_ANSWERED])
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          tool_use_ids: ['tu-write'],
          messages: [lastAssistantCall('tu-write')],
        },
        {
          ...deps,
          carriedWrites: () => ({ switchedOn: true, reason: 'odd_input' }),
        },
      ),
    ).toBe(true)
    expect(errors).toEqual([invalidHandoffCarriedWrites('odd_input')])
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          tool_use_ids: ['tu-write'],
          messages: [lastAssistantCall('tu-write')],
        },
        {
          ...deps,
          carriedWrites: () => ({ switchedOn: true, cwdIsHome: false }),
        },
      ),
    ).toBe(true)
    expect(errors).toEqual([invalidHandoffCarriedWrites('not_home')])
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          tool_use_ids: ['tu-write'],
          messages: [lastAssistantCall('tu-write')],
        },
        {
          ...deps,
          carriedWrites: () => ({
            switchedOn: true,
            permissionMode: 'auto',
          }),
        },
      ),
    ).toBe(true)
    expect(errors).toEqual([invalidHandoffCarriedWrites('auto_mode')])
    errors.length = 0
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          tool_use_ids: ['tu-write'],
          messages: [lastAssistantCall('tu-write')],
        },
        {
          ...deps,
          carriedWrites: () => ({
            switchedOn: true,
            permissionMode: 'plan',
          }),
        },
      ),
    ).toBe(true)
    expect(errors).toEqual([invalidHandoffCarriedWrites('would_ask')])
    errors.length = 0
    expect(
      carriedWritesRefusalFromTurn(
        [
          {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: 'tu-write',
                  name: 'Write',
                  input: { file_path: 1, content: 'x' },
                },
              ],
            },
          },
          {
            type: 'user',
            message: {
              content: [{ type: 'tool_result', tool_use_id: 'tu-write' }],
            },
          },
        ],
        { switchedOn: true, home: '/home' },
      ),
    ).toEqual({ reason: 'odd_input', collected: true })
    expect(
      dispatchPrintControlExtra(
        'turn_handoff',
        {
          tool_use_ids: ['tu-write'],
          messages: [lastAssistantCall('tu-write')],
        },
        {
          ...deps,
          carriedWrites: () => ({
            switchedOn: true,
            home: '/home',
            reason: 'odd_input',
          }),
        },
      ),
    ).toBe(true)
    expect(errors).toEqual([invalidHandoffCarriedWrites('odd_input')])
    expect(
      carriedWritesRefusalFromTurn(
        [
          {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: 'tu-write',
                  name: 'Write',
                  input: { file_path: '/home/a.txt', content: 'x' },
                },
              ],
            },
          },
          {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'tu-write',
                  content: 'nope',
                },
              ],
            },
          },
        ],
        { switchedOn: true, home: '/home' },
      ),
    ).toEqual({ reason: 'result_text', collected: true })
    expect(
      carriedWritesRefusalFromTurn(
        [
          {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: 'tu-write',
                  name: 'Write',
                  input: { file_path: '/home/CLAUDE.md', content: 'x' },
                },
              ],
            },
          },
          {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'tu-write',
                  content: 'File created successfully at: /home/CLAUDE.md',
                },
              ],
            },
          },
        ],
        { switchedOn: true, home: '/home' },
      ),
    ).toEqual({ reason: 'refused_name', collected: true })
    expect(
      carriedWritesRefusalFromTurn(
        [
          {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: 'tu-write',
                  name: 'Write',
                  input: {
                    file_path: '/home/a\uD800.txt',
                    content: 'x',
                  },
                },
              ],
            },
          },
          {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'tu-write',
                  content: 'File created successfully at: /home/a\uD800.txt',
                },
              ],
            },
          },
        ],
        { switchedOn: true, home: '/home' },
      ),
    ).toEqual({ reason: 'refused_name', collected: true })
    expect(invalidHandoffToolUseTaken('tu-x')).toBe(
      'invalid_handoff: tool_use tu-x is already in the conversation or taken',
    )
    expect(invalidHandoffToolResultNoEarlier('tu-x')).toBe(
      'invalid_handoff: tool_result tu-x answers no earlier tool_use in the turn',
    )
    expect(invalidHandoffToolResultAlreadyAnswers('tu-x')).toBe(
      'invalid_handoff: tool_result tu-x answers a call the conversation already answers',
    )
    expect(invalidHandoffToolUseNotNamed('tu-x')).toBe(
      'invalid_handoff: tool_use tu-x in the last message is not named',
    )
    expect(invalidHandoffToolUseHasNoResult('tu-x')).toBe(
      'invalid_handoff: tool_use tu-x has no result',
    )
    const print = readFileSync(join(import.meta.dir, '../print.ts'), 'utf8')
    expect(print).toContain('pollEventDeliveryGuard: true')
    expect(print).toContain('peekHandoff')
    expect(print).toContain('convertHandoff')
    expect(print).toContain('peekRunningHandoff')
    expect(print).not.toContain('const holdsEvalSettles = waitingForAgents')
    expect(print).toContain('s??(()=>!1)')
    expect(print).toContain('const holdsEvalSettles = (): boolean => false')
    expect(print).toContain('if (holdsEvalSettles())')
    expect(print).not.toContain(
      'if (waitingForAgents) { command = undefined; break }',
    )
    expect(print).toContain('settleDropped')
    expect(print).toContain('recoveredToolUseIds')
    expect(print).toContain('handedOffTurn: command.handedOffTurn')
    expect(print).toContain('recoveredToolUseIds.add')
    expect(print).toContain('shouldQuery === false')
    expect(print).toContain("createAbortErrorReason('remote-cancel')")
    expect(print).toContain('getMainThreadAgentId')
    expect(print).toContain("t.type !== 'in_process_teammate'")
    expect(print).toContain('void stopTask(t.id')
    expect(print).toContain(
      'agentId: command.agentId ?? getMainThreadAgentId()',
    )
    const extras = readFileSync(
      join(import.meta.dir, '../printControlExtras.ts'),
      'utf8',
    )
    expect(extras).toContain('function handoffLinesMatch')
    expect(extras).toContain('function isWellFormedPath')
    expect(extras).toContain(
      "pendingKind === handoffKind || pendingKind === 'stopped'",
    )
    expect(TURN_HANDOFF_MEMORY_CONTEXT_UUID_USED).toBe(
      'turn_handoff: memory_context.uuid is already used in the request or the conversation; the turn runs without it',
    )
    expect(turnHandoffMemoryContextUnparseable('memory_context.uuid')).toBe(
      'turn_handoff: memory_context.uuid: unparseable; the turn runs without it',
    )
    expect(turnHandoffMemoryContextMismatched('content but no version')).toBe(
      'turn_handoff: memory_context has content but no version; the turn runs without it',
    )
  })

  test('chrome / device-hooks unique English', () => {
    expect(CHROME_NOT_CONNECTED).toBe(
      'Claude in Chrome is not connected in this session',
    )
    expect(CHROME_HINTS_REMOTE_ONLY).toBe(
      'set_chrome_browser_hints is only accepted in a remote-hosted session',
    )
    expect(`${DEVICE_HOOKS_DISABLED_PREFIX}${DEVICE_HOOKS_NOT_MANAGED}`).toBe(
      'hook_forwarding_disabled: not_managed_cloud_worker',
    )
  })

  test('get_status missing builder unique English', () => {
    expect(NOT_AVAILABLE_IN_THIS_BUILD('get_status')).toBe(
      'get_status is not available in this build',
    )
  })

  test('print.ts hosts extras dispatcher and skips overlay footer', () => {
    const print = readFileSync(join(import.meta.dir, '../print.ts'), 'utf8')
    expect(print).toContain('dispatchPrintControlExtra')
    expect(print).not.toContain('overlay footer')
    expect(print).not.toContain('function Fco')
    for (const subtype of PRINT_CONTROL_EXTRA_SUBTYPES) {
      expect(print).not.toContain(`req.subtype === '${subtype}'`)
    }
    expect(print).toContain("command.mode !== 'poll-event'")
    expect(print).toContain('command.pollEvent?.envelope')
    expect(print).toContain("cmd.mode === 'poll-event'")
    expect(print).toContain('createBridgeSession')
    expect(print).toContain('handedOffTurn: command.handedOffTurn')
    expect(print).toContain('orphanedPermissionPrioritizeLog')
    expect(print).toContain('formatPollEventsPrompt')
    expect(print).toContain('remintPollEventEnvelope')
    expect(print).toContain('POLL_EVENT_MISSING_PAYLOAD')
  })

  test('dispatch message_rated success and chrome disconnected Qe', () => {
    const errors: string[] = []
    const successes: unknown[] = []
    const deps = {
      getMcpClients: () => [] as Array<{ name: string; type: string }>,
      getPermissionContext: () => null,
      setPromptSuggestionEnabled: () => {},
      sendSuccess: (r?: Record<string, unknown>) => successes.push(r ?? {}),
      sendError: (e: string) => errors.push(e),
      defer: (work: () => void | Promise<void>) => {
        void work()
      },
      errorMessage: (err: unknown) => String(err),
    }
    expect(
      dispatchPrintControlExtra(
        'message_rated',
        { messageUuid: 'a', sentiment: 'negative' },
        deps,
      ),
    ).toBe(true)
    expect(successes).toEqual([{}])
    expect(dispatchPrintControlExtra('get_chrome_browsers', {}, deps)).toBe(
      true,
    )
    expect(errors).toContain(CHROME_NOT_CONNECTED)
  })

  test('list_directory is a print extra subtype', () => {
    expect(PRINT_CONTROL_EXTRA_SUBTYPES).toContain('list_directory')
  })

  test('list_directory unique English deny', async () => {
    const {
      LIST_DIRECTORY_DENIED,
      LIST_DIRECTORY_REFUSAL_OF_ANOTHER_MODULE,
      listDenied,
    } = await import('../printControlExtras.js')
    expect(LIST_DIRECTORY_DENIED).toBe('list denied: unexpected_error')
    expect(LIST_DIRECTORY_REFUSAL_OF_ANOTHER_MODULE).toBe(
      'list_directory: a refusal of another module',
    )
    expect(listDenied('not_found')).toBe('list denied: not_found')
    const errors: string[] = []
    const deps = {
      getMcpClients: () => [] as Array<{ name: string; type: string }>,
      getPermissionContext: () => ({
        mode: 'default',
        additionalWorkingDirectories: new Set<string>(),
        alwaysAllowRules: {},
        alwaysDenyRules: {},
        alwaysAskRules: {},
      }),
      setPromptSuggestionEnabled: () => {},
      sendSuccess: () => {},
      sendError: (e: string) => errors.push(e),
      defer: (work: () => void | Promise<void>) => {
        void work()
      },
      errorMessage: (err: unknown) => String(err),
    }
    expect(
      dispatchPrintControlExtra(
        'list_directory',
        { path: '/no/such/dir-289-analog' },
        deps,
      ),
    ).toBe(true)
    for (let i = 0; i < 40 && errors.length === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    expect(errors.some(e => e.startsWith('list denied:'))).toBe(true)
  })

  test('list_directory outside workspace unique English invalid_path', async () => {
    const { listDenied } = await import('../printControlExtras.js')
    const errors: string[] = []
    const successes: unknown[] = []
    const deps = {
      getMcpClients: () => [] as Array<{ name: string; type: string }>,
      getPermissionContext: () => ({
        mode: 'default',
        additionalWorkingDirectories: new Map(),
        alwaysAllowRules: {},
        alwaysDenyRules: {},
        alwaysAskRules: {},
      }),
      setPromptSuggestionEnabled: () => {},
      sendSuccess: (r?: Record<string, unknown>) => successes.push(r ?? {}),
      sendError: (e: string) => errors.push(e),
      defer: (work: () => void | Promise<void>) => {
        void work()
      },
      errorMessage: (err: unknown) => String(err),
    }
    expect(
      dispatchPrintControlExtra('list_directory', { path: '/tmp' }, deps),
    ).toBe(true)
    for (let i = 0; i < 40 && errors.length === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    expect(errors).toContain(listDenied('invalid_path'))
    expect(successes).toEqual([])
  })

  test('set_chrome_browser_hints unique English', async () => {
    const {
      INVALID_SET_CHROME_BROWSER_HINTS_PREFIX,
      parseSetChromeBrowserHintsControlRequest,
    } = await import('../printControlExtras.js')
    expect(
      parseSetChromeBrowserHintsControlRequest({
        subtype: 'set_chrome_browser_hints',
      }).ok,
    ).toBe(false)
    const parsed = parseSetChromeBrowserHintsControlRequest({
      subtype: 'set_chrome_browser_hints',
    })
    if (parsed.ok) throw new Error('expected fail')
    expect(
      parsed.error.startsWith(INVALID_SET_CHROME_BROWSER_HINTS_PREFIX),
    ).toBe(true)
    expect(
      parseSetChromeBrowserHintsControlRequest({
        subtype: 'set_chrome_browser_hints',
        localDeviceIds: ['abc-1'],
        hostPlatform: 'darwin',
      }),
    ).toEqual({
      ok: true,
      localDeviceIds: ['abc-1'],
      hostPlatform: 'darwin',
    })
  })

  test('read_file unique English deny prefix', async () => {
    const { READ_DENIED_PREFIX, READ_FILE_REJECT_COPY } = await import(
      '../printControlExtras.js'
    )
    expect(READ_DENIED_PREFIX).toBe('read denied: ')
    expect(READ_FILE_REJECT_COPY.nt_namespace).toContain('NT-namespace path')
    const errors: string[] = []
    const deps = {
      getMcpClients: () => [] as Array<{ name: string; type: string }>,
      getPermissionContext: () => ({
        mode: 'default',
        additionalWorkingDirectories: new Set<string>(),
        alwaysAllowRules: {},
        alwaysDenyRules: {},
        alwaysAskRules: {},
      }),
      setPromptSuggestionEnabled: () => {},
      sendSuccess: () => {},
      sendError: (e: string) => errors.push(e),
      defer: (work: () => void | Promise<void>) => {
        void work()
      },
      errorMessage: (err: unknown) => String(err),
    }
    expect(
      dispatchPrintControlExtra(
        'read_file',
        { path: '/no/such/file-289' },
        deps,
      ),
    ).toBe(true)
    for (let i = 0; i < 40 && errors.length === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    expect(errors.some(e => e.startsWith('read denied:'))).toBe(true)
  })

  test('print.ts VLe analog falls back to print locals when snapshot is missing', () => {
    const print = readFileSync(join(import.meta.dir, '../print.ts'), 'utf8')
    expect(print).toContain('getLastCacheSafeParams()?.toolUseContext')
    expect(print).toContain('buildAllTools(getAppState())')
    expect(print).toContain(
      'abortController && !abortController.signal.aborted',
    )
    expect(print).toContain('createAbortController()')
  })

  test('ultrareview_launch unique English and fallback ctx launches', async () => {
    const { ULTRAREVIEW_LAUNCH_FAILED, ULTRAREVIEW_UNAVAILABLE } = await import(
      '../printControlExtras.js'
    )
    expect(ULTRAREVIEW_UNAVAILABLE).toBe(
      'Ultrareview is currently unavailable.',
    )
    expect(ULTRAREVIEW_LAUNCH_FAILED).toBe(
      'Failed to launch cloud review session.',
    )

    const { mock } = await import('bun:test')
    const launchRemoteReview = mock(
      async (
        _args: string,
        ctx: { getAppState?: unknown; abortController?: unknown },
      ) => {
        if (!ctx || typeof ctx !== 'object' || !('getAppState' in ctx)) {
          return null
        }
        return [{ type: 'text', text: 'cloud review launched' }]
      },
    )
    const checkOverageGate = mock(async () => ({
      kind: 'proceed' as const,
      billingNote: 'note',
    }))
    mock.module('../../commands/review/ultrareviewEnabled.ts', () => ({
      isUltrareviewEnabled: () => true,
    }))
    mock.module('../../commands/review/reviewRemote.ts', () => ({
      checkOverageGate,
      launchRemoteReview,
    }))
    mock.module('src/commands/review/ultrareviewEnabled.js', () => ({
      isUltrareviewEnabled: () => true,
    }))
    mock.module('src/commands/review/reviewRemote.js', () => ({
      checkOverageGate,
      launchRemoteReview,
    }))

    const successes: unknown[] = []
    const errors: string[] = []
    const fallbackCtx = {
      getAppState: () => ({}),
      setAppState: () => {},
      abortController: new AbortController(),
      options: { tools: [] },
    }
    const deps = {
      getMcpClients: () => [] as Array<{ name: string; type: string }>,
      getPermissionContext: () => null,
      setPromptSuggestionEnabled: () => {},
      sendSuccess: (r?: Record<string, unknown>) => successes.push(r ?? {}),
      sendError: (e: string) => errors.push(e),
      defer: (work: () => void | Promise<void>) => {
        void work()
      },
      errorMessage: (err: unknown) => String(err),
      getToolUseContext: () => fallbackCtx,
    }
    expect(dispatchPrintControlExtra('ultrareview_launch', {}, deps)).toBe(true)
    for (let i = 0; i < 40 && successes.length === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    expect(errors).toEqual([])
    expect(launchRemoteReview).toHaveBeenCalled()
    expect(successes).toEqual([
      {
        status: 'launched',
        message: 'cloud review launched',
        billingNote: 'note',
      },
    ])

    successes.length = 0
    const missing = {
      ...deps,
      getToolUseContext: undefined,
    }
    expect(dispatchPrintControlExtra('ultrareview_launch', {}, missing)).toBe(
      true,
    )
    for (let i = 0; i < 40 && successes.length === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    expect(successes).toEqual([
      { status: 'error', message: ULTRAREVIEW_LAUNCH_FAILED },
    ])
  })

  test('list_directory linux analog unique English classes and Darwin readdir', async () => {
    const extras = readFileSync(
      join(import.meta.dir, '../printControlExtras.ts'),
      'utf8',
    )
    expect(extras).toContain("process.platform === 'linux'")
    expect(extras).toContain('O_DIRECTORY')
    expect(extras).toContain('O_NOFOLLOW')
    expect(extras).toContain("listDenied('path_not_canonical')")
    expect(extras).toContain("listDenied('workspace_moved')")
    expect(extras).toContain('/proc/self/fd')
    expect(extras).toContain('process.env.CLAUDE_CODE_REMOTE')
    expect(extras).toContain("'tengu_gentle_hummingbird'")
    expect(extras).toContain("process.platform === 'linux' &&")

    const { listDenied } = await import('../printControlExtras.js')
    expect(listDenied('path_not_canonical')).toBe(
      'list denied: path_not_canonical',
    )
    expect(listDenied('workspace_moved')).toBe('list denied: workspace_moved')
    expect(listDenied('symlink_in_path')).toBe('list denied: symlink_in_path')
    // Darwin stays on the readdir path (no linux O_DIRECTORY branch).
    expect(process.platform === 'linux' || extras.includes('readdir')).toBe(
      true,
    )
  })
})
