import { marked, type Tokens } from 'marked'

export type CopyableBlock =
  | {
      kind: 'code'
      text: string
      lang: string | undefined
    }
  | {
      kind: 'quote'
      text: string
    }

export function extractCopyableBlocksFromText(
  markdown: string,
): CopyableBlock[] {
  const tokens = marked.lexer(markdown)
  const blocks: CopyableBlock[] = []
  let pendingQuote: { kind: 'quote'; text: string } | undefined
  for (const token of tokens) {
    if (token.type === 'space') continue
    if (token.type !== 'blockquote') {
      pendingQuote = undefined
      if (token.type === 'code') {
        const codeToken = token as Tokens.Code
        blocks.push({
          kind: 'code',
          text: codeToken.text,
          lang: codeToken.lang,
        })
      }
      continue
    }
    const quoteText = (token as Tokens.Blockquote).text
      .replace(/^\s*\n/, '')
      .trimEnd()
    if (quoteText === '') continue
    if (pendingQuote) {
      pendingQuote.text = `${pendingQuote.text}\n\n${quoteText}`
    } else {
      pendingQuote = { kind: 'quote', text: quoteText }
      blocks.push(pendingQuote)
    }
  }
  return blocks
}
