import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(
  join(import.meta.dir, '../CollapsedReadSearchContent.tsx'),
  'utf8',
)
const xu = readFileSync(
  join(import.meta.dir, '../AssistantToolUseMessage.tsx'),
  'utf8',
)

describe('densable 2.1.289 Qc/Xc transcript ToolUse host', () => {
  test('verbose collapsed map mounts Qc (VerboseToolUseSite), not Xu', () => {
    expect(src).toContain('<VerboseToolUseSite')
    expect(src).toContain("component: 'ToolUse'")
    expect(src).toContain(
      'outputOverride:q.props.output===U?void 0:{value:q.props.output}',
    )
    expect(src).toContain(
      'outputOverride = rendered.props.output === output ? undefined : { value: rendered.props.output }',
    )
    expect(src).toContain('outputOverride !== undefined')
    expect(src).toContain('outputOverride.value')
    expect(src).toContain('toolLabel ?? tool.userFacingName')
    expect(src).not.toContain('export function Qc(')
    expect(src).not.toContain('export function Xc(')
    expect(xu).not.toContain('outputOverride')
  })
})
