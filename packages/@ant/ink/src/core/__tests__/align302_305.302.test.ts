import { PassThrough } from 'node:stream'
import { describe, expect, test } from 'bun:test'
import React from 'react'
import { AccessibilityContext } from '../../index.js'
import { SearchBox } from '../../theme/SearchBox.js'
import { createNode, appendChildNode } from '../dom.js'
import Ink from '../ink.js'
import {
  decodeIterm2Placeholder,
  encodeIterm2InlineImage,
  iterm2PlaceholderGrid,
  rgbaToPngBase64,
} from '../iterm2Image.js'
import { extractScreenReaderText } from '../screenReaderTree.js'
import { squashTextNodesToSegments } from '../squash-text-nodes.js'
import { isIterm2VersionAtLeast35 } from '../terminalCapabilities.js'
import { TerminalImages } from '../terminalImages.js'
import { CharPool, createScreen, HyperlinkPool, StylePool } from '../screen.js'

function renderSr(element: React.ReactElement): string {
  const stdout = Object.assign(new PassThrough(), {
    columns: 80,
    rows: 24,
    isTTY: true,
  })
  stdout.resume()
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode() {},
    ref() {},
    unref() {},
  })
  const ink = new Ink({
    stdout: stdout as never,
    stdin: stdin as never,
    stderr: new PassThrough() as never,
    exitOnCtrlC: false,
    patchConsole: false,
  })
  ink.render(element)
  const text = extractScreenReaderText(
    (ink as unknown as { rootNode: never }).rootNode,
  )
  ink.unmount()
  return text
}

describe('ink 2.1.302–2.1.305 alignment', () => {
  test('#915 squashTextNodesToSegments merges split surrogate pair across ink-link boundary', () => {
    const root = createNode('ink-text')
    const link = createNode('ink-link')
    link.attributes['href'] = 'https://example.com'
    const emoji = '🚀' // UTF-16: high surrogate + low surrogate
    const t1 = { nodeName: '#text' as const, nodeValue: 'go ' + emoji[0] }
    const t2 = { nodeName: '#text' as const, nodeValue: emoji[1] + ' link' }
    appendChildNode(root, t1 as never)
    appendChildNode(link, t2 as never)
    appendChildNode(root, link)

    const segs = squashTextNodesToSegments(root)
    expect(segs.length).toBe(2)
    expect(segs[0]!.text).toBe('go 🚀')
    expect(segs[0]!.hyperlink).toBeUndefined()
    expect(segs[1]!.text).toBe(' link')
    expect(segs[1]!.hyperlink).toBe('https://example.com')
  })

  test('#1048 SearchBox says "Search:" in screen reader mode when query is non-empty and omits prefix when empty', () => {
    const withQuery = renderSr(
      React.createElement(
        AccessibilityContext.Provider,
        { value: true },
        React.createElement(SearchBox, {
          query: 'hello',
          isTerminalFocused: true,
        }),
      ),
    )
    expect(withQuery).toContain('Search: hello')
    expect(withQuery).not.toContain('⌕')

    const emptyQuery = renderSr(
      React.createElement(
        AccessibilityContext.Provider,
        { value: true },
        React.createElement(SearchBox, {
          query: '',
          isTerminalFocused: true,
        }),
      ),
    )
    expect(emptyQuery).not.toContain('⌕')
    expect(emptyQuery).not.toContain('Search:')
  })

  test('#1054 iTerm2 3.5+ inline image encoding, placeholder grid, and TerminalImages protocol', () => {
    expect(isIterm2VersionAtLeast35('iTerm2 3.5.0')).toBe(true)
    expect(isIterm2VersionAtLeast35('iTerm2 3.6.6')).toBe(true)
    expect(isIterm2VersionAtLeast35('iTerm2 3.4.23')).toBe(false)
    expect(isIterm2VersionAtLeast35('ghostty 1.0.0')).toBe(false)

    const grid = iterm2PlaceholderGrid(42, 2, 2)
    const lines = grid.split('\n')
    expect(lines.length).toBe(2)
    const decoded = decodeIterm2Placeholder(lines[0]!.slice(0, 6))
    expect(decoded).toEqual({ id: 42, row: 0, column: 0 })

    // 1x1 RGBA pixel -> PNG -> OSC 1337
    const rgba = Buffer.from([255, 0, 0, 255]).toString('base64')
    const pngB64 = rgbaToPngBase64(rgba, 1, 1)
    expect(Buffer.from(pngB64, 'base64').subarray(0, 4)).toEqual(
      Buffer.from([137, 80, 78, 71]),
    )

    const osc = encodeIterm2InlineImage({
      pngBase64: pngB64,
      columns: 2,
      rows: 1,
    })
    expect(osc.startsWith('\x1b]1337;File=inline=1;')).toBe(true)
    expect(
      osc.includes('width=2;height=1;preserveAspectRatio=1;doNotMoveCursor=1:'),
    ).toBe(true)
    expect(osc.endsWith('\x07')).toBe(true)

    const imgs = new TerminalImages(() => {})
    const id = imgs.allocate(8, undefined, 'iterm', 'test-key')
    expect(id).toBeDefined()
    expect(imgs.hasItermImages).toBe(true)
    const ok = imgs.transmit(id!, () => osc, {
      resend: true,
      box: { columns: 2, rows: 1 },
    })
    expect(ok).toBe(true)

    const screen = createScreen(
      4,
      2,
      new StylePool(),
      new CharPool(),
      new HyperlinkPool(),
    )
    // Verify placeIterm returns empty when no placeholder cells exist on screen
    expect(
      imgs.placeIterm(screen, undefined, (c, r) => `\x1b[${r + 1};${c + 1}H`),
    ).toBe('')
  })
})
