import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PANES = join(import.meta.dir, '../PluginRasterPanes.tsx')
const HOOKS = join(
  import.meta.dir,
  '../../utils/plugins/functionHooksModules.ts',
)

describe('densable 2.1.289 mods CloseMark + load invalidate', () => {
  test('PluginPaneCloseMark matches gold S$ absolute top/right inset ✕', () => {
    const src = readFileSync(PANES, 'utf8')
    expect(src).toContain('export function PluginPaneCloseMark')
    expect(src).toContain('BORDER_MARK_INSET = 2')
    expect(src).toContain('CLOSE_MARK_COLUMNS = 2')
    expect(src).toContain("position=\"absolute\"")
    expect(src).toContain('top={0}')
    expect(src).toContain('right={inset}')
    expect(src).toContain("{'✕'}")
    expect(src).toContain('<PluginPaneCloseMark')
    expect(src).toContain(
      "void closePluginPane(pane.id, { kind: 'person' })",
    )
  })

  test('replaceLoadedFunctionHooksModules invalidates ui.render', () => {
    const src = readFileSync(HOOKS, 'utf8')
    const start = src.indexOf('function replaceLoadedFunctionHooksModules')
    expect(start).toBeGreaterThan(0)
    const body = src.slice(start, start + 900)
    expect(body).toContain("invalidateRender('ui.render')")
    expect(body).toContain('bumpRasterFrames()')
  })
})
