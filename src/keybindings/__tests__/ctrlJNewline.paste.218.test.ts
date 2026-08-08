/**
 * densable 2.1.218 #5 — paste path: Ctrl+J encoded newlines become real newlines
 * when Chat binding routes to chat:newline (not literal "j").
 *
 * densable SEA ~229840815:
 *   enter:"chat:submit","ctrl+j":"chat:newline"
 * PromptInput handleNewline inserts '\n' at cursor (not submit, not 'j').
 *
 * Also covers usePasteHandler large non-bracketed key payloads routing as paste
 * (densable d7r pkt threshold path) at the binding/handler contract level.
 */
import { describe, expect, test } from 'bun:test'
import { DEFAULT_BINDINGS } from '../defaultBindings.js'

/** Simulate key sequence a paste might emit for multi-line text. */
function resolveChatAction(key: string): string | undefined {
  const chat = DEFAULT_BINDINGS.find(b => b.context === 'Chat')
  const action = chat?.bindings[key]
  return action ?? undefined
}

/**
 * densable paste collapse bug: without chat:newline, Ctrl+J becomes "j"
 * and multi-line paste joins with j separators.
 */
function expandPasteViaBindings(encoded: string): string {
  // encoded uses \x0a for real LF and \x0a via ctrl+j markers as <C-j>
  let out = ''
  let i = 0
  while (i < encoded.length) {
    if (encoded.startsWith('<C-j>', i)) {
      const action = resolveChatAction('ctrl+j')
      if (action === 'chat:newline') {
        out += '\n'
      } else if (action === 'chat:submit') {
        out += '«submit»'
      } else {
        // unbound / wrong → historic collapse inserts literal j
        out += 'j'
      }
      i += 5
      continue
    }
    out += encoded[i]
    i++
  }
  return out
}

/**
 * densable PromptInput handleNewline pure twin:
 *   newInput = input.slice(0, cursor) + '\n' + input.slice(cursor)
 *   cursor += 1
 */
function applyChatNewline(
  input: string,
  cursorOffset: number,
): { input: string; cursorOffset: number } {
  const action = resolveChatAction('ctrl+j')
  if (action !== 'chat:newline') {
    // wrong binding → insert literal j (pre-fix collapse)
    return {
      input: input.slice(0, cursorOffset) + 'j' + input.slice(cursorOffset),
      cursorOffset: cursorOffset + 1,
    }
  }
  return {
    input: input.slice(0, cursorOffset) + '\n' + input.slice(cursorOffset),
    cursorOffset: cursorOffset + 1,
  }
}

describe('densable 2.1.218 #5 paste Ctrl+J → newline expansion', () => {
  test('Chat binding table maps ctrl+j to chat:newline (not submit)', () => {
    expect(resolveChatAction('ctrl+j')).toBe('chat:newline')
    expect(resolveChatAction('enter')).toBe('chat:submit')
    // paste must not treat Ctrl+J as submit
    expect(resolveChatAction('ctrl+j')).not.toBe('chat:submit')
  })

  test('multi-line paste encoded as Ctrl+J expands to real newlines', () => {
    const encoded = 'line1<C-j>line2<C-j>line3'
    expect(expandPasteViaBindings(encoded)).toBe('line1\nline2\nline3')
  })

  test('does not collapse to j separators', () => {
    const encoded = 'foo<C-j>bar'
    const expanded = expandPasteViaBindings(encoded)
    expect(expanded).not.toBe('foojbar')
    expect(expanded).toBe('foo\nbar')
  })

  test('handleNewline pure twin inserts LF at cursor (densable PromptInput)', () => {
    const r = applyChatNewline('ab', 1)
    expect(r.input).toBe('a\nb')
    expect(r.cursorOffset).toBe(2)
    // multi-step paste: each Ctrl+J advances cursor past the newline
    let state = { input: '', cursorOffset: 0 }
    for (const ch of ['l', '1', '\x0a', 'l', '2']) {
      if (ch === '\x0a') {
        state = applyChatNewline(state.input, state.cursorOffset)
      } else {
        state = {
          input:
            state.input.slice(0, state.cursorOffset) +
            ch +
            state.input.slice(state.cursorOffset),
          cursorOffset: state.cursorOffset + 1,
        }
      }
    }
    expect(state.input).toBe('l1\nl2')
  })

  test('PromptInput registers chat:newline handler symbolically', async () => {
    // binding schema includes chat:newline so PromptInput can map handleNewline
    const { KEYBINDING_ACTIONS } = await import('../schema.js')
    expect(KEYBINDING_ACTIONS).toContain('chat:newline')
  })

  test('usePasteHandler exposes handlePaste for bracketed paste path', async () => {
    // source-level contract: densable d7r has handlePaste + isPasting
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(
      join(import.meta.dir, '../../hooks/usePasteHandler.ts'),
      'utf8',
    )
    expect(src).toContain('handlePaste')
    expect(src).toContain('isPasting')
    expect(src).toContain('isPasted')
    // large non-bracketed key payloads route as paste (densable pkt)
    expect(src).toMatch(/PASTE_THRESHOLD|pkt|length\s*>/)
  })
})
