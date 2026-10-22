/**
 * densable 2.1.289 — in-process teammates: panel ↑↓ and Enter share
 * coordinatorTaskIndex. teammateFooterIndex is pill ←/→ only.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PROMPT = join(import.meta.dir, '../PromptInput.tsx')

describe('densable 2.1.289 teammate panel Enter', () => {
  test('tasks Enter reads coordinatorTaskIndex before teammateFooterIndex', () => {
    const src = readFileSync(PROMPT, 'utf8')
    const start = src.indexOf("case 'tasks':")
    expect(start).toBeGreaterThan(0)
    const body = src.slice(start, start + 1800)
    const panel = body.indexOf('coordinatorTaskIndex >= 1')
    const pill = body.indexOf('isTeammateMode')
    expect(panel).toBeGreaterThan(0)
    expect(pill).toBeGreaterThan(panel)
    expect(body).toContain('enterTeammateView(selectedRow.id')
    expect(body).toContain('teammateFooterIndex === 0')
  })
})
