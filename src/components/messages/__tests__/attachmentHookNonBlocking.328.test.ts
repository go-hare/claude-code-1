import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('2.1.328 AttachmentMessage hook_non_blocking_error SubagentStop (A-P2-12)', () => {
  test('hook_non_blocking_error only suppresses Stop, not SubagentStop', () => {
    const src = readFileSync(
      join(import.meta.dir, '../AttachmentMessage.tsx'),
      'utf8',
    )
    const blockingStart = src.indexOf("case 'hook_blocking_error':")
    const nonBlockingStart = src.indexOf("case 'hook_non_blocking_error':")
    const cancelledStart = src.indexOf("case 'hook_cancelled':")
    expect(blockingStart).toBeGreaterThan(0)
    expect(nonBlockingStart).toBeGreaterThan(blockingStart)
    expect(cancelledStart).toBeGreaterThan(nonBlockingStart)

    const blockingBlock = src.slice(blockingStart, nonBlockingStart)
    expect(blockingBlock).toContain(
      "if (attachment.hookEvent === 'Stop' || attachment.hookEvent === 'SubagentStop')",
    )

    const nonBlockingBlock = src.slice(nonBlockingStart, cancelledStart)
    expect(nonBlockingBlock).toContain("if (attachment.hookEvent === 'Stop')")
    expect(nonBlockingBlock).not.toContain(
      "attachment.hookEvent === 'SubagentStop'",
    )
  })
})
