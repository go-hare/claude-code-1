import { afterEach, describe, expect, test } from 'bun:test'
import type { UUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildRemoteControlOffNote,
  clearListAgentsCursorCacheForTests,
  LIST_AGENTS_EXHAUSTED_CURSOR_MESSAGE,
  LIST_AGENTS_INVALID_CURSOR_MESSAGE,
  paginatePeerListingRows,
} from '../../../packages/builtin-tools/src/tools/ListPeersTool/ListPeersTool.js'
import { getListAgentsPrompt } from '../../../packages/builtin-tools/src/tools/ListPeersTool/prompt.js'
import { formatTokenOnlySessionName } from '../../../packages/builtin-tools/src/tools/ListPeersTool/teammatesListing.js'
import {
  buildPeerCandidates,
  resolvePeerByName,
} from '../../../packages/builtin-tools/src/tools/SendMessageTool/nameResolve.js'
import {
  CLOUD_SESSION_REPLY_GUIDANCE,
  getPrompt as getSendMessagePrompt,
} from '../../../packages/builtin-tools/src/tools/SendMessageTool/prompt.js'
import {
  appendBypassCloudHoldDisplayNote,
  appendBypassCloudHoldWarning,
} from '../../../packages/builtin-tools/src/tools/SendMessageTool/SendMessageTool.js'
import { formatInterClaudeSendFailure } from '../../bridge/peerSessions.js'
import {
  bridgeBrokenParentChain,
  buildConversationChain,
  CheckpointReachTracker,
  createMissingEarlierMessagesWarning,
  hasMissingEarlierMessages,
  loadTranscriptFile,
  MISSING_EARLIER_MESSAGES_WARNING,
  relinkDroppedTranscriptRows,
  resolveTerminalConversationalAncestors,
  saveExplicitClearCheckpoint,
  slimToolUseResultForResume,
  spliceRowsAheadOfPutBack,
  ToolUseNameWindow,
} from '../sessionStorage.js'
import { readMailbox, writeToMailbox } from '../teammateMailbox.js'

const tempDirs: string[] = []
let prevConfigDir: string | undefined

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function makeUuid(n: number): UUID {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` as UUID
}

afterEach(async () => {
  clearListAgentsCursorCacheForTests()
  if (prevConfigDir !== undefined) {
    process.env.CLAUDE_CONFIG_DIR = prevConfigDir
    prevConfigDir = undefined
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

describe('Wave 327-328 SessionStorage / Transcript / Resume', () => {
  test('#370: detects missing earlier messages and creates non-persisted warning', () => {
    const u1 = makeUuid(1)
    const uMissing = makeUuid(999)
    const m1 = {
      type: 'user',
      uuid: u1,
      parentUuid: uMissing,
      timestamp: '2026-01-01T00:00:01.000Z',
      sessionId: makeUuid(100),
      message: { role: 'user', content: 'hi' },
    }
    const map = new Map<UUID, never>([[u1, m1 as never]])
    expect(hasMissingEarlierMessages([m1 as never], map, false)).toBe(true)
    expect(hasMissingEarlierMessages([], map, true)).toBe(true)

    const warn = createMissingEarlierMessagesWarning()
    expect(warn.persist).toBe(false)
    expect(warn.content).toBe(MISSING_EARLIER_MESSAGES_WARNING)
  })

  test('#390: duplicate UUID resent with null parentUuid preserves existing parent chain link', async () => {
    const dir = makeTempDir('wave328-dup-uuid-')
    const file = join(dir, `${makeUuid(10)}.jsonl`)
    const u1 = makeUuid(1)
    const u2 = makeUuid(2)
    const sid = makeUuid(10)
    const lines = [
      JSON.stringify({
        type: 'user',
        uuid: u1,
        parentUuid: null,
        sessionId: sid,
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'user', content: 'first' },
      }),
      JSON.stringify({
        type: 'user',
        uuid: u2,
        parentUuid: u1,
        sessionId: sid,
        timestamp: '2026-01-01T00:00:02.000Z',
        message: { role: 'user', content: 'second' },
      }),
      // Resent after process kill with same UUID but null parentUuid
      JSON.stringify({
        type: 'user',
        uuid: u2,
        parentUuid: null,
        sessionId: sid,
        timestamp: '2026-01-01T00:00:03.000Z',
        message: { role: 'user', content: 'second' },
      }),
    ]
    writeFileSync(file, `${lines.join('\n')}\n`, 'utf8')
    const loaded = await loadTranscriptFile(file)
    expect(loaded.messages.get(u2)?.parentUuid).toBe(u1)
  })

  test('#391/#392/#586: relinkDroppedTranscriptRows + CheckpointReachTracker rewind then /clear stays cleared', async () => {
    const u1 = makeUuid(1)
    const uDropped = makeUuid(2)
    const u3 = makeUuid(3)
    const messages = new Map<UUID, never>([
      [
        u1,
        {
          type: 'user',
          uuid: u1,
          parentUuid: null,
          timestamp: '2026-01-01T00:00:01.000Z',
          message: { role: 'user', content: 'a' },
        } as never,
      ],
      [
        u3,
        {
          type: 'assistant',
          uuid: u3,
          parentUuid: uDropped,
          timestamp: '2026-01-01T00:00:03.000Z',
          message: { role: 'assistant', content: [] },
        } as never,
      ],
    ])
    const dropped = new Map<UUID, UUID | null>([[uDropped, u1]])
    expect(relinkDroppedTranscriptRows(messages, dropped)).toBe(1)
    expect(
      (messages.get(u3) as unknown as { parentUuid: UUID | null }).parentUuid,
    ).toBe(u1)

    // Rewind followed by explicit /clear
    const tracker = new CheckpointReachTracker()
    tracker.onLastPrompt({
      leafUuid: u1,
      explicit: true,
      rewound: true,
      cutUuid: u3,
    })
    expect(tracker.lastPromptWasRewound).toBe(true)
    expect(tracker.rewindCutUuid).toBe(u3)

    tracker.onLastPrompt({
      leafUuid: null,
      explicit: true,
      rewound: false,
    })
    expect(tracker.cleared).toBe(true)
    expect(tracker.rewoundClear).toBe(false)
    expect(tracker.rewindCutUuid).toBeUndefined()
    expect(tracker.postRewindRows).toBeUndefined()

    // Verify saveExplicitClearCheckpoint produces cleared transcript on load
    const dir = makeTempDir('wave328-clear-cp-')
    const sid = makeUuid(20)
    const file = join(dir, `${sid}.jsonl`)
    writeFileSync(
      file,
      `${JSON.stringify({
        type: 'user',
        uuid: u1,
        parentUuid: null,
        sessionId: sid,
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'user', content: 'before clear' },
      })}\n`,
      'utf8',
    )
    await saveExplicitClearCheckpoint(sid, file)
    const loaded = await loadTranscriptFile(file)
    expect(loaded.leafUuids.size).toBe(0)
  })

  test('#391 progressBridge + droppedParentMap: dropped row after legacy progress entry preserves parent chain', async () => {
    const dir = makeTempDir('wave328-progress-dropped-')
    const sid = makeUuid(30)
    const file = join(dir, `${sid}.jsonl`)
    const u1 = makeUuid(31)
    const uProg = makeUuid(32)
    const uDropped = makeUuid(33)
    const u4 = makeUuid(34)

    const lines = [
      JSON.stringify({
        type: 'user',
        uuid: u1,
        parentUuid: null,
        sessionId: sid,
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'user', content: 'start' },
      }),
      JSON.stringify({
        type: 'progress',
        uuid: uProg,
        parentUuid: u1,
        sessionId: sid,
        timestamp: '2026-01-01T00:00:02.000Z',
        data: { type: 'bash_progress' },
      }),
      // Empty assistant string content -> dropped by repairTranscriptMessageContent
      JSON.stringify({
        type: 'assistant',
        uuid: uDropped,
        parentUuid: uProg,
        sessionId: sid,
        timestamp: '2026-01-01T00:00:03.000Z',
        message: { role: 'assistant', content: '' },
      }),
      JSON.stringify({
        type: 'user',
        uuid: u4,
        parentUuid: uDropped,
        sessionId: sid,
        timestamp: '2026-01-01T00:00:04.000Z',
        message: { role: 'user', content: 'follow-up' },
      }),
    ]
    writeFileSync(file, `${lines.join('\n')}\n`, 'utf8')
    const loaded = await loadTranscriptFile(file)
    expect(loaded.messages.has(u1)).toBe(true)
    expect(loaded.messages.has(uDropped)).toBe(false)
    expect(loaded.messages.get(u4)?.parentUuid).toBe(u1)
  })

  test('#562: spliceRowsAheadOfPutBack and compact_boundary anchor preserve late-saved messages', () => {
    const uBoundary = makeUuid(10)
    const uLate = makeUuid(11)
    const uMissing = makeUuid(99)
    const messages = new Map<UUID, never>([
      [
        uBoundary,
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: uBoundary,
          parentUuid: null,
          timestamp: '2026-01-01T00:00:01.000Z',
        } as never,
      ],
      [
        uLate,
        {
          type: 'user',
          uuid: uLate,
          parentUuid: uMissing,
          timestamp: '2026-01-01T00:00:05.000Z',
          message: { role: 'user', content: 'after compact' },
        } as never,
      ],
    ])
    const bridged = bridgeBrokenParentChain(messages, uLate)
    expect(bridged).toBe(1)
    expect(
      (messages.get(uLate) as unknown as { parentUuid: UUID | null })
        .parentUuid,
    ).toBe(uBoundary)

    const uAhead = makeUuid(12)
    messages.set(uAhead, {
      type: 'assistant',
      uuid: uAhead,
      parentUuid: uMissing,
      timestamp: '2026-01-01T00:00:06.000Z',
      message: { role: 'assistant', content: [] },
    } as never)
    expect(spliceRowsAheadOfPutBack(messages, [uAhead], uLate)).toBe(1)
    expect(
      (messages.get(uAhead) as unknown as { parentUuid: UUID | null })
        .parentUuid,
    ).toBe(uLate)
  })

  test('#587: recoverOrphanedParallelToolResults reattaches tool_result via tool_use_id after retried stream', () => {
    const uUser = makeUuid(1)
    const uAsst = makeUuid(2)
    const uTr = makeUuid(3)
    const uFollow = makeUuid(4)
    const sid = makeUuid(50)
    const messages = new Map<UUID, never>([
      [
        uUser,
        {
          type: 'user',
          uuid: uUser,
          parentUuid: null,
          sessionId: sid,
          timestamp: '2026-01-01T00:00:01.000Z',
          message: { role: 'user', content: 'run tool' },
        } as never,
      ],
      [
        uAsst,
        {
          type: 'assistant',
          uuid: uAsst,
          parentUuid: uUser,
          sessionId: sid,
          timestamp: '2026-01-01T00:00:02.000Z',
          message: {
            id: 'msg_retry_1',
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_retry_1',
                name: 'Bash',
                input: {},
              },
            ],
          },
        } as never,
      ],
      [
        uTr,
        {
          type: 'user',
          uuid: uTr,
          // Disconnected parentUuid from dropped stream attempt, but matching tool_use_id!
          parentUuid: makeUuid(888),
          sessionId: sid,
          timestamp: '2026-01-01T00:00:03.000Z',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_retry_1',
                content: 'ok',
              },
            ],
          },
        } as never,
      ],
      [
        uFollow,
        {
          type: 'assistant',
          uuid: uFollow,
          parentUuid: uAsst,
          sessionId: sid,
          timestamp: '2026-01-01T00:00:04.000Z',
          message: {
            id: 'msg_follow',
            role: 'assistant',
            content: [{ type: 'text', text: 'done' }],
          },
        } as never,
      ],
    ])
    const chain = buildConversationChain(
      messages,
      messages.get(uFollow) as never,
    )
    expect(chain.map(m => m.uuid)).toContain(uTr)
  })

  test('#645: resolveTerminalConversationalAncestors memoizes walks over large chains', () => {
    const messages = new Map<UUID, never>()
    const rootUuid = makeUuid(1)
    messages.set(rootUuid, {
      type: 'assistant',
      uuid: rootUuid,
      parentUuid: null,
      timestamp: '2026-01-01T00:00:01.000Z',
      message: { role: 'assistant', content: [] },
    } as never)

    let prev = rootUuid
    const terminals: never[] = []
    for (let i = 2; i <= 500; i++) {
      const id = makeUuid(i)
      const entry = {
        type: 'system',
        subtype: 'turn_duration',
        uuid: id,
        parentUuid: prev,
        timestamp: '2026-01-01T00:00:02.000Z',
      } as never
      messages.set(id, entry)
      if (i % 10 === 0) terminals.push(entry)
      prev = id
    }

    const res = resolveTerminalConversationalAncestors(terminals, messages)
    expect(res.hasCycle).toBe(false)
    expect([...res.leafUuids]).toEqual([rootUuid])
  })

  test('#646: slimToolUseResultForResume strips duplicated Read image base64 and Bash stdout/stderr', () => {
    const win = new ToolUseNameWindow()
    const asstRead = {
      type: 'assistant',
      uuid: makeUuid(1),
      parentUuid: null,
      timestamp: '2026-01-01T00:00:01.000Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu_img', name: 'Read', input: {} },
          { type: 'tool_use', id: 'tu_bash', name: 'Bash', input: {} },
        ],
      },
    } as never
    slimToolUseResultForResume(asstRead, win)

    const userImg = slimToolUseResultForResume(
      {
        type: 'user',
        uuid: makeUuid(2),
        parentUuid: makeUuid(1),
        timestamp: '2026-01-01T00:00:02.000Z',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_img', content: [] },
          ],
        },
        toolUseResult: {
          type: 'image',
          file: { base64: 'A'.repeat(10_000), type: 'image/png' },
        },
      } as never,
      win,
    ) as unknown as { toolUseResult: { file: { base64: string } } }
    expect(userImg.toolUseResult.file.base64).toBe('')

    const userBash = slimToolUseResultForResume(
      {
        type: 'user',
        uuid: makeUuid(3),
        parentUuid: makeUuid(2),
        timestamp: '2026-01-01T00:00:03.000Z',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_bash', content: 'out' },
          ],
        },
        toolUseResult: { stdout: 'huge output', stderr: 'err' },
      } as never,
      win,
    ) as unknown as { toolUseResult: { stdout: string; stderr: string } }
    expect(userBash.toolUseResult.stdout).toBe('')
    expect(userBash.toolUseResult.stderr).toBe('')
  })
})

describe('Wave 327-328 Peers / SendMessage / ListAgents / TeammateMailbox', () => {
  test('#430: formatInterClaudeSendFailure warns when message may have arrived on timeout', () => {
    const msg = formatInterClaudeSendFailure('cloud-worker', {
      error: 'timeout of 10000ms exceeded',
      mayHaveArrived: true,
      sessionMayHaveEnded: false,
    })
    expect(msg).toContain('was not confirmed')
    expect(msg).toContain('may have arrived')
    expect(msg).toContain('Do not send it again')

    const rateLimit = formatInterClaudeSendFailure('cloud-worker', {
      error: 'HTTP 429',
      mayHaveArrived: false,
      sessionMayHaveEnded: false,
    })
    expect(rateLimit).toBe('Failed to send to cloud-worker: HTTP 429')
  })

  test('#440: paginatePeerListingRows paginates with cursor, rejects invalid cursor, reports exhausted', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      key: `session\x00s-${i}`,
      line: `  worker-${i} [${String(i).padStart(6, '0')}]  ·  ${'x'.repeat(80)}`,
    }))
    const p1 = paginatePeerListingRows(rows, { budgetChars: 400 })
    expect(p1.kind).toBe('page')
    if (p1.kind !== 'page') return
    expect(p1.remaining).toBeGreaterThan(0)
    expect(p1.nextCursor).toBeDefined()
    expect(p1.footer).toContain(`cursor="${p1.nextCursor}"`)

    const p2 = paginatePeerListingRows(rows, {
      cursor: p1.nextCursor,
      budgetChars: 10_000,
    })
    expect(p2.kind).toBe('page')
    if (p2.kind !== 'page') return
    expect(p2.remaining).toBe(0)
    expect(p1.lines.length + p2.lines.length).toBe(20)

    const bad = paginatePeerListingRows(rows, { cursor: 'not-a-valid-cursor' })
    expect(bad).toEqual({
      kind: 'invalid-cursor',
      message: LIST_AGENTS_INVALID_CURSOR_MESSAGE,
    })

    // Passing a cursor covering all rows returns exhausted message
    const allOnePage = paginatePeerListingRows(rows.slice(0, 2), {
      budgetChars: 100,
    })
    if (allOnePage.kind === 'page' && allOnePage.nextCursor) {
      const ex = paginatePeerListingRows(rows.slice(0, 1), {
        cursor: allOnePage.nextCursor,
      })
      expect(ex).toEqual({
        kind: 'exhausted',
        message: LIST_AGENTS_EXHAUSTED_CURSOR_MESSAGE,
      })
    }
  })

  test('#543: bypass-mode cloud send warning appends 5-minute hold/drop explanation', () => {
    const warn = appendBypassCloudHoldWarning('“hi” → cloud-a', 'cloud-a')
    expect(warn).toContain('skips permission prompts')
    expect(warn).toContain('drop it unread after about 5 minutes')
    const display = appendBypassCloudHoldDisplayNote(
      'Sent to cloud-a',
      'cloud-a',
    )
    expect(display).toContain('drop it after about 5 minutes')
  })

  test('#588: untitled and @-titled cloud/RC sessions are addressable via [ref]', () => {
    expect(formatTokenOnlySessionName('')).toBe('untitled')
    expect(formatTokenOnlySessionName('fix @org/pkg bug')).toBe(
      'fix (at)org/pkg bug',
    )

    const candidates = buildPeerCandidates({
      udsPeers: [],
      bridgePeers: [],
      accountBridgePeers: [
        { id: 'session_untitled1', title: null },
        { id: 'session_at1', title: 'review @team/api' },
      ],
    })
    expect(candidates).toHaveLength(2)
    expect(candidates[0]!.name).toBe('untitled')
    expect(candidates[0]!.tokenOnly).toBe(true)
    expect(candidates[1]!.name).toBe('review (at)team/api')
    expect(candidates[1]!.tokenOnly).toBe(true)

    // Bare name must not silently send to token-only session
    const bareRes = resolvePeerByName({
      to: 'untitled',
      pins: {},
      candidates,
      localClaimed: new Set(),
    })
    expect(bareRes.kind).toBe('ambiguous')

    // Explicit `name [ref]` resolves cleanly
    const refRes = resolvePeerByName({
      to: `${candidates[1]!.name} [${candidates[1]!.ref}]`,
      pins: {},
      candidates,
      localClaimed: new Set(),
    })
    expect(refRes.kind).toBe('ok')
    if (refRes.kind === 'ok') {
      expect(refRes.candidate.id).toBe('session_at1')
    }
  })

  test('#589: ListAgents and SendMessage prompts explain conditional cloud reply and branch/PR alternative', () => {
    const listPrompt = getListAgentsPrompt({ canSendMessages: true })
    expect(listPrompt).toContain(
      'can message a computer back only while Remote Control is connected there',
    )
    expect(listPrompt).toContain('push a branch or open a pull request')
    expect(listPrompt).not.toContain('cannot message any session back yet')

    expect(CLOUD_SESSION_REPLY_GUIDANCE).toContain(
      'can message a computer back only while Remote Control is connected there',
    )
    expect(CLOUD_SESSION_REPLY_GUIDANCE).toContain(
      'push a branch or open a pull request',
    )
    expect(getSendMessagePrompt(false)).toContain('# SendMessage')
  })

  test('#656: concurrent in-process writeToMailbox calls serialize without ELOCKED failures', async () => {
    prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    const home = makeTempDir('wave328-mailbox-')
    process.env.CLAUDE_CONFIG_DIR = home
    mkdirSync(join(home, 'teams', 'swarm-a'), { recursive: true })
    writeFileSync(join(home, 'teams', 'swarm-a', 'config.json'), '{}', 'utf8')

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        writeToMailbox(
          'team-lead',
          {
            from: `worker-${i}`,
            text: `hello ${i}`,
            timestamp: new Date(1000 + i).toISOString(),
          },
          'swarm-a',
        ),
      ),
    )
    expect(results.every(id => typeof id === 'string')).toBe(true)
    const inbox = await readMailbox('team-lead', 'swarm-a')
    expect(inbox).toHaveLength(12)
  })

  test('#658: buildRemoteControlOffNote explains why cloud/other-computer sessions are omitted', () => {
    expect(
      buildRemoteControlOffNote({
        isReplBridgeActive: false,
        hasCloudAccess: false,
        isDesktop: false,
      }),
    ).toBe(
      '[Cloud sessions and other computers are not listed because Remote Control is off in this session. The user can turn it on with /remote-control; then list again.]',
    )
    expect(
      buildRemoteControlOffNote({
        isReplBridgeActive: false,
        hasCloudAccess: true,
        isDesktop: true,
      }),
    ).toBe(
      '[Other computers are not listed because Remote Control is off in this session. The user can turn it on with the Remote Control switch in the app; then list again.]',
    )
    expect(
      buildRemoteControlOffNote({
        isReplBridgeActive: true,
      }),
    ).toBeNull()
    // #658 regression: non-1P OAuth (Bedrock/Vertex/API-key) or RC disallowed must hide the note
    expect(
      buildRemoteControlOffNote({
        isReplBridgeActive: false,
        isFirstPartyOAuth: false,
        isRcAllowed: true,
      }),
    ).toBeNull()
    expect(
      buildRemoteControlOffNote({
        isReplBridgeActive: false,
        isFirstPartyOAuth: true,
        isRcAllowed: false,
      }),
    ).toBeNull()

    const listPeersSrc = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/ListPeersTool/ListPeersTool.ts',
      ),
      'utf8',
    )
    expect(listPeersSrc).toContain('isFirstPartyOAuth:')
    expect(listPeersSrc).toContain('isRcAllowed:')

    const sendMessageSrc = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/SendMessageTool/SendMessageTool.ts',
      ),
      'utf8',
    )
    expect(sendMessageSrc).toContain('isFirstPartyOAuth:')
    expect(sendMessageSrc).toContain('isRcAllowed:')
  })

  test('#391/#562/#645 regressions: malformed user/assistant rows captured in droppedParentMap, put-back tool_result splices ahead rows, and FastParentGapIndex uses findPrev', async () => {
    const dir = makeTempDir('wave328-session-reg-')
    const file = join(dir, 'transcript.jsonl')
    const sid = makeUuid(700)
    const u1 = makeUuid(701)
    const uDroppedUser = makeUuid(702)
    const uAfterDrop = makeUuid(703)
    const uAhead = makeUuid(704)
    const uPutBackTr = makeUuid(705)
    // Line 2 is a malformed 'user' row (missing message) that fails isTranscriptMessage
    // but must still be recorded in droppedParentMap so uAfterDrop re-links to u1.
    // Line 4 (uAhead) is an auxiliary attachment persisted ahead of late-saved put-back
    // tool_result (uPutBackTr) which carries explicit rowsAheadOfPutBack -> buildConversationChain
    // splices uAhead into the returned chain without mutating loaded.messages.
    const lines = [
      JSON.stringify({
        type: 'user',
        uuid: u1,
        parentUuid: null,
        sessionId: sid,
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'user', content: 'start' },
      }),
      JSON.stringify({
        type: 'user',
        uuid: uDroppedUser,
        parentUuid: u1,
        sessionId: sid,
        timestamp: '2026-01-01T00:00:02.000Z',
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: uAfterDrop,
        parentUuid: uDroppedUser,
        sessionId: sid,
        timestamp: '2026-01-01T00:00:03.000Z',
        message: {
          id: 'msg_703',
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_pb', name: 'Bash', input: {} },
          ],
        },
      }),
      JSON.stringify({
        type: 'attachment',
        uuid: uAhead,
        parentUuid: uAfterDrop,
        sessionId: sid,
        timestamp: '2026-01-01T00:00:04.000Z',
        attachment: { type: 'diagnostics', content: 'ok' },
      }),
      JSON.stringify({
        type: 'user',
        uuid: uPutBackTr,
        parentUuid: uAfterDrop,
        sessionId: sid,
        timestamp: '2026-01-01T00:00:05.000Z',
        rowsAheadOfPutBack: [uAhead],
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_pb', content: 'ok' },
          ],
        },
      }),
    ]
    writeFileSync(file, lines.join('\n') + '\n', 'utf8')

    const loaded = await loadTranscriptFile(file)
    expect(loaded.messages.get(uAfterDrop)?.parentUuid).toBe(u1)
    // Official Knn does not mutate messages on load; splicing happens in buildConversationChain.
    expect(loaded.messages.get(uAhead)?.parentUuid).toBe(uAfterDrop)
    const chain = buildConversationChain(
      loaded.messages,
      loaded.messages.get(uPutBackTr)!,
    )
    expect(chain.map(m => m.uuid)).toEqual([u1, uAfterDrop, uAhead, uPutBackTr])

    const ssSrc = readFileSync(
      join(import.meta.dir, '../sessionStorage.ts'),
      'utf8',
    )
    expect(ssSrc).toContain('this.findPrev(orphanIdx - 1)')
    expect(ssSrc).not.toContain('void this.findPrev')
  })
})
