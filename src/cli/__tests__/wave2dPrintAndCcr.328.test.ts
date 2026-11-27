import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  CcrFolderRestorer,
  enforceAutoModeNoCheckResultFailure,
  serializePrintWireMessage,
  shouldRescueYieldToPersonPrompt,
} from '../print.js'
import { CCRClient } from '../transports/ccrClient.js'
import { SSETransport } from '../transports/SSETransport.js'
import { RetractedWireUuidTracker } from '../../query/queryHelpers.js'
import type { StdoutMessage } from '../../entrypoints/sdk/controlTypes.js'

describe('Wave 2D print.ts & ccrClient.ts alignment (P1-#44, P2-#13, #1492, #1640, #1645/#1646)', () => {
  test('P1-#44: serializePrintWireMessage attaches retracted_message_uuids and supersedes on next assistant', () => {
    const tracker = new RetractedWireUuidTracker()
    const userRetry: Record<string, unknown> = serializePrintWireMessage<
      Record<string, unknown>
    >(
      {
        type: 'user',
        parent_tool_use_id: null,
        retractedWireUuids: ['asst-bad-1', 'asst-bad-2'],
        message: { role: 'user', content: 'retry' },
      },
      tracker,
    )
    expect(userRetry.retracted_message_uuids).toEqual([
      'asst-bad-1',
      'asst-bad-2',
    ])

    const nextAssistant: Record<string, unknown> = serializePrintWireMessage<
      Record<string, unknown>
    >(
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      },
      tracker,
    )
    expect(nextAssistant.supersedes).toEqual(['asst-bad-1', 'asst-bad-2'])

    const secondAssistant: Record<string, unknown> = serializePrintWireMessage<
      Record<string, unknown>
    >(
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: { role: 'assistant', content: [{ type: 'text', text: '2' }] },
      },
      tracker,
    )
    expect(secondAssistant.supersedes).toBeUndefined()
  })

  test('P2-#13: CCRClient withholds whole-file fields when withholdsWholeFiles is true and serializes retracted_message_uuids', () => {
    const transport = new SSETransport(
      new URL('https://example.com/v1/code/sessions/cse_1/events/stream'),
    )
    const client = new CCRClient(
      transport,
      new URL('https://example.com/v1/code/sessions/cse_1'),
      { withholdsWholeFiles: true },
    )
    const toClientEvent = (
      client as unknown as {
        toClientEvent: (msg: StdoutMessage) => {
          payload: Record<string, unknown>
        }
      }
    ).toClientEvent.bind(client)

    const ev = toClientEvent({
      type: 'user',
      uuid: 'u-1',
      retractedWireUuids: ['a-retracted-1'],
      message: { role: 'user', content: [] },
      tool_use_result: {
        type: 'update',
        content: 'new content',
        originalFile: 'old content',
        structuredPatch: [
          { oldStart: 1, newStart: 1, lines: ['-old', '+new'] },
        ],
        original_file: 'old',
        updated_file: 'new',
      },
    } as unknown as StdoutMessage)

    expect(ev.payload.retracted_message_uuids).toEqual(['a-retracted-1'])
    const tur = ev.payload.tool_use_result as Record<string, unknown>
    expect(tur.originalFile).toBeNull()
    expect(tur.structuredPatch).toEqual([])
    expect(tur.original_file).toBe('')
    expect(tur.updated_file).toBe('')
    transport.close()
  })

  test('P2-#13: shouldFlushHeldBackResultOnAbort is wired into print.ts abort shutdown path', () => {
    const src = [
      readFileSync(
        join(import.meta.dir, '../print/outputFormatting.ts'),
        'utf8',
      ),
      readFileSync(join(import.meta.dir, '../print/turnRunner.ts'), 'utf8'),
    ].join('\n')
    const occurrences = src.match(/shouldFlushHeldBackResultOnAbort\(/g) ?? []
    expect(occurrences.length).toBeGreaterThanOrEqual(2)
  })

  test('#1492: enforceAutoModeNoCheckResultFailure marks result failed on auto_mode_stop_no_verdict', () => {
    const fixed: Record<string, unknown> = enforceAutoModeNoCheckResultFailure<
      Record<string, unknown>
    >({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: '',
      permission_denials: [
        {
          tool_name: 'Bash',
          tool_use_id: 'tu_1',
          decision_reason_code: 'auto_mode_stop_no_verdict',
        },
      ],
    })
    expect(fixed.subtype).toBe('error_during_execution')
    expect(fixed.is_error).toBe(true)
    expect(Array.isArray(fixed.errors)).toBe(true)

    const untouched = enforceAutoModeNoCheckResultFailure({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'done',
      permission_denials: [],
    })
    expect(untouched.subtype).toBe('success')
    expect(untouched.is_error).toBe(false)
  })

  test('#1640: CcrFolderRestorer restores added_directories, prunes missing, and writes on attached()', async () => {
    const writes: Array<Record<string, unknown>> = []
    const addedDirs: string[] = []
    const restorer = new CcrFolderRestorer({
      notifyInternalMetadata: m => writes.push(m),
      isFeatureEnabled: () => true,
    })

    await restorer.restore(
      {
        internal: {
          added_directories: ['/mnt/repo-a/file', '/mnt/gone-b/file'],
        },
      },
      async () => ({
        isAdditionalDirsEnabled: () => true,
        addDirectoryDestFromMountPath: mp => `/staged${mp}`,
        stageFile: async ({ mount_path }) => {
          if (mount_path.includes('gone-b')) {
            return { ok: false, notFound: true, error: 'not found' }
          }
          return { ok: true }
        },
        onDirectoryAdded: dir => {
          addedDirs.push(dir)
        },
      }),
    )

    expect(restorer.hasRestoredAFolder).toBe(true)
    expect(addedDirs).toEqual(['/staged/mnt/repo-a'])
    expect(restorer.getListedMountPaths()).toEqual(['/mnt/repo-a/file'])
    expect(writes.length).toBe(1)
    expect(writes[0]?.added_directories).toEqual(['/mnt/repo-a/file'])

    restorer.attached('/mnt/repo-c/file')
    expect(restorer.getListedMountPaths()).toEqual([
      '/mnt/repo-a/file',
      '/mnt/repo-c/file',
    ])
    expect(writes.length).toBe(2)
  })

  test('#1645/#1646: shouldRescueYieldToPersonPrompt yields API-errored rescue to waiting human prompt', () => {
    const waitingHuman = [{ mode: 'prompt', value: 'new message' }]

    expect(
      shouldRescueYieldToPersonPrompt({
        head: { yieldsToPersonPrompt: 'server_error' },
        queued: waitingHuman,
        promptHeld: false,
        stopLatched: false,
        decidedAt: 'before_start',
        isRemote: true,
      }),
    ).toBe(true)

    // Respects stopLatched
    expect(
      shouldRescueYieldToPersonPrompt({
        head: { yieldsToPersonPrompt: 'rate_limit' },
        queued: waitingHuman,
        promptHeld: false,
        stopLatched: true,
        decidedAt: 'before_start',
        isRemote: true,
      }),
    ).toBe(false)

    // wentPastOpenCalls gated by pastOpenCallsEnabled
    expect(
      shouldRescueYieldToPersonPrompt({
        head: { yieldsToPersonPrompt: 'other', wentPastOpenCalls: true },
        queued: waitingHuman,
        promptHeld: false,
        stopLatched: false,
        decidedAt: 'before_start',
        isRemote: true,
        otherSwitch: 'on',
        pastOpenCallsEnabled: false,
      }),
    ).toBe(false)

    expect(
      shouldRescueYieldToPersonPrompt({
        head: { yieldsToPersonPrompt: 'other', wentPastOpenCalls: true },
        queued: waitingHuman,
        promptHeld: false,
        stopLatched: false,
        decidedAt: 'before_start',
        isRemote: true,
        otherSwitch: 'on',
        pastOpenCallsEnabled: true,
      }),
    ).toBe(true)
  })
})
