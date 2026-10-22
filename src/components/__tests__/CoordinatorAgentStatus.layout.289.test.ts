import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('densable 2.1.289 yZ CoordinatorTaskPanel layout', () => {
  test('AgentLine has no PLAY/PAUSE sep; status is elapsed · tokens on the right', () => {
    const src = readFileSync(
      join(import.meta.dir, '../CoordinatorAgentStatus.tsx'),
      'utf8',
    )
    expect(src).not.toContain('PAUSE_ICON')
    expect(src).not.toContain('PLAY_ICON')
    expect(src).toContain("[elapsed, tokenText].filter(Boolean).join(' · ')")
    expect(src).toContain('justifyContent="flex-end"')
    expect(src).toContain('prefixWidth()')
    expect(src).toContain(
      'panelOneLine(nameByAgentId.get(task.id) ?? task.agentType)',
    )
    expect(src).toContain(
      "panelOneLine(task.progress?.summary ?? '') || panelOneLine(task.description)",
    )
    expect(src).toContain(
      'c <= 8 || (c >= 14 && c <= 31) || (c >= 127 && c <= 159)',
    )
    expect(src).toContain(".replace(/\\s+/g, ' ').trim()")
    expect(src).not.toContain('export function Tr')
  })
})
