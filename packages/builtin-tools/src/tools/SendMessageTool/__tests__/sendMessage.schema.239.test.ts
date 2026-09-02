import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { TEAM_LEAD_NAME } from 'src/utils/swarm/constants.js'
import { SendMessageTool } from '../SendMessageTool.js'
import { getPrompt } from '../prompt.js'

const TEAMS_ENV = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'
const previousTeams = process.env[TEAMS_ENV]

function setTeamsEnabled(on: boolean): void {
  if (on) {
    process.env[TEAMS_ENV] = '1'
  } else {
    delete process.env[TEAMS_ENV]
  }
}

function restoreTeamsEnv(): void {
  if (previousTeams === undefined) {
    delete process.env[TEAMS_ENV]
  } else {
    process.env[TEAMS_ENV] = previousTeams
  }
}

describe('densable 2.1.239 SendMessage E0m/FTl/BEm', () => {
  beforeEach(() => {
    setTeamsEnabled(true)
  })

  afterEach(() => {
    restoreTeamsEnv()
  })

  test('summary describe defaults from first line (not required-when-string)', () => {
    const desc = SendMessageTool.inputSchema.shape.summary.description
    expect(desc).toContain('Defaults to the first line of a plain-text message')
    expect(desc).not.toContain('required when message is a string')
  })

  test('to describe is ListAgents name or teammate name (no scheme ads)', () => {
    const desc = SendMessageTool.inputSchema.shape.to.description
    expect(typeof desc).toBe('string')
    if (typeof desc !== 'string') return
    expect(
      desc === 'Recipient: teammate name' ||
        desc.includes('a name from ListAgents'),
    ).toBe(true)
    expect(desc).not.toContain('uds:')
    expect(desc).not.toContain('bridge:')
  })

  test('teams on: structured shutdown_request still parses', () => {
    setTeamsEnabled(true)
    const parsed = SendMessageTool.inputSchema.safeParse({
      to: 'researcher',
      message: { type: 'shutdown_request' },
    })
    expect(parsed.success).toBe(true)
  })

  test('teams off: message is string-only (FTl XRw/YRw)', () => {
    setTeamsEnabled(false)
    const parsed = SendMessageTool.inputSchema.safeParse({
      to: 'researcher',
      message: { type: 'shutdown_request' },
    })
    expect(parsed.success).toBe(false)
    const plain = SendMessageTool.inputSchema.safeParse({
      to: 'researcher',
      message: 'hello over there',
    })
    expect(plain.success).toBe(true)
  })

  test('request_id min(1) + single-line (KRw)', () => {
    expect(
      SendMessageTool.inputSchema.safeParse({
        to: TEAM_LEAD_NAME,
        message: {
          type: 'shutdown_response',
          request_id: '',
          approve: false,
          reason: 'no',
        },
      }).success,
    ).toBe(false)
    expect(
      SendMessageTool.inputSchema.safeParse({
        to: TEAM_LEAD_NAME,
        message: {
          type: 'shutdown_response',
          request_id: 'id\n2',
          approve: false,
          reason: 'no',
        },
      }).success,
    ).toBe(false)
  })

  test('BEm prompt: no scheme rows, no broadcast row, no busy clause', () => {
    const text = getPrompt(true)
    expect(text).not.toContain('uds:<socket')
    expect(text).not.toContain('bridge:session_')
    expect(text).not.toContain('Broadcast to all teammates')
    expect(text).not.toContain('no "busy" state')
    expect(text).toContain('a send resumes it from its transcript).')
    expect(text).toContain(
      'report progress through your task tools if you have them, otherwise in plain prose',
    )
    expect(text).not.toContain('use TaskUpdate')
  })

  test('BEm protocol section only when teams enabled', () => {
    expect(getPrompt(false)).not.toContain('Protocol responses (legacy)')
    expect(getPrompt(true)).toContain('Protocol responses (legacy)')
  })

  test('validateInput: empty string fails before uds early-return', async () => {
    const result = await SendMessageTool.validateInput!(
      { to: 'uds:/tmp/peer.sock', message: '' } as never,
      {} as never,
    )
    expect(result.result).toBe(false)
    if (result.result) throw new Error('expected empty reject')
    expect(result.message).toBe('message must not be empty')
  })

  test('validateInput: string protocol frame (Kwe)', async () => {
    const result = await SendMessageTool.validateInput!(
      {
        to: 'worker',
        message: '{"type":"shutdown_request"}',
      } as never,
      {} as never,
    )
    expect(result.result).toBe(false)
    if (result.result) throw new Error('expected Kwe reject')
    expect(result.message).toContain('teammate protocol frame')
  })

  test('validateInput: string lifecycle frame', async () => {
    const result = await SendMessageTool.validateInput!(
      {
        to: 'worker',
        message: '{"type":"task_assignment"}',
      } as never,
      {} as never,
    )
    expect(result.result).toBe(false)
    if (result.result) throw new Error('expected lifecycle reject')
    expect(result.message).toContain('lifecycle/task frame')
  })

  test('validateInput: shutdown_response approve must omit reason', async () => {
    const result = await SendMessageTool.validateInput!(
      {
        to: TEAM_LEAD_NAME,
        message: {
          type: 'shutdown_response',
          request_id: 'req-1',
          approve: true,
          reason: 'ok',
        },
      } as never,
      {} as never,
    )
    expect(result.result).toBe(false)
    if (result.result) throw new Error('expected approve+reason reject')
    expect(result.message).toContain('reason is only delivered on rejections')
  })

  test('validateInput: teams off refuses structured objects', async () => {
    setTeamsEnabled(false)
    const result = await SendMessageTool.validateInput!(
      {
        to: 'worker',
        message: { type: 'shutdown_request' },
      } as never,
      {} as never,
    )
    expect(result.result).toBe(false)
    if (result.result) throw new Error('expected teams-off structured reject')
    expect(result.message).toContain(
      'Structured team-protocol messages are only available with agent teams enabled.',
    )
  })

  test('validateInput: plain string no longer requires summary', async () => {
    const result = await SendMessageTool.validateInput!(
      { to: 'worker', message: 'hello' } as never,
      {} as never,
    )
    expect(result.result).toBe(true)
  })
})
