import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const hint = readFileSync(
  join(import.meta.dir, '../ToolProgressHint.tsx'),
  'utf8',
)
const bashUi = readFileSync(
  join(
    import.meta.dir,
    '../../../packages/builtin-tools/src/tools/BashTool/UI.tsx',
  ),
  'utf8',
)
const session = readFileSync(
  join(import.meta.dir, '../SessionBackgroundHint.tsx'),
  'utf8',
)

describe('densable 2.1.289 ToolProgressHint S/jHn', () => {
  test('S hosts ToolProgress with real toolUseId', () => {
    expect(hint).toContain("component: 'ToolProgress'")
    expect(hint).toContain("kind: 'background_hint'")
    expect(hint).toContain('tool_use_id: toolUseId')
    expect(hint).toContain('PILL_INDENT_COLUMNS = 5')
  })

  test('jHn BackgroundHint draws through ToolProgressHint', () => {
    expect(bashUi).toContain(
      '<ToolProgressHint toolUseId={toolUseId} hint={hint} />',
    )
    expect(bashUi).toContain('keyOnly === true')
  })

  test('session Ctrl+B is not the ToolProgress host', () => {
    expect(session).not.toContain("component: 'ToolProgress'")
    expect(session).not.toContain('session-background')
  })
})
