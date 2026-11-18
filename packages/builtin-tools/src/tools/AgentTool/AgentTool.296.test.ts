import { describe, expect, mock, test } from 'bun:test'

mock.module('src/utils/ShellCommand.js', () => ({
  ShellCommand: class {},
  killProcessTree: () => {},
  wrapSpawn: (fn: unknown) => fn,
  createAbortedCommand: () => ({}),
  createFailedCommand: (err: string) => ({ preSpawnError: err }),
  createAdoptedShellCommand: () => ({}),
}))

const { AgentTool } = await import('./AgentTool.js')
const {
  AUTO_COMPACT_WINDOW_MAX,
  AUTO_COMPACT_WINDOW_MIN,
  parseAutoCompactWindowFromFrontmatter,
  warnUnknownAgentFrontmatterKeys,
} = await import('./loadAgentsDir.js')

describe('2.1.292-2.1.296 AgentTool alignment', () => {
  test('#194 AgentTool inputSchema includes optional effort parameter', () => {
    const parsed = AgentTool.inputSchema.safeParse({
      description: 'Test agent',
      prompt: 'Do something',
      effort: 'high',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.effort).toBe('high')
    }
  })

  test('#487 parseAutoCompactWindowFromFrontmatter enforces 100k..1M integer range', () => {
    expect(parseAutoCompactWindowFromFrontmatter(200_000)).toBe(200_000)
    expect(
      parseAutoCompactWindowFromFrontmatter(String(AUTO_COMPACT_WINDOW_MIN)),
    ).toBe(100_000)
    expect(parseAutoCompactWindowFromFrontmatter(AUTO_COMPACT_WINDOW_MAX)).toBe(
      1_000_000,
    )
    expect(parseAutoCompactWindowFromFrontmatter(99_999)).toBeUndefined()
    expect(parseAutoCompactWindowFromFrontmatter(1_000_001)).toBeUndefined()
    expect(parseAutoCompactWindowFromFrontmatter('invalid')).toBeUndefined()
  })

  test('#540 warnUnknownAgentFrontmatterKeys formats typo and alias suggestions', () => {
    const msg = warnUnknownAgentFrontmatterKeys({
      subject: 'Agent file',
      filePath: '/tmp/my-agent.md',
      frontmatter: {
        name: 'my-agent',
        description: 'desc',
        allowedTools: ['Read'],
        effrt: 'high',
        zzz_unknown_key_123: true,
      },
    })
    expect(msg).toContain('"allowedTools" (did you mean "tools"?)')
    expect(msg).toContain('"effrt" (did you mean "effort"?)')
    expect(msg).toContain('"zzz_unknown_key_123"')
    expect(msg).not.toContain('"zzz_unknown_key_123" (did you mean')
  })
})
