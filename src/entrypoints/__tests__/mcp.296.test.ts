import { describe, expect, test } from 'bun:test'
import { getTaskOutputPath } from '../../utils/task/diskOutput.js'
import { formatMcpServeToolResult } from '../mcp.js'

describe('claude mcp serve background Bash output path (#411)', () => {
  test('adds backgroundOutputPath when result.data has string backgroundTaskId', () => {
    const res = formatMcpServeToolResult({
      data: {
        stdout: '',
        stderr: '',
        interrupted: false,
        isImage: false,
        backgroundTaskId: 'bash-bg-123',
      },
    })
    expect(res.content).toHaveLength(1)
    const parsed = JSON.parse(
      (res.content[0] as { type: 'text'; text: string }).text,
    )
    expect(parsed.backgroundTaskId).toBe('bash-bg-123')
    expect(parsed.backgroundOutputPath).toBe(getTaskOutputPath('bash-bg-123'))
  })

  test('passes through string results and non-background objects unchanged', () => {
    expect(formatMcpServeToolResult('plain text')).toEqual({
      content: [{ type: 'text', text: 'plain text' }],
    })
    const objRes = formatMcpServeToolResult({ data: { ok: true } })
    expect(
      JSON.parse((objRes.content[0] as { type: 'text'; text: string }).text),
    ).toEqual({
      ok: true,
    })
  })
})
