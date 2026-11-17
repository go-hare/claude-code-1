import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(
  join(import.meta.dir, '../CollapsedReadSearchContent.tsx'),
  'utf8',
)

describe('densable 2.1.289 ToolGroup calls objects', () => {
  test('Ht maps tool_use blocks to call objects, not id strings', () => {
    expect(src).toContain('function toolUsesFromCollapsedGroup')
    expect(src).toContain('tool_use_id: use.id')
    expect(src).toContain('tool: use.name')
    expect(src).toContain('isInterrupted: interruptedCall(result)')
    expect(src).toContain("result?.type === 'user' ? result.toolUseResult")
    expect(src).not.toContain('calls: toolUseIdsForRender')
    expect(src).toContain('ref={rendered.hostRef as React.Ref<DOMElement>}')
  })
})
