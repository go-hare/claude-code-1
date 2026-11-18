import { describe, expect, test } from 'bun:test'
import { extractCopyableBlocksFromText } from '../copyBlocks.js'

describe('/copy quoted text extraction #345', () => {
  test('extracts blockquotes without > markers and merges consecutive quotes', () => {
    const md = [
      'Here is a drafted reply:',
      '',
      '> Hello team,',
      '> ',
      '> Please see the update.',
      '',
      '```ts',
      'const x = 1',
      '```',
    ].join('\n')

    const blocks = extractCopyableBlocksFromText(md)
    expect(blocks).toEqual([
      {
        kind: 'quote',
        text: 'Hello team,\n\nPlease see the update.',
      },
      {
        kind: 'code',
        text: 'const x = 1',
        lang: 'ts',
      },
    ])
  })
})
