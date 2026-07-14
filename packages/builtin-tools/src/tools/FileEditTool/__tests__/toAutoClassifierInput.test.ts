import { afterEach, describe, expect, test } from 'bun:test'
import { FileEditTool } from '../FileEditTool.js'

afterEach(() => {
  delete process.env.CLAUDE_CODE_AUTO_MODE_EDIT_REMOVAL
  delete process.env.CLAUDE_CODE_AUTO_MODE_EDIT_REMOVAL_CAP
})

describe('FileEditTool.toAutoClassifierInput editRemoval', () => {
  test('default: path + new_string only', () => {
    const out = FileEditTool.toAutoClassifierInput!({
      file_path: '/a.ts',
      old_string: 'old',
      new_string: 'new',
    })
    expect(out).toBe('/a.ts: new')
  })

  test('when enabled: projects adds/removes with cap', () => {
    process.env.CLAUDE_CODE_AUTO_MODE_EDIT_REMOVAL = '1'
    process.env.CLAUDE_CODE_AUTO_MODE_EDIT_REMOVAL_CAP = '4'
    const out = FileEditTool.toAutoClassifierInput!({
      file_path: '/a.ts',
      old_string: 'abcdefgh',
      new_string: 'new',
      replace_all: true,
    }) as Record<string, unknown>
    expect(out.file_path).toBe('/a.ts')
    expect(out.adds).toBe('new')
    expect(out.removes).toBe('abcd')
    expect(out.removesTruncated).toBe(true)
    expect(out.replaceAll).toBe(true)
  })
})
