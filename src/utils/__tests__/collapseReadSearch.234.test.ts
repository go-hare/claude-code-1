/**
 * densable 2.1.234 #17 — Qoi silent absorb so interleaved TodoWrite/Task*
 * do not split fullscreen "Ran N bash commands" groups; popsOutOnError (edv)
 * ejects absorb on error tool_result.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import { REPL_TOOL_NAME } from '@claude-code/builtin-tools/tools/REPLTool/constants.js'
import { TASK_UPDATE_TOOL_NAME } from '@claude-code/builtin-tools/tools/TaskUpdateTool/constants.js'
import { TODO_WRITE_TOOL_NAME } from '@claude-code/builtin-tools/tools/TodoWriteTool/constants.js'
import type { Tools } from '../../Tool.js'
import type { RenderableMessage } from '../../types/message.js'
import {
  collapseReadSearchGroups,
  getSearchExtraToolsOrReadInfo,
  leftoverJle,
  leftoverTut,
  leftoverXut,
} from '../collapseReadSearch.js'

const ORIG_NO_FLICKER = process.env.CLAUDE_CODE_NO_FLICKER

/** Minimal Bash stub — non-search/read so fullscreen classifies as isBash. */
const bashStubTools = [
  {
    name: BASH_TOOL_NAME,
    isSearchOrReadCommand: () => ({
      isSearch: false,
      isRead: false,
      isList: false,
    }),
  },
] as unknown as Tools

function toolUseMsg(
  id: string,
  name: string,
  input: unknown,
  uuidSuffix: string,
): RenderableMessage {
  return {
    type: 'assistant',
    uuid: `00000000-0000-4000-8000-0000000000${uuidSuffix}`,
    timestamp: new Date().toISOString(),
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id, name, input }],
    },
  } as unknown as RenderableMessage
}

function toolResultMsg(
  toolUseId: string,
  uuidSuffix: string,
  isError = false,
): RenderableMessage {
  return {
    type: 'user',
    uuid: `00000000-0000-4000-8000-0000000001${uuidSuffix}`,
    timestamp: new Date().toISOString(),
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: isError ? 'failed' : 'ok',
          is_error: isError || undefined,
        },
      ],
    },
  } as unknown as RenderableMessage
}

beforeEach(() => {
  process.env.CLAUDE_CODE_NO_FLICKER = '1'
  delete process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN
  delete process.env.TMUX
  delete process.env.SSH_CONNECTION
  delete process.env.SSH_CLIENT
  delete process.env.SSH_TTY
})

afterEach(() => {
  if (ORIG_NO_FLICKER === undefined) delete process.env.CLAUDE_CODE_NO_FLICKER
  else process.env.CLAUDE_CODE_NO_FLICKER = ORIG_NO_FLICKER
})

describe('densable 2.1.234 #17 Qoi absorb / popsOutOnError', () => {
  test('TodoWrite/TaskUpdate classify as absorbed silently with popsOutOnError', () => {
    for (const name of [TODO_WRITE_TOOL_NAME, TASK_UPDATE_TOOL_NAME]) {
      const info = getSearchExtraToolsOrReadInfo(name, {}, [])
      expect(info.isCollapsible).toBe(true)
      expect(info.isAbsorbedSilently).toBe(true)
      expect(info.popsOutOnError).toBe(true)
      expect(info.isBash).toBeUndefined()
    }
  })

  test('Bash + TodoWrite + Bash collapse to one group with bashCount=2', () => {
    const messages = [
      toolUseMsg('b1', BASH_TOOL_NAME, { command: 'echo one' }, '01'),
      toolResultMsg('b1', '01'),
      toolUseMsg(
        't1',
        TODO_WRITE_TOOL_NAME,
        { todos: [{ content: 'x', status: 'pending', activeForm: 'x' }] },
        '02',
      ),
      toolResultMsg('t1', '02'),
      toolUseMsg('b2', BASH_TOOL_NAME, { command: 'echo two' }, '03'),
      toolResultMsg('b2', '03'),
    ]

    const out = collapseReadSearchGroups(messages, bashStubTools)
    const collapsed = out.filter(m => m.type === 'collapsed_read_search')
    expect(collapsed).toHaveLength(1)
    const group = collapsed[0] as {
      type: 'collapsed_read_search'
      bashCount?: number
    }
    expect(group.bashCount).toBe(2)
    // TodoWrite absorb stays inside group messages (verbose) but no own row
    expect(out.filter(m => m.type === 'assistant')).toHaveLength(0)
  })

  test('error TodoWrite popsOutOnError ejects absorb from group', () => {
    const messages = [
      toolUseMsg('b1', BASH_TOOL_NAME, { command: 'echo one' }, '11'),
      toolResultMsg('b1', '11'),
      toolUseMsg(
        't1',
        TODO_WRITE_TOOL_NAME,
        { todos: [{ content: 'x', status: 'pending', activeForm: 'x' }] },
        '12',
      ),
      toolResultMsg('t1', '12', true),
      toolUseMsg('b2', BASH_TOOL_NAME, { command: 'echo two' }, '13'),
      toolResultMsg('b2', '13'),
    ]

    const out = collapseReadSearchGroups(messages, bashStubTools)
    // densable edv: errored TodoWrite ejects; subsequent bash starts new group
    // ? TodoWrite assistant message surfaces outside collapsed groups.
    const assistants = out.filter(m => m.type === 'assistant')
    expect(
      assistants.some(m => {
        const c = (m as { message?: { content?: { name?: string }[] } }).message
          ?.content?.[0]
        return c && (c as { name?: string }).name === TODO_WRITE_TOOL_NAME
      }),
    ).toBe(true)

    const collapsed = out.filter(m => m.type === 'collapsed_read_search') as {
      bashCount?: number
    }[]
    // First bash may flush alone; second bash is its own group — bashCounts sum to 2
    const totalBash = collapsed.reduce((n, g) => n + (g.bashCount ?? 0), 0)
    expect(totalBash).toBe(2)
  })
})

describe('densable 2.1.289 thoughtForMs absorb', () => {
  function thinkingMsg(
    text: string,
    iso: string,
    uuidSuffix: string,
  ): RenderableMessage {
    return {
      type: 'assistant',
      uuid: `00000000-0000-4000-8000-0000000002${uuidSuffix}`,
      timestamp: iso,
      message: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: text }],
      },
    } as unknown as RenderableMessage
  }

  function textMsg(
    text: string,
    iso: string,
    uuidSuffix: string,
  ): RenderableMessage {
    return {
      type: 'assistant',
      uuid: `00000000-0000-4000-8000-0000000003${uuidSuffix}`,
      timestamp: iso,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text }],
      },
    } as unknown as RenderableMessage
  }

  test('thinking then text collapses to thoughtForMs group', () => {
    const t0 = '2026-09-05T01:12:00.000Z'
    const t1 = '2026-09-05T01:12:03.000Z'
    const t2 = '2026-09-05T01:12:04.000Z'
    const user: RenderableMessage = {
      type: 'user',
      uuid: '00000000-0000-4000-8000-000000000200',
      timestamp: t0,
      message: { role: 'user', content: '1+1=?' },
    } as unknown as RenderableMessage
    const out = collapseReadSearchGroups(
      [
        user,
        thinkingMsg('The user set a goal.', t1, '01'),
        textMsg('1 + 1 = 2', t2, '02'),
      ],
      bashStubTools,
    )
    const collapsed = out.filter(
      m => m.type === 'collapsed_read_search',
    ) as Array<{
      thoughtForMs?: number
      latestThinkingSummary?: string
    }>
    expect(collapsed).toHaveLength(1)
    expect(collapsed[0]!.latestThinkingSummary).toBe('The user set a goal.')
    expect(collapsed[0]!.thoughtForMs).toBe(3000)
    expect(out.some(m => m.type === 'assistant')).toBe(true)
  })

  test('thinking-only end flush paints the group then deferred rows (gold l/a)', () => {
    const t1 = '2026-09-05T01:12:03.000Z'
    const t2 = '2026-09-05T01:12:04.000Z'
    const sys: RenderableMessage = {
      type: 'system',
      subtype: 'informational',
      uuid: '00000000-0000-4000-8000-000000000299',
      timestamp: t1,
      content: 'turn settled',
      level: 'info',
    } as unknown as RenderableMessage
    const only = collapseReadSearchGroups(
      [thinkingMsg('The user set a goal.', t1, '21')],
      bashStubTools,
    )
    const onlyGroup = only.filter(
      m => m.type === 'collapsed_read_search',
    ) as Array<{ latestThinkingSummary?: string }>
    expect(onlyGroup).toHaveLength(1)
    expect(onlyGroup[0]!.latestThinkingSummary).toBe('The user set a goal.')
    const live = collapseReadSearchGroups(
      [thinkingMsg('The user set a goal.', t1, '21'), sys],
      bashStubTools,
    )
    expect(live.map(m => m.type)).toEqual(['collapsed_read_search', 'system'])
    const folded = collapseReadSearchGroups(
      [
        thinkingMsg('The user set a goal.', t1, '21'),
        sys,
        textMsg('1 + 1 = 2', t2, '22'),
      ],
      bashStubTools,
    )
    expect(folded.map(m => m.type)).toEqual([
      'collapsed_read_search',
      'system',
      'assistant',
    ])
  })

  test('deferred hook_permission_decision dedupes decision:hookEvent', () => {
    const hook = (id: string): RenderableMessage =>
      ({
        type: 'attachment',
        uuid: `00000000-0000-4000-8000-0000000003${id}`,
        timestamp: '2026-09-05T01:12:04.000Z',
        attachment: {
          type: 'hook_permission_decision',
          decision: 'allow',
          hookEvent: 'PreToolUse',
          toolUseID: id,
        },
      }) as unknown as RenderableMessage
    const denied: RenderableMessage = {
      type: 'attachment',
      uuid: '00000000-0000-4000-8000-000000000399',
      timestamp: '2026-09-05T01:12:04.000Z',
      attachment: {
        type: 'hook_permission_decision',
        decision: 'deny',
        hookEvent: 'PreToolUse',
        toolUseID: 'zz',
      },
    } as unknown as RenderableMessage
    const out = collapseReadSearchGroups(
      [
        thinkingMsg('The user set a goal.', '2026-09-05T01:12:03.000Z', '31'),
        hook('aa'),
        hook('bb'),
        denied,
      ],
      bashStubTools,
    )
    const hooks = out.filter(
      m =>
        m.type === 'attachment' &&
        m.attachment.type === 'hook_permission_decision',
    )
    expect(out[0]?.type).toBe('collapsed_read_search')
    expect(hooks).toHaveLength(2)
  })
})

describe('densable 2.1.289 yMr _Mr / Nhe / ULt', () => {
  function queued(
    origin: { kind: string; senderTaskId?: string },
    isMeta = false,
  ): RenderableMessage {
    return {
      type: 'attachment',
      uuid: '00000000-0000-4000-8000-000000000011',
      timestamp: new Date().toISOString(),
      attachment: {
        type: 'queued_command',
        commandMode: 'prompt',
        prompt: 'next',
        origin,
        isMeta,
      },
    } as unknown as RenderableMessage
  }

  test('Uka peer prompt flushes, then the next bash starts a new group', () => {
    const out = collapseReadSearchGroups(
      [
        toolUseMsg('b1', BASH_TOOL_NAME, { command: 'echo one' }, '10'),
        toolResultMsg('b1', '10'),
        queued({ kind: 'peer', senderTaskId: 'agent-explore-1' }, true),
        toolUseMsg('b2', BASH_TOOL_NAME, { command: 'echo two' }, '12'),
        toolResultMsg('b2', '12'),
      ],
      bashStubTools,
    )
    expect(out.map(m => m.type)).toEqual([
      'collapsed_read_search',
      'attachment',
      'collapsed_read_search',
    ])
  })

  test('meta human stays deferred; observer queued command flushes', () => {
    const split = collapseReadSearchGroups(
      [
        toolUseMsg('b1', BASH_TOOL_NAME, { command: 'echo one' }, '30'),
        toolResultMsg('b1', '30'),
        queued({ kind: 'human' }, true),
        queued({ kind: 'observer' }),
        toolUseMsg('b2', BASH_TOOL_NAME, { command: 'echo two' }, '32'),
        toolResultMsg('b2', '32'),
      ],
      bashStubTools,
    )
    expect(split.map(m => m.type)).toEqual([
      'collapsed_read_search',
      'attachment',
      'attachment',
      'collapsed_read_search',
    ])
    const groups = split.filter(
      m => m.type === 'collapsed_read_search',
    ) as Array<{ bashCount?: number }>
    expect(groups.map(group => group.bashCount)).toEqual([1, 1])
  })

  test('task-notification queued command flushes the open group', () => {
    const note = {
      type: 'attachment',
      uuid: '00000000-0000-4000-8000-000000000013',
      timestamp: new Date().toISOString(),
      attachment: {
        type: 'queued_command',
        commandMode: 'task-notification',
        prompt: 'done',
      },
    } as unknown as RenderableMessage
    const out = collapseReadSearchGroups(
      [
        toolUseMsg('b1', BASH_TOOL_NAME, { command: 'echo one' }, '33'),
        toolResultMsg('b1', '33'),
        note,
        toolUseMsg('b2', BASH_TOOL_NAME, { command: 'echo two' }, '34'),
        toolResultMsg('b2', '34'),
      ],
      bashStubTools,
    )
    expect(out.map(m => m.type)).toEqual([
      'collapsed_read_search',
      'attachment',
      'collapsed_read_search',
    ])
  })
  test('human prompt flushes the open group', () => {
    const split = collapseReadSearchGroups(
      [
        toolUseMsg('b1', BASH_TOOL_NAME, { command: 'echo one' }, '20'),
        toolResultMsg('b1', '20'),
        queued({ kind: 'human' }),
        toolUseMsg('b2', BASH_TOOL_NAME, { command: 'echo two' }, '22'),
        toolResultMsg('b2', '22'),
      ],
      bashStubTools,
    )
    expect(split.map(m => m.type)).toEqual([
      'collapsed_read_search',
      'attachment',
      'collapsed_read_search',
    ])
  })

  test('ULt absorbs REPL even when REPL mode is on, and virtual bash stays in the group', () => {
    const prev = process.env.CLAUDE_CODE_REPL
    process.env.CLAUDE_CODE_REPL = '1'
    try {
      const info = getSearchExtraToolsOrReadInfo(REPL_TOOL_NAME, {}, [])
      expect(info.isCollapsible).toBe(true)
      expect(info.isREPL).toBe(true)
      expect(info.isAbsorbedSilently).toBe(true)
      const virtualBash = {
        ...toolUseMsg('v1', BASH_TOOL_NAME, { command: 'echo virt' }, '51'),
        isVirtual: true,
      } as RenderableMessage
      const virtualThinking = {
        type: 'assistant',
        uuid: '00000000-0000-4000-8000-000000000052',
        timestamp: '2026-09-05T01:12:03.000Z',
        isVirtual: true,
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'keep me' }],
        },
      } as unknown as RenderableMessage
      const out = collapseReadSearchGroups(
        [
          virtualThinking,
          virtualBash,
          toolUseMsg('b1', BASH_TOOL_NAME, { command: 'echo one' }, '53'),
          toolResultMsg('b1', '53'),
        ],
        bashStubTools,
      )
      const groups = out.filter(
        m => m.type === 'collapsed_read_search',
      ) as Array<{
        bashCount?: number
        messages?: Array<{ uuid?: string }>
      }>
      expect(groups).toHaveLength(1)
      expect(groups[0]!.bashCount).toBe(2)
      const ids = (groups[0]!.messages ?? []).map(m => m.uuid)
      expect(ids).toContain('00000000-0000-4000-8000-000000000052')
      expect(ids).toContain('00000000-0000-4000-8000-000000000051')
      expect(out.some(m => m.type === 'assistant')).toBe(false)
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CODE_REPL
      else process.env.CLAUDE_CODE_REPL = prev
    }
  })
  test('K1p sentinel text does not split the group; other text does', () => {
    const sentinel = (text: string, id: string): RenderableMessage =>
      ({
        type: 'assistant',
        uuid: `00000000-0000-4000-8000-0000000000${id}`,
        timestamp: '2026-09-05T01:12:04.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text }] },
      }) as unknown as RenderableMessage
    const around = (mid: RenderableMessage) =>
      collapseReadSearchGroups(
        [
          toolUseMsg('b1', BASH_TOOL_NAME, { command: 'echo one' }, '40'),
          toolResultMsg('b1', '40'),
          mid,
          toolUseMsg('b2', BASH_TOOL_NAME, { command: 'echo two' }, '42'),
          toolResultMsg('b2', '42'),
        ],
        bashStubTools,
      )
    expect(around(sentinel('(no content)', '41')).map(m => m.type)).toEqual([
      'collapsed_read_search',
      'assistant',
    ])
    expect(
      around(sentinel('No response requested.', '43')).map(m => m.type),
    ).toEqual(['collapsed_read_search', 'assistant'])
    expect(around(sentinel('hello', '44')).map(m => m.type)).toEqual([
      'collapsed_read_search',
      'assistant',
      'collapsed_read_search',
    ])
  })
})

describe('densable Io Zc live Thought clock', () => {
  beforeEach(async () => {
    const { leftoverIhrMarkStoreMounted } = await import(
      '../collapseReadSearch.js'
    )
    leftoverIhrMarkStoreMounted(true)
  })
  afterEach(async () => {
    const { leftoverIhrMarkStoreMounted } = await import(
      '../collapseReadSearch.js'
    )
    leftoverIhrMarkStoreMounted(false)
  })
  test('folded is max(1000, baseMs); live adds now-max(started,last) capped at jVn', async () => {
    const { leftoverZcMs, THOUGHT_FOR_MS_CAP } = await import(
      '../collapseReadSearch.js'
    )
    expect(leftoverZcMs(400, 0, 10_000, null)).toBe(1000)
    expect(leftoverZcMs(2500, 0, 10_000, null)).toBe(2500)
    expect(leftoverZcMs(1000, 5000, 8000, 5000)).toBe(4000)
    expect(leftoverZcMs(1000, 8000, 8000, 1000)).toBe(1000)
    expect(leftoverZcMs(0, 0, THOUGHT_FOR_MS_CAP + 50_000, 0)).toBe(
      THOUGHT_FOR_MS_CAP,
    )
  })

  test('hx wraps then ellipsizes past bb lines', async () => {
    const { leftoverHx, leftoverJg } = await import('../collapseReadSearch.js')
    expect(leftoverHx('short', 80, 10)).toBe('short')
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')
    const out = leftoverHx(long, 20, 10)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBeLessThan(long.length)
    expect(leftoverJg('<cc-memory filenames="a">keep</cc-memory> rest')).toBe(
      'keep rest',
    )
    expect(leftoverHx('<cc-memory>keep</cc-memory> rest', 80, 10)).toBe(
      'keep rest',
    )
    expect(leftoverHx('  hello\n\tworld  ', 80, 10)).toBe('  hello\n\tworld  ')
  })

  test('Tr(tn) strips ANSI and control, collapses space', async () => {
    const { leftoverTr } = await import('../collapseReadSearch.js')
    expect(leftoverTr('  hello\n\tworld  ')).toBe('hello world')
    expect(leftoverTr('[31mred[0m')).toBe('red')
  })

  test('Hhr setMode thinking stamps once; other modes clear', async () => {
    const { leftoverHhr, leftoverHhrSetMode } = await import(
      '../collapseReadSearch.js'
    )
    leftoverHhrSetMode('hhr-test', 'thinking')
    const first = leftoverHhr('hhr-test')
    expect(first).toBeGreaterThan(0)
    leftoverHhrSetMode('hhr-test', 'thinking')
    expect(leftoverHhr('hhr-test')).toBe(first)
    leftoverHhrSetMode('hhr-test', 'responding')
    expect(leftoverHhr('hhr-test')).toBeNull()
    leftoverHhrSetMode('hhr-recovery', 'thinking', 'a')
    const stamped = leftoverHhr('hhr-recovery')
    leftoverHhrSetMode('hhr-recovery', 'thinking', 'a')
    expect(leftoverHhr('hhr-recovery')).toBe(stamped)
    await Bun.sleep(2)
    leftoverHhrSetMode('hhr-recovery', 'thinking', 'b')
    expect(leftoverHhr('hhr-recovery')).toBeGreaterThan(stamped ?? 0)
  })

  test('Ihr applyEvent routes agent and main kinds', async () => {
    const { leftoverIhrApplyEvent, leftoverIhrGet, leftoverIhrEvict } =
      await import('../collapseReadSearch.js')
    leftoverIhrEvict('agent-1')
    leftoverIhrEvict('main-1')
    leftoverIhrApplyEvent(
      { kind: 'agent-mode', agentId: 'agent-1', mode: 'thinking' },
      'main-1',
    )
    expect(leftoverIhrGet('agent-1').mode).toBe('thinking')
    expect(leftoverIhrGet('agent-1').thinkingStartedAt).toBeGreaterThan(0)
    leftoverIhrApplyEvent(
      { kind: 'main-message', message: 'Running PreCompact hooks…' },
      'main-1',
    )
    leftoverIhrApplyEvent(
      {
        kind: 'main-colors',
        color: 'claudeBlue_FOR_SYSTEM_SPINNER',
        shimmerColor: 'x',
      },
      'main-1',
    )
    expect(leftoverIhrGet('main-1').overrideMessage).toBe(
      'Running PreCompact hooks…',
    )
    expect(leftoverIhrGet('main-1').overrideColor).toBe(
      'claudeBlue_FOR_SYSTEM_SPINNER',
    )
    leftoverIhrApplyEvent(
      {
        kind: 'agent-retry-status',
        agentId: 'agent-1',
        retryStatus: { kind: 'stalled', deadline: 1 },
      },
      'main-1',
    )
    leftoverIhrApplyEvent(
      {
        kind: 'agent-turn-effort',
        agentId: 'agent-1',
        turnEffort: 'high',
        turnModel: 'claude-opus-4-7',
      },
      'main-1',
    )
    expect(leftoverIhrGet('agent-1').retryStatus).toEqual({
      kind: 'stalled',
      deadline: 1,
    })
    expect(leftoverIhrGet('agent-1').turnEffort).toBe('high')
    leftoverIhrEvict('agent-1')
    expect(leftoverIhrGet('agent-1').mode).toBe('responding')
  })

  test('Phn Xe bus applyEvent; malformed retry; GMn throw; defaultVerb', async () => {
    const {
      leftoverIhrPhn,
      leftoverIhrUxe,
      leftoverIhrGet,
      leftoverHhr,
      leftoverIhrEvict,
      leftoverIhrSanitizeRetry,
      leftoverIhrRequireStore,
      leftoverIhrMarkStoreMounted,
      leftoverIhrBind,
    } = await import('../collapseReadSearch.js')
    leftoverIhrEvict('agent-phn')
    leftoverIhrPhn('agent-phn').setMode('thinking')
    await Bun.sleep(0)
    expect(leftoverIhrGet('agent-phn').mode).toBe('thinking')
    leftoverIhrUxe.setSpinnerMessage('Running PreCompact hooks…')
    await Bun.sleep(0)
    leftoverIhrSanitizeRetry({ kind: 'not-a-kind' })
    leftoverIhrBind('malformed-retry').setRetryStatus({ kind: 'not-a-kind' })
    expect(leftoverIhrGet('malformed-retry').retryStatus).toBeNull()
    leftoverIhrMarkStoreMounted(false)
    expect(() => leftoverIhrRequireStore()).toThrow(/SpinnerStoreContext/)
    expect(() => leftoverIhrGet('unmounted')).toThrow(/SpinnerStoreContext/)
    expect(() => leftoverHhr('unmounted')).toThrow(/SpinnerStoreContext/)
    leftoverIhrMarkStoreMounted(true)
    leftoverIhrRequireStore()
    leftoverIhrBind('verb-1').setMode('thinking')
    expect(typeof leftoverIhrGet('verb-1').defaultVerb).toBe('string')
    leftoverIhrEvict('never-materialized')
    expect(typeof leftoverIhrGet('never-materialized').defaultVerb).toBe(
      'string',
    )
    leftoverIhrBind('has-1').setMode('thinking')
    const { leftoverIhrHas } = await import('../collapseReadSearch.js')
    expect(leftoverIhrHas('has-1')).toBe(true)
    leftoverIhrEvict('has-1')
    expect(leftoverIhrHas('has-1')).toBe(false)
    leftoverIhrMarkStoreMounted(false)
  })

  test('Ltn silent_turn_reminder is D2(Be(model), model, env)', async () => {
    const {
      leftoverSilentTurnReminder,
      leftoverSilentTurnReminderAttachments,
      leftoverSilentTurnReminderText,
      leftoverD2SetClientData,
      leftoverBe,
    } = await import('../collapseReadSearch.js')
    leftoverD2SetClientData({ silent_turn_reminder: true })
    expect(leftoverSilentTurnReminder('unknown-model')).toBe(true)
    leftoverD2SetClientData({ silent_turn_reminder: false })
    expect(leftoverSilentTurnReminder('unknown-model')).toBe(false)
    leftoverD2SetClientData(null)
    const prev = process.env.CLAUDE_CODE_SILENT_TURN_REMINDER
    process.env.CLAUDE_CODE_SILENT_TURN_REMINDER = '1'
    expect(leftoverSilentTurnReminder('unknown-model')).toBe(true)
    process.env.CLAUDE_CODE_SILENT_TURN_REMINDER = '0'
    expect(leftoverSilentTurnReminder('unknown-model')).toBe(false)
    if (prev === undefined) delete process.env.CLAUDE_CODE_SILENT_TURN_REMINDER
    else process.env.CLAUDE_CODE_SILENT_TURN_REMINDER = prev
    expect(leftoverSilentTurnReminderText()).toContain("hasn't heard from you")
    expect(leftoverSilentTurnReminderAttachments([])).toEqual([])
    const silent = Array.from({ length: 6 }, (_, i) => ({
      type: 'assistant',
      message: {
        id: `a${i}`,
        content: [{ type: 'thinking', thinking: `t${i}` }],
      },
    }))
    expect(leftoverSilentTurnReminderAttachments(silent).length).toBe(1)
    expect(leftoverBe('unknown-model')).toBeTruthy()
  })

  test('Ihr applyCompactProgress hooks_start compact_start compact_end', async () => {
    const {
      leftoverIhrApplyCompactProgress,
      leftoverIhrGet,
      leftoverIhrEvict,
      leftoverIhrSubscribe,
    } = await import('../collapseReadSearch.js')
    leftoverIhrEvict('compact-1')
    let ticks = 0
    const unsub = leftoverIhrSubscribe(() => {
      ticks += 1
    })
    leftoverIhrApplyCompactProgress('compact-1', {
      type: 'hooks_start',
      hookType: 'pre_compact',
    })
    expect(leftoverIhrGet('compact-1').overrideMessage).toBe(
      'Running PreCompact hooks…',
    )
    leftoverIhrApplyCompactProgress('compact-1', {
      type: 'compact_start',
      hintText: 'summarizing',
    })
    expect(leftoverIhrGet('compact-1').overrideMessage).toBe(
      'Compacting conversation',
    )
    expect(leftoverIhrGet('compact-1').isCompacting).toBe(true)
    leftoverIhrApplyCompactProgress('compact-1', { type: 'compact_end' })
    expect(leftoverIhrGet('compact-1').overrideMessage).toBeNull()
    expect(leftoverIhrGet('compact-1').isCompacting).toBe(false)
    expect(ticks).toBeGreaterThan(0)
    unsub()
  })

  test('Qrr slots window seed override and read gate', async () => {
    const {
      leftoverQrr,
      leftoverQrrSetSlots,
      leftoverQrrSetWindowSeed,
      leftoverQrrSetReadGate,
      leftoverQrrSetCacheKey,
      leftoverQrrSetOverride,
      leftoverD2SetClientData,
    } = await import('../collapseReadSearch.js')
    leftoverD2SetClientData({ quizzical_shore: true })
    leftoverQrrSetCacheKey(() => 'slot-a')
    leftoverQrrSetSlots({
      'slot-a': { data: { quizzical_shore: false }, model: 'm' },
    })
    expect(leftoverQrr('m')?.data?.quizzical_shore).toBe(false)
    leftoverQrrSetSlots(null)
    leftoverQrrSetWindowSeed({
      key: 'slot-a',
      data: { quizzical_shore: true },
    })
    expect(leftoverQrr('m')?.data?.quizzical_shore).toBe(true)
    leftoverQrrSetOverride(data => ({
      ...(data ?? {}),
      quizzical_shore: false,
    }))
    expect(leftoverQrr('m')?.data?.quizzical_shore).toBe(false)
    leftoverQrrSetReadGate(() => false)
    expect(leftoverQrr('m')).toBeNull()
    leftoverQrrSetReadGate(null)
    leftoverQrrSetOverride(null)
    leftoverQrrSetWindowSeed(null)
    leftoverQrrSetCacheKey(null)
    leftoverQrrSetSlots(null)
    leftoverD2SetClientData(null)
  })

  test('wYr seed window and EYr read gate install', async () => {
    const {
      leftoverQrr,
      leftoverQrrSeedWindow,
      leftoverQrrSetCacheKey,
      leftoverQrrSetReadGate,
      leftoverQrrInstallReadGate,
      leftoverQrrSetSlots,
      leftoverQrrSetWindowSeed,
    } = await import('../collapseReadSearch.js')
    leftoverQrrSetSlots(null)
    leftoverQrrSetCacheKey(() => 'seed-key')
    leftoverQrrSetReadGate(null)
    leftoverQrrSeedWindow({ quizzical_shore: true })
    leftoverQrrSetReadGate(() => true)
    expect(leftoverQrr('m')?.data?.quizzical_shore).toBe(true)
    leftoverQrrInstallReadGate()
    leftoverQrrSetReadGate(() => false)
    leftoverQrrInstallReadGate()
    expect(leftoverQrr('m')).toBeNull()
    leftoverQrrSetReadGate(null)
    leftoverQrrSetWindowSeed(null)
    leftoverQrrSetCacheKey(null)
    leftoverQrrSetSlots(null)
  })

  test('Grr cache key is bi1- sha256 prefix', async () => {
    const { leftoverGrr, leftoverQrrInstallCacheKey, leftoverQrrSetCacheKey } =
      await import('../collapseReadSearch.js')
    leftoverQrrSetCacheKey(null)
    leftoverQrrInstallCacheKey()
    const a = leftoverGrr({
      entrypoint: null,
      model: 'm',
      ccVersion: '1',
      organizationUuid: 'o',
    })
    expect(a.startsWith('bi1-')).toBe(true)
    expect(a.length).toBe('bi1-'.length + 16)
    expect(
      leftoverGrr({
        entrypoint: null,
        model: 'm',
        ccVersion: '1',
        organizationUuid: 'o',
      }),
    ).toBe(a)
    leftoverQrrSetCacheKey(null)
  })

  test('Za L$n quizzical_shore is D2(Be(model), model)', async () => {
    const {
      leftoverQuizzicalShore,
      leftoverD2,
      leftoverIhrBind,
      leftoverIhrGet,
    } = await import('../collapseReadSearch.js')
    expect(leftoverQuizzicalShore(undefined)).toBe(false)
    expect(typeof leftoverQuizzicalShore('claude-opus-4-7')).toBe('boolean')
    expect(
      typeof leftoverD2(
        'quizzical_shore',
        'claude-opus-4-7',
        'claude-opus-4-7',
      ),
    ).toBe('boolean')
    const bind = leftoverIhrBind('ihr-full')
    bind.setMessage('Compacting conversation')
    bind.setColors(
      'claudeBlue_FOR_SYSTEM_SPINNER',
      'claudeBlueShimmer_FOR_SYSTEM_SPINNER',
    )
    bind.setRetryStatus({ kind: 'stalled', deadline: 1 })
    bind.setCompacting(true, 'hint')
    const slice = leftoverIhrGet('ihr-full')
    expect(slice.overrideMessage).toBe('Compacting conversation')
    expect(slice.overrideColor).toBe('claudeBlue_FOR_SYSTEM_SPINNER')
    expect(slice.isCompacting).toBe(true)
    expect(slice.compactingHintText).toBe('hint')
    expect(slice.retryStatus).toEqual({ kind: 'stalled', deadline: 1 })
    bind.resetOverrides()
    expect(leftoverIhrGet('ihr-full').overrideMessage).toBeNull()
    expect(leftoverIhrGet('ihr-full').isCompacting).toBe(false)
    const { leftoverD2SetClientData, leftoverBe } = await import(
      '../collapseReadSearch.js'
    )
    leftoverD2SetClientData({ quizzical_shore: true })
    expect(
      leftoverD2(
        'quizzical_shore',
        leftoverBe('unknown-model'),
        'unknown-model',
      ),
    ).toBe(true)
    leftoverD2SetClientData({ quizzical_shore: false })
    expect(
      leftoverD2(
        'quizzical_shore',
        leftoverBe('unknown-model'),
        'unknown-model',
      ),
    ).toBe(false)
    leftoverD2SetClientData(null)
    const prev = process.env.CLAUDE_CODE_MODEL_CAPABILITIES
    process.env.CLAUDE_CODE_MODEL_CAPABILITIES = 'unknown-model=quizzical_shore'
    expect(
      leftoverD2('quizzical_shore', 'unknown-model', 'unknown-model'),
    ).toBe(true)
    process.env.CLAUDE_CODE_MODEL_CAPABILITIES =
      'unknown-model=-quizzical_shore'
    expect(
      leftoverD2('quizzical_shore', 'unknown-model', 'unknown-model'),
    ).toBe(false)
    if (prev === undefined) delete process.env.CLAUDE_CODE_MODEL_CAPABILITIES
    else process.env.CLAUDE_CODE_MODEL_CAPABILITIES = prev
  })

  test('last thinking stamp walks assistant thinking from the end', async () => {
    const { leftoverLastThinkingAtMs } = await import(
      '../collapseReadSearch.js'
    )
    expect(leftoverLastThinkingAtMs([])).toBe(0)
    expect(
      leftoverLastThinkingAtMs([
        {
          type: 'assistant',
          timestamp: '2020-01-01T00:00:05.000Z',
          message: { content: [{ type: 'thinking', thinking: 'a' }] },
        },
        {
          type: 'assistant',
          timestamp: '2020-01-01T00:00:09.000Z',
          message: { content: [{ type: 'text', text: 'hi' }] },
        },
      ]),
    ).toBe(Date.parse('2020-01-01T00:00:05.000Z'))
  })

  test('Spn blank thinking is DVe skippable — no Thought-for group', () => {
    const empty = {
      type: 'assistant',
      uuid: '00000000-0000-4000-8000-0000000000aa',
      timestamp: '2020-01-01T00:00:01.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: '' }],
      },
    } as unknown as RenderableMessage
    const blank = {
      type: 'assistant',
      uuid: '00000000-0000-4000-8000-0000000000ab',
      timestamp: '2020-01-01T00:00:06.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: '   \n\t  ' }],
      },
    } as unknown as RenderableMessage
    const out = collapseReadSearchGroups(
      [
        empty,
        blank,
        toolUseMsg('b1', BASH_TOOL_NAME, { command: 'echo one' }, '10'),
        toolResultMsg('b1', '10'),
      ],
      bashStubTools,
    )
    const collapsed = out.find(m => m.type === 'collapsed_read_search') as
      | { thoughtForMs?: number; latestThinkingSummary?: string }
      | undefined
    expect(collapsed).toBeDefined()
    expect(collapsed?.thoughtForMs ?? 0).toBe(0)
    expect(collapsed?.latestThinkingSummary).toBeUndefined()
  })

  test('Spn non-blank thinking stamps thoughtForMs from prior timestamp', () => {
    const user = {
      type: 'user',
      uuid: '00000000-0000-4000-8000-0000000000ac',
      timestamp: '2020-01-01T00:00:01.000Z',
      message: { role: 'user', content: 'ask' },
    } as unknown as RenderableMessage
    const thinking = {
      type: 'assistant',
      uuid: '00000000-0000-4000-8000-0000000000ad',
      timestamp: '2020-01-01T00:00:07.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'plan the ask' }],
      },
    } as unknown as RenderableMessage
    const text = {
      type: 'assistant',
      uuid: '00000000-0000-4000-8000-0000000000ae',
      timestamp: '2020-01-01T00:00:08.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'here are three options' }],
      },
    } as unknown as RenderableMessage
    const out = collapseReadSearchGroups([user, thinking, text], bashStubTools)
    const collapsed = out.find(m => m.type === 'collapsed_read_search') as
      | { thoughtForMs?: number; latestThinkingSummary?: string }
      | undefined
    expect(collapsed).toBeDefined()
    expect(collapsed?.thoughtForMs).toBe(6000)
    expect(collapsed?.latestThinkingSummary).toBe('plan the ask')
  })

  test('jle/Tut/xut classify protobuf narration signatures', () => {
    const signature = leftoverNarrationSignature()
    const block = {
      type: 'thinking',
      thinking: 'I will ask three options',
      signature,
    }
    expect(leftoverJle(block)).toBe(true)
    expect(leftoverTut(block)).toBe(true)
    expect(
      leftoverXut({
        type: 'assistant',
        message: { content: [block] },
      } as unknown as RenderableMessage),
    ).toBe(true)
    expect(leftoverTut({ type: 'thinking', thinking: 'x' })).toBe(false)
    expect(
      leftoverTut({
        type: 'thinking',
        thinking: '   ',
        signature,
      }),
    ).toBe(false)
  })

  test('xut narration thinking flushes instead of Thought-for absorb', () => {
    const thinking = {
      type: 'assistant',
      uuid: '00000000-0000-4000-8000-0000000000af',
      timestamp: '2020-01-01T00:00:07.000Z',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'I will ask three options',
            signature: leftoverNarrationSignature(),
          },
        ],
      },
    } as unknown as RenderableMessage
    const out = collapseReadSearchGroups(
      [
        thinking,
        toolUseMsg('b1', BASH_TOOL_NAME, { command: 'echo one' }, '10'),
        toolResultMsg('b1', '10'),
      ],
      bashStubTools,
    )
    expect(out.some(m => m.type === 'assistant')).toBe(true)
    const collapsed = out.find(m => m.type === 'collapsed_read_search') as
      | { thoughtForMs?: number; latestThinkingSummary?: string }
      | undefined
    expect(collapsed?.thoughtForMs ?? 0).toBe(0)
    expect(collapsed?.latestThinkingSummary).toBeUndefined()
  })
})

function leftoverPbVarint(n: number): number[] {
  const out: number[] = []
  let v = n
  while (v > 127) {
    out.push((v & 127) | 128)
    v = Math.floor(v / 128)
  }
  out.push(v)
  return out
}

function leftoverPbBytes(field: number, payload: Uint8Array): Uint8Array {
  const tag = (field << 3) | 2
  const head = [...leftoverPbVarint(tag), ...leftoverPbVarint(payload.length)]
  const out = new Uint8Array(head.length + payload.length)
  out.set(head, 0)
  out.set(payload, head.length)
  return out
}

function leftoverNarrationSignature(): string {
  const kind = leftoverPbBytes(8, new TextEncoder().encode('narration'))
  const mid = leftoverPbBytes(1, kind)
  const outer = leftoverPbBytes(2, mid)
  let raw = ''
  for (const b of outer) raw += String.fromCharCode(b)
  return btoa(raw)
}
