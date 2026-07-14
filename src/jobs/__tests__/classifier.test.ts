/**
 * Tests for src/jobs/classifier.ts
 *
 * Uses real temp dirs instead of mocking fs to avoid
 * cross-test mock pollution in bun test.
 *
 * classifier.ts takes jobDir as a parameter, so no envUtils mock needed.
 *
 * Status vocabulary (implementation): working | blocked | done | failed
 * Field name is `state` (BgJobState), not legacy `status`.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AssistantMessage } from '../../types/message.js'
import { classifyAndWriteState } from '../classifier.js'

// ─── setup: real temp dir ──────────────────────────────────────────────────

let tempBase: string
let jobDir: string
let stateFile: string

tempBase = mkdtempSync(join(tmpdir(), 'classifier-test-'))

function freshJobDir(): void {
  jobDir = mkdtempSync(join(tempBase, 'job-'))
  stateFile = join(jobDir, 'state.json')
}

// ─── helpers ────────────────────────────────────────────────────────────────

function makeAssistantMessage(
  content: any[],
  extra: Record<string, any> = {},
): AssistantMessage {
  return {
    type: 'assistant',
    uuid: '00000000-0000-0000-0000-000000000000' as any,
    message: {
      role: 'assistant',
      content,
      ...extra,
    },
  } as any
}

// ─── lifecycle ─────────────────────────────────────────────────────────────

beforeEach(() => {
  freshJobDir()
})

afterAll(() => {
  try {
    rmSync(tempBase, { recursive: true, force: true })
  } catch {
    // best-effort cleanup
  }
})

// ─── tests ──────────────────────────────────────────────────────────────────

describe('classifyAndWriteState', () => {
  test('does nothing when state.json is missing', async () => {
    await classifyAndWriteState(jobDir, [])
    // stateFile should still not exist
    let exists = false
    try {
      readFileSync(stateFile, 'utf-8')
      exists = true
    } catch {
      // expected
    }
    expect(exists).toBe(false)
  })

  test('sets state to working when last message has tool_use block', async () => {
    writeFileSync(
      stateFile,
      JSON.stringify({ state: 'starting', updatedAt: '2026-01-01' }),
      'utf-8',
    )

    const msg = makeAssistantMessage([
      { type: 'text', text: 'Let me check...' },
      { type: 'tool_use', id: 'toolu_1', name: 'bash', input: {} },
    ])

    await classifyAndWriteState(jobDir, [msg])

    const state = JSON.parse(readFileSync(stateFile, 'utf-8'))
    expect(state.state).toBe('working')
    expect(state.tempo).toBe('active')
  })

  test('sets state to done when stop_reason is end_turn', async () => {
    writeFileSync(
      stateFile,
      JSON.stringify({ state: 'working', updatedAt: '2026-01-01' }),
      'utf-8',
    )

    const msg = makeAssistantMessage([{ type: 'text', text: 'All done.' }], {
      stop_reason: 'end_turn',
    })

    await classifyAndWriteState(jobDir, [msg])

    const state = JSON.parse(readFileSync(stateFile, 'utf-8'))
    expect(state.state).toBe('done')
    expect(state.tempo).toBe('idle')
    expect(state.firstTerminalAt).toBeDefined()
  })

  test('sets state to working for empty messages (state exists)', async () => {
    writeFileSync(
      stateFile,
      JSON.stringify({ state: 'starting', updatedAt: '2026-01-01' }),
      'utf-8',
    )

    await classifyAndWriteState(jobDir, [])

    const state = JSON.parse(readFileSync(stateFile, 'utf-8'))
    expect(state.state).toBe('working')
  })

  test('sets state to working when stop_reason is max_tokens', async () => {
    writeFileSync(
      stateFile,
      JSON.stringify({ state: 'working', updatedAt: '2026-01-01' }),
      'utf-8',
    )

    const msg = makeAssistantMessage([{ type: 'text', text: 'I need more' }], {
      stop_reason: 'max_tokens',
    })

    await classifyAndWriteState(jobDir, [msg])

    const state = JSON.parse(readFileSync(stateFile, 'utf-8'))
    expect(state.state).toBe('working')
  })

  test('sets state to blocked for AskUserQuestion tool_use', async () => {
    writeFileSync(
      stateFile,
      JSON.stringify({ state: 'working', updatedAt: '2026-01-01' }),
      'utf-8',
    )

    const msg = makeAssistantMessage([
      {
        type: 'tool_use',
        id: 'toolu_q',
        name: 'AskUserQuestion',
        input: { questions: [] },
      },
    ])

    await classifyAndWriteState(jobDir, [msg])

    const state = JSON.parse(readFileSync(stateFile, 'utf-8'))
    expect(state.state).toBe('blocked')
    expect(state.tempo).toBe('blocked')
  })
})
