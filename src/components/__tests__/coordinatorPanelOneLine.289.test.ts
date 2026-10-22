import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(import.meta.dir, '../CoordinatorAgentStatus.tsx')

/** densable Tr analog — same walk as CoordinatorAgentStatus.panelOneLine. */
function panelOneLine(text: string | undefined): string {
  if (!text) return ''
  let stripped = ''
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c <= 8 || (c >= 14 && c <= 31) || (c >= 127 && c <= 159)) continue
    stripped += text[i]!
  }
  return stripped.replace(/\s+/g, ' ').trim()
}

describe('densable 2.1.289 yZ Tr panel one-line', () => {
  test('AgentLine description is Tr(summary)||Tr(description)', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain(
      "panelOneLine(task.progress?.summary ?? '') || panelOneLine(task.description)",
    )
    expect(src).not.toContain('task.progress?.summary || task.description')
    expect(src).toContain(
      'c <= 8 || (c >= 14 && c <= 31) || (c >= 127 && c <= 159)',
    )
    expect(src).toContain(".replace(/\\s+/g, ' ').trim()")
    expect(src).not.toContain('export function Tr')
  })

  test('Tr analog strips C0/C1 then collapses whitespace including newlines', () => {
    expect(panelOneLine('**PASS**\nGold `setImmediate` is back')).toBe(
      '**PASS** Gold `setImmediate` is back',
    )
    expect(panelOneLine('  a\n\tb  ')).toBe('a b')
    expect(panelOneLine('')).toBe('')
    expect(panelOneLine(undefined)).toBe('')
    expect(panelOneLine(`ok${String.fromCharCode(0)}no`)).toBe('okno')
  })
})
