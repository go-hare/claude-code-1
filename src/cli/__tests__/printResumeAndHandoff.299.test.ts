import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  dispatchPrintControlExtra,
  RECOVERED_BY_RESTART,
} from '../printControlExtras.js'

describe('2.1.299 #637/#664 print handoff & resume', () => {
  test('#637 historyOrStopped handoff with trailing unreturned recoveredToolUseIds returns RECOVERED_BY_RESTART', () => {
    const errors: string[] = []
    const successes: unknown[] = []
    const handled = dispatchPrintControlExtra(
      'turn_handoff',
      {
        tool_use_ids: [],
        messages: [
          {
            type: 'user',
            uuid: 'u-1',
            message: { role: 'user', content: 'hi' },
          },
          {
            type: 'assistant',
            uuid: 'a-1',
            message: {
              role: 'assistant',
              id: 'msg-1',
              content: [
                {
                  type: 'tool_use',
                  id: 'toolu_rec_1',
                  name: 'Bash',
                  input: { command: 'echo 1' },
                },
              ],
            },
          },
        ],
      } as never,
      {
        turnHandoffAdmission: { admitted: true },
        getMessages: () => [
          {
            type: 'user',
            uuid: 'u-1',
            message: { role: 'user', content: 'hi' },
          } as never,
        ],
        getTools: () => [{ name: 'Bash' }] as never,
        recoveredToolUseIds: () => new Set(['toolu_rec_1']),
        sendError: (msg: string) => errors.push(msg),
        sendSuccess: (payload: unknown) => successes.push(payload),
      } as never,
    )
    expect(handled).toBe(true)
    expect(successes).toEqual([])
    expect(errors).toEqual([RECOVERED_BY_RESTART])
  })

  test('#664 CLAUDE_CODE_RESUME_INTERRUPTED_TURN preserves skipSlashCommands for client_composed messages', () => {
    const printSrc = readFileSync(
      join(import.meta.dir, '..', 'print.ts'),
      'utf8',
    )
    expect(printSrc).toContain('interruptedMsg.client_composed === true')
    expect(printSrc).toContain('queueSkipSlashCommands === true')
    expect(printSrc).toContain('{ skipSlashCommands: true }')
  })
})
