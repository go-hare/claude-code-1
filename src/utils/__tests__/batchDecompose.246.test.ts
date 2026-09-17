/**
 * densable 2.1.246 #38 — QOs/qXe/eHr/Qzr full chain.
 *
 * Official gold:
 *   docs/upstream-extraction/v2.1.246/snippets/gold-qos-qxe.txt
 *   docs/upstream-extraction/v2.1.246/snippets/gold-r6-we.txt
 *   docs/upstream-extraction/v2.1.246/snippets/gold-toasty-no-default.txt
 *   docs/upstream-extraction/v2.1.246/snippets/gold-batch-tools-absent.txt
 *
 * HAVE 246. Do not invent default tip, live r6, or Batch* wrappers.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod/v4'
import type { Tool } from '../../Tool.js'
import type { AssistantMessage } from '../../types/message.js'
import {
  createAssistantMessage,
  createUserMessage,
  decomposeBatchedToolUses,
  hideUnderlyingV1Tools,
  normalizeMessagesForAPI,
  reassembleBatchedToolUses,
} from '../messages.js'
import { toInternalMessages, toSDKMessages } from '../messages/mappers.js'

const snippets = join(
  import.meta.dir,
  '../../../docs/upstream-extraction/v2.1.246/snippets',
)
const src = (rel: string) => readFileSync(join(import.meta.dir, rel), 'utf8')

const v1 = { name: 'Read' } as Tool

function batchTool(opts?: {
  entries?: unknown[]
  throwPerEntry?: boolean
  throwReassemble?: boolean
}): Tool {
  return {
    name: 'BatchRead',
    inputSchema: z.object({
      files: z.array(z.object({ path: z.string() })),
    }),
    underlyingV1ToolName: 'Read',
    entryFieldName: 'files',
    perEntryHookInputs: (input: { files: { path: string }[] }) => {
      if (opts?.throwPerEntry) throw new Error('per-entry')
      return { v1Tool: v1, entries: opts?.entries ?? input.files }
    },
    reassemble: (inputs: unknown[]) => {
      if (opts?.throwReassemble) throw new Error('reassemble')
      return { files: inputs }
    },
  } as unknown as Tool
}

const readTool = {
  name: 'Read',
  inputSchema: z.object({ path: z.string() }),
} as unknown as Tool

const parentInput = { files: [{ path: 'a.ts' }, { path: 'b.ts' }] }

describe('#38 QOs/qXe/eHr/Qzr + r6 + no default copy (2.1.246)', () => {
  test('gold-locks official QOs/qXe/eHr/Qzr/lWt/Pwe', () => {
    const gold = readFileSync(join(snippets, 'gold-qos-qxe.txt'), 'utf8')
    expect(gold).toContain('function QOs(e,t,n)')
    expect(gold).toContain('function qXe(e,t,n)')
    expect(gold).toContain('function eHr(e,t,n)')
    expect(gold).toContain('function Qzr(e)')
    expect(gold).toContain('function lWt(e,t)')
    expect(gold).toContain('function Pwe(e)')
    expect(gold).toContain('parse_failed')
    expect(gold).toContain('zero_entries')
    expect(gold).toContain('per_entry_threw')
    expect(gold).toContain('reassemble_threw')
    expect(gold).toContain('batchToolUses')
    expect(gold).toContain('Jzr=/_(\\d+)$/')
    expect(gold).toContain('underlyingV1ToolName')
    expect(gold).toContain('B=eHr(j.message.content, j.batchToolUses, t)')
    expect(gold).toContain('v=Qzr(T)')
    expect(gold).toContain('batch_tool_uses')
    expect(gold).toContain('H5s merge does NOT concat batchToolUses')
  })

  test('local hosts QOs/qXe/eHr/Qzr on official sites', () => {
    const messages = src('../messages.ts')
    const tool = src('../../Tool.ts')
    const claude = src('../../services/api/claude.ts')
    const mappers = src('../messages/mappers.ts')

    expect(messages).toContain('function mergeBatchedToolResults(')
    expect(messages).toContain('function batchEntryParentId(')
    expect(messages).toContain('const BATCH_ENTRY_ID_RE = /_(\\d+)$/')
    expect(messages).toContain('function decomposeBatchedToolUse(')
    expect(messages).toContain('export function decomposeBatchedToolUses<')
    expect(messages).toContain('export function reassembleBatchedToolUses<')
    expect(messages).toContain('export function hideUnderlyingV1Tools(')
    expect(messages).toContain(
      'reassembleBatchedToolUses(\n            rawAssistantContent,\n            message.batchToolUses,\n            tools,',
    )
    expect(tool).toContain('export function isBatchTool(')
    expect(tool).toContain('perEntryHookInputs')
    expect(tool).toContain('underlyingV1ToolName')

    expect(claude).toContain('decomposeBatchedToolUses(')
    expect(claude).toContain('hideUnderlyingV1Tools(filteredTools)')
    expect(claude).toContain('...(Fo.length > 0 && { batchToolUses: Fo })')
    expect(claude).toContain('...(Le.length > 0 && { batchToolUses: Le })')
    expect(claude).toContain('...(Eo.length > 0 && { batchToolUses: Eo })')
    expect(claude.indexOf('decomposeBatchedToolUses(')).toBeLessThan(
      claude.indexOf('...(Fo.length > 0 && { batchToolUses: Fo })'),
    )

    expect(mappers).toContain('batch_tool_uses')
    expect(mappers).toContain('batchToolUses')
  })

  test('gold-locks r6 = we(session-fn tag) — dead, omit', () => {
    const gold = readFileSync(join(snippets, 'gold-r6-we.txt'), 'utf8')
    expect(gold).toContain('ged as r6')
    expect(gold).toContain('we as ged')
    expect(gold).toContain('function we(t)')
    expect(gold).toContain('Ekd as xt')
    expect(gold).toContain('Am as Ekd')
    expect(gold).toContain('function Am(){return n()}')
    expect(gold).toContain('r6(s) is always false')
    expect(gold).toContain(
      'Do not invent r6 = isCompactSummary or command-name',
    )

    const producer = src('../batchingReminder.ts')
    expect(producer).toContain('Official r6')
    expect(producer).toContain('Always false.')
    expect(producer).toContain('Omit (same observable)')
  })

  test('gold-locks no default toasty copy', () => {
    const gold = readFileSync(
      join(snippets, 'gold-toasty-no-default.txt'),
      'utf8',
    )
    expect(gold).toContain('no hardcoded fallback string')
    expect(gold).toContain('Do not invent default tip text')
    expect(gold).toContain('Do not LOCAL_GATE_DEFAULTS')

    const gb = src('../../services/analytics/growthbook.ts')
    expect(gb).not.toContain('tengu_toasty_thimble')

    const producer = src('../batchingReminder.ts')
    expect(producer).toContain(
      'if (raw === undefined || raw === null) return null',
    )
    expect(producer).not.toContain('Batch independent')
  })

  test('gold-locks official 246 has jh pipe, no product Batch* tool', () => {
    const gold = readFileSync(
      join(snippets, 'gold-batch-tools-absent.txt'),
      'utf8',
    )
    expect(gold).toContain('jh @208070729')
    expect(gold).toContain('perEntryHookInputs:     0')
    expect(gold).toContain('entryFieldName:         0')
    expect(gold).toContain('reassemble:             0')
    expect(gold).toContain('BatchRead / BatchEdit / BatchWrite')
    expect(gold).toContain('No product tool sets the four fields')
    expect(gold).toContain('Do not invent wrappers')
    expect(gold).toContain('function OEs(){return[]}')
    expect(gold).toContain('xGo @213777571')
    expect(gold).toContain('Read Edit MultiEdit Write')
    expect(gold).toContain('NOT jh. No Batch* in xGo')
    expect(gold).toContain('.reassemble(         = 1')

    const builtin = join(import.meta.dir, '../../../packages/builtin-tools')
    const tree = src('../../Tool.ts')
    expect(tree).toContain('export function isBatchTool(')
    expect(
      readFileSync(
        join(builtin, 'src/tools/FileReadTool/FileReadTool.ts'),
        'utf8',
      ),
    ).not.toContain('underlyingV1ToolName')
  })

  test('qXe success decomposes to id_0/id_1 with v1 name', () => {
    const { content, batchToolUses } = decomposeBatchedToolUses(
      [
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'BatchRead',
          input: parentInput,
        },
      ],
      [batchTool(), readTool],
    )
    expect(batchToolUses).toEqual([{ id: 'tu_1', name: 'BatchRead' }])
    expect(content as unknown[]).toEqual([
      {
        type: 'tool_use',
        id: 'tu_1_0',
        name: 'Read',
        input: { path: 'a.ts' },
      },
      {
        type: 'tool_use',
        id: 'tu_1_1',
        name: 'Read',
        input: { path: 'b.ts' },
      },
    ])
  })

  test('qXe parse_failed keeps one synthetic id_0 named the batch tool', () => {
    const { content, batchToolUses } = decomposeBatchedToolUses(
      [
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'BatchRead',
          input: { nope: true },
        },
      ],
      [batchTool()],
    )
    expect(batchToolUses).toEqual([])
    expect(content).toEqual([
      {
        type: 'tool_use',
        id: 'tu_1_0',
        name: 'BatchRead',
        input: { nope: true },
      },
    ])
  })

  test('qXe zero_entries keeps one synthetic id_0, no batchToolUses', () => {
    const { content, batchToolUses } = decomposeBatchedToolUses(
      [
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'BatchRead',
          input: { files: [{ path: 'a.ts' }] },
        },
      ],
      [batchTool({ entries: [] })],
    )
    expect(batchToolUses).toEqual([])
    expect(content).toEqual([
      {
        type: 'tool_use',
        id: 'tu_1_0',
        name: 'BatchRead',
        input: { files: [{ path: 'a.ts' }] },
      },
    ])
  })

  test('qXe per_entry_threw keeps one synthetic id_0, no batchToolUses', () => {
    const { content, batchToolUses } = decomposeBatchedToolUses(
      [
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'BatchRead',
          input: parentInput,
        },
      ],
      [batchTool({ throwPerEntry: true })],
    )
    expect(batchToolUses).toEqual([])
    expect(content).toEqual([
      {
        type: 'tool_use',
        id: 'tu_1_0',
        name: 'BatchRead',
        input: parentInput,
      },
    ])
  })

  test('qXe leaves non-batch tool_use unchanged', () => {
    const block = {
      type: 'tool_use' as const,
      id: 'tu_9',
      name: 'Read',
      input: { path: 'x' },
    }
    const content = [block]
    const out = decomposeBatchedToolUses(content, [readTool])
    expect(out.batchToolUses).toEqual([])
    expect(out.content).toBe(content)
  })

  test('eHr reassembles parent via tool.reassemble', () => {
    const synthetics = [
      {
        type: 'tool_use' as const,
        id: 'tu_1_0',
        name: 'Read',
        input: { path: 'a.ts' },
      },
      {
        type: 'tool_use' as const,
        id: 'tu_1_1',
        name: 'Read',
        input: { path: 'b.ts' },
      },
    ]
    const out = reassembleBatchedToolUses(
      synthetics,
      [{ id: 'tu_1', name: 'BatchRead' }],
      [batchTool(), readTool],
    )
    expect(out as unknown[]).toEqual([
      {
        type: 'tool_use',
        id: 'tu_1',
        name: 'BatchRead',
        input: { files: [{ path: 'a.ts' }, { path: 'b.ts' }] },
      },
    ])
  })

  test('eHr empty batchToolUses is identity', () => {
    const content = [
      { type: 'tool_use' as const, id: 'tu_1_0', name: 'Read', input: {} },
    ]
    expect(reassembleBatchedToolUses(content, undefined, [batchTool()])).toBe(
      content,
    )
    expect(reassembleBatchedToolUses(content, [], [batchTool()])).toBe(content)
  })

  test('eHr reassemble_threw keeps synthetics', () => {
    const synthetics = [
      {
        type: 'tool_use' as const,
        id: 'tu_1_0',
        name: 'Read',
        input: { path: 'a.ts' },
      },
    ]
    const out = reassembleBatchedToolUses(
      synthetics,
      [{ id: 'tu_1', name: 'BatchRead' }],
      [batchTool({ throwReassemble: true })],
    )
    expect(out).toEqual(synthetics)
  })

  test('Qzr hides underlying v1 name when a batch wrapper exists', () => {
    const tools = [batchTool(), readTool]
    const hidden = hideUnderlyingV1Tools(tools)
    expect(hidden.map(t => t.name)).toEqual(['BatchRead'])
    const onlyRead = [readTool]
    expect(hideUnderlyingV1Tools(onlyRead)).toBe(onlyRead)
  })

  test('normalize eHr then tHr: wire has parent tool_use + merged result', () => {
    const assistant = createAssistantMessage({
      content: [
        {
          type: 'tool_use',
          id: 'tu_1_0',
          name: 'Read',
          input: { path: 'a.ts' },
        },
        {
          type: 'tool_use',
          id: 'tu_1_1',
          name: 'Read',
          input: { path: 'b.ts' },
        },
      ],
    })
    assistant.batchToolUses = [{ id: 'tu_1', name: 'BatchRead' }]
    const user = createUserMessage({
      content: [
        { type: 'tool_result', tool_use_id: 'tu_1_0', content: 'A' },
        { type: 'tool_result', tool_use_id: 'tu_1_1', content: 'B' },
      ],
    })
    const out = normalizeMessagesForAPI(
      [assistant, user],
      [batchTool(), readTool],
    )
    const asst = out.find((m): m is AssistantMessage => m.type === 'assistant')
    const asstBlocks = asst?.message.content
    expect(Array.isArray(asstBlocks)).toBe(true)
    expect(asstBlocks).toEqual([
      {
        type: 'tool_use',
        id: 'tu_1',
        name: 'BatchRead',
        input: { files: [{ path: 'a.ts' }, { path: 'b.ts' }] },
      },
    ])
    const userMsg = out.find(m => m.type === 'user')
    const userBlocks =
      userMsg && Array.isArray(userMsg.message.content)
        ? userMsg.message.content
        : []
    const results = userBlocks.filter(
      b => typeof b !== 'string' && b.type === 'tool_result',
    ) as { tool_use_id: string; content: unknown }[]
    expect(results).toHaveLength(1)
    expect(results[0]?.tool_use_id).toBe('tu_1')
    expect(String(results[0]?.content)).toContain('--- entry 1 ---')
    expect(String(results[0]?.content)).toContain('--- entry 2 ---')
  })

  test('SDK mapper round-trips batch_tool_uses when non-empty', () => {
    const assistant = createAssistantMessage({
      content: [
        { type: 'tool_use', id: 'tu_1_0', name: 'Read', input: { path: 'a' } },
      ],
    })
    assistant.batchToolUses = [{ id: 'tu_1', name: 'BatchRead' }]
    const sdk = toSDKMessages([assistant])
    const wire = sdk.find(m => m.type === 'assistant') as {
      batch_tool_uses?: { id: string; name: string }[]
    }
    expect(wire.batch_tool_uses).toEqual([{ id: 'tu_1', name: 'BatchRead' }])
    const back = toInternalMessages(sdk)
    expect((back[0] as AssistantMessage).batchToolUses).toEqual([
      { id: 'tu_1', name: 'BatchRead' },
    ])
  })
})
