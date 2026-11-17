import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(
  join(import.meta.dir, '../UserLocalCommandOutputMessage.tsx'),
  'utf8',
)

describe('densable 2.1.289 CommandOutput Gp', () => {
  test('requestId is messageId; props include command, args, text, isErrored', () => {
    expect(src).toContain("component: 'CommandOutput'")
    expect(src).toContain('commandRun === undefined')
    expect(src).toContain('messageId ?? commandRun.command ??')
    expect(src).toContain('args: commandRun.args,')
    expect(src).not.toContain("args: commandRun.args ?? ''")
    expect(src).toContain('ref={rendered.hostRef as React.Ref<DOMElement>}')
    expect(src).toContain('function commandOutputPrinted')
    expect(src).toContain('if (hasOut === hasErr) return undefined')
    expect(src).toContain('commandOutputPrinted(content) === undefined')
  })
})
