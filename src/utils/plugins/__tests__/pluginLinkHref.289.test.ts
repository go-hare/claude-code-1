/**
 * densable 2.1.289 `OBr` / `Vmn` / `i8n` / `HYe` / `PYe` / `r8n`.
 * Plugin panes keep drawing localhost / @-in-path / uppercase host / file:
 * links (terminal skips OBr). Off-terminal bad hrefs become Text.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  encodePluginLinkHref,
  encodePluginLinkLabel,
  formatDrawnPlainLinks,
  pluginLinkHrefProblem,
  pluginLinkSurfaceProblem,
  rewriteDrawnLinksToPlainText,
} from '../pluginLinkHref.js'

const PANES = readFileSync(
  join(import.meta.dir, '../../../components/PluginRasterPanes.tsx'),
  'utf8',
)
const EVAL = readFileSync(
  join(import.meta.dir, '../functionHooksModules.ts'),
  'utf8',
)

describe('densable 2.1.289 plugin Link href', () => {
  test('pane draw uses HYe url and PYe label', () => {
    expect(PANES).toContain('url={encodePluginLinkHref(href)}')
    expect(PANES).toContain('encodePluginLinkLabel(href)')
    expect(EVAL).toContain('rewriteDrawnLinksToPlainText')
    expect(EVAL).toContain('formatDrawnPlainLinks')
  })

  test('OBr lets https and http://localhost through', () => {
    expect(pluginLinkHrefProblem('https://example.com/')).toBeUndefined()
    expect(pluginLinkHrefProblem('http://localhost:3000/app')).toBeUndefined()
  })

  test('OBr names file:, raw @, uppercase host, credentials', () => {
    expect(pluginLinkHrefProblem('file:///tmp/x')).toBe(
      'is not https: (or http://localhost)',
    )
    expect(pluginLinkHrefProblem('https://example.com/a@b')).toBe(
      'holds a raw @',
    )
    expect(pluginLinkHrefProblem('https://Example.COM/')).toContain(
      'is not in canonical form',
    )
    expect(pluginLinkHrefProblem('https://u:p@example.com/')).toBe(
      'carries credentials (user@host)',
    )
  })

  test('Vmn skips OBr on the terminal surface', () => {
    expect(
      pluginLinkSurfaceProblem('file:///tmp/x', 'terminal'),
    ).toBeUndefined()
    expect(
      pluginLinkSurfaceProblem('https://Example.COM/user@host', 'terminal'),
    ).toBeUndefined()
    expect(pluginLinkSurfaceProblem('file:///tmp/x', 'desktop')).toBe(
      'is not https: (or http://localhost), and the desktop surface is sent no other link',
    )
    expect(pluginLinkSurfaceProblem(undefined, 'terminal')).toContain(
      'absent, not a string that names where it goes',
    )
  })

  test('i8n keeps those pane hrefs as Link on terminal', () => {
    for (const href of [
      'http://localhost:8080/docs',
      'https://example.com/user@team/repo',
      'https://Example.COM/Path',
      'file:///Users/a/notes.md',
    ]) {
      const tree = { type: 'Link', props: { href } }
      expect(rewriteDrawnLinksToPlainText(tree, 'terminal')).toEqual(tree)
    }
  })

  test('i8n draws a desktop file: Link as Text and names it', () => {
    const problems: Array<{ ordinal: number; problem: string }> = []
    const rewritten = rewriteDrawnLinksToPlainText(
      { type: 'Link', props: { href: 'file:///tmp/x' } },
      'desktop',
      next => {
        problems.push(...next)
      },
    )
    expect(rewritten).toEqual({
      type: 'Text',
      children: ['file:///tmp/x'],
    })
    expect(formatDrawnPlainLinks('Pane', problems)).toBe(
      'ui.render (Pane): Link 1 is drawn as plain text, no link made of it: its href is not https: (or http://localhost), and the desktop surface is sent no other link',
    )
  })

  test('HYe encodes non-ASCII; PYe encodes tab and bidi marks', () => {
    expect(encodePluginLinkHref('https://ex.com/\u00a0')).toBe(
      'https://ex.com/%C2%A0',
    )
    expect(encodePluginLinkLabel('https://ex.com/\tpath')).toBe(
      'https://ex.com/%09path',
    )
    expect(encodePluginLinkLabel('https://ex.com/\u202e')).toBe(
      'https://ex.com/%E2%80%AE',
    )
  })
})
