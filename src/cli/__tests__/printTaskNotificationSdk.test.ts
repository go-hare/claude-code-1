/**
 * Official lf-only SDK task_notification bookend residual.
 * print.ts must NOT re-parse task-notification XML into SDK events
 * (double-bookend vs emitTaskTerminatedSdk / drainSdkEvents).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('print.ts task-notification SDK residual (official lf-only)', () => {
  test('does not enqueue task_notification from XML parse', () => {
    const src = readFileSync(
      join(import.meta.dir, '../print.ts'),
      'utf8',
    )
    // Must document lf-only path
    expect(src).toContain('emitTaskTerminatedSdk')
    expect(src).toContain('drainSdkEvents')
    // Must not re-parse XML tags into SDK enqueue in the command loop
    expect(src).not.toMatch(
      /task-notification[\s\S]{0,800}subtype:\s*['"]task_notification['"]/,
    )
    expect(src).not.toContain("notificationText.match(")
    expect(src).not.toContain('/<task-id>([^<]+)<\\/task-id>/')
  })
})
