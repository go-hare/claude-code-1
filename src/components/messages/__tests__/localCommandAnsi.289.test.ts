import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('densable 2.1.289 local-command-stdout ANSI replay', () => {
  test('IndentedContent paints CSI via Ansi, not Markdown lexer', () => {
    const src = readFileSync(
      join(import.meta.dir, '../UserLocalCommandOutputMessage.tsx'),
      'utf8',
    )
    expect(src).toContain("from '@anthropic/ink'")
    expect(src).toContain('hasAnsiEscapes')
    expect(src).toContain('<Ansi wrap="wrap">{children}</Ansi>')
    expect(src).toContain('stripPromptTags={false}')
  })

  test('UserTextMessage still paints stdout when command-message is also present', () => {
    const src = readFileSync(
      join(import.meta.dir, '../UserTextMessage.tsx'),
      'utf8',
    )
    expect(src).toContain("param.text.includes('<local-command-stdout')")
    expect(src).toContain(
      '<UserLocalCommandOutputMessage content={param.text} />',
    )
  })
})
