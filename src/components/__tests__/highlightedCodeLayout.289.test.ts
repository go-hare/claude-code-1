/**
 * densable 2.1.289 HighlightedCode layouts once at the measured width.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = join(import.meta.dir, '../HighlightedCode.tsx')

describe('densable 2.1.289 HighlightedCode single layout', () => {
  test('does not colorFile.render until measuredWidth > 0', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain('useLayoutEffect')
    expect(src).toContain('measuredWidth <= 0')
    expect(src).toContain('useState(width ?? 0)')
    expect(src).not.toContain('DEFAULT_WIDTH')
  })

  test('plugin code pane passes the pane body width', () => {
    const panes = readFileSync(
      join(import.meta.dir, '../PluginRasterPanes.tsx'),
      'utf8',
    )
    expect(panes).toContain('PaneBodyColumnsContext')
    expect(panes).toContain(
      '<HighlightedCode code={text} filePath={filePath} width={width} />',
    )
  })
})
