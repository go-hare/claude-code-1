import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const src = readFileSync(join(import.meta.dir, '../useTasksV2.ts'), 'utf8')

describe('densable 2.1.289 jMn #k keep-previous', () => {
  test('read throw keeps the snapshot and logs Task list read failed', () => {
    expect(src).toContain('Task list read failed:')
    expect(src).toContain('listed === null')
    expect(src).toContain('if (this.#started) this.#armFallbackPoll()')
    expect(src).toContain('if (changed) this.#tasks = current')
    expect(src).toContain('if (changed) this.#notify()')
  })

  test('does not export minify GCe/jMn', () => {
    expect(src).not.toContain('export function GCe')
    expect(src).not.toContain('export class jMn')
  })
})
