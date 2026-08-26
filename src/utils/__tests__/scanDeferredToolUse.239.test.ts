import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFERRED_TOOL_TAIL_BYTES,
  scanDeferredToolUseFromTranscriptTail,
} from '../queryHelpers.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function transcript(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-defer-tail-'))
  dirs.push(dir)
  const path = join(dir, 'session.jsonl')
  writeFileSync(path, lines.join('\n') + (lines.length > 0 ? '\n' : ''))
  return path
}

function deferredLine(id: string): string {
  return JSON.stringify({
    type: 'attachment',
    attachment: {
      type: 'hook_deferred_tool',
      toolUseID: id,
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
      hookName: 'defer.sh',
      hookEvent: 'PreToolUse',
      permissionMode: 'default',
    },
  })
}

describe('densable 2.1.239 $2l transcript tail scan', () => {
  test('DEFERRED_TOOL_TAIL_BYTES is official 1048576', () => {
    expect(DEFERRED_TOOL_TAIL_BYTES).toBe(1048576)
  })

  test('returns last unresolved hook_deferred_tool', async () => {
    const path = transcript([
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'hi' },
      }),
      deferredLine('tu_open'),
    ])
    const found = await scanDeferredToolUseFromTranscriptTail(path)
    expect(found?.toolUseID).toBe('tu_open')
    expect(found?.toolName).toBe('Bash')
  })

  test('stale marker after tool_result is null', async () => {
    const path = transcript([
      deferredLine('tu_done'),
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_done', content: 'ok' },
          ],
        },
      }),
    ])
    expect(await scanDeferredToolUseFromTranscriptTail(path)).toBeNull()
  })

  test('missing file is null', async () => {
    expect(
      await scanDeferredToolUseFromTranscriptTail(
        join(tmpdir(), 'cc-defer-missing.jsonl'),
      ),
    ).toBeNull()
  })
})
