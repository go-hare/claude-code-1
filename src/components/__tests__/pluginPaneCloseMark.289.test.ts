import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const PANES = join(import.meta.dir, '../PluginRasterPanes.tsx')
const PANES_DIR = join(import.meta.dir, '../pluginRaster')
const HOOKS = join(
  import.meta.dir,
  '../../utils/plugins/functionHooksModules.ts',
)
const HOOKS_DIR = join(import.meta.dir, '../../utils/plugins/functionHooks')

describe('densable 2.1.289 mods CloseMark + load invalidate', () => {
  test('PluginPaneCloseMark matches gold S$ absolute top/right inset ✕', () => {
    const src = [
      readFileSync(PANES, 'utf8'),
      ...readdirSync(PANES_DIR)
        .filter(f => f.endsWith('.ts') || f.endsWith('.tsx'))
        .sort()
        .map(f => readFileSync(join(PANES_DIR, f), 'utf8')),
    ].join('\n')
    expect(src).toContain('export function PluginPaneCloseMark')
    expect(src).toContain('BORDER_MARK_INSET = 2')
    expect(src).toContain('CLOSE_MARK_COLUMNS = 2')
    expect(src).toContain('position="absolute"')
    expect(src).toContain('top={0}')
    expect(src).toContain('right={inset}')
    expect(src).toContain("{'✕'}")
    expect(src).toContain('<PluginPaneCloseMark')
    expect(src).toContain('if (event.isWindowActivation) return')
    expect(src).toContain("void closePluginPane(pane.id, { kind: 'person' })")
  })

  test('replaceLoadedFunctionHooksModules invalidates ui.render', () => {
    const src = [
      readFileSync(HOOKS, 'utf8'),
      ...readdirSync(HOOKS_DIR)
        .filter(f => f.endsWith('.ts'))
        .sort()
        .map(f => readFileSync(join(HOOKS_DIR, f), 'utf8')),
    ].join('\n')
    const start = src.indexOf('function replaceLoadedFunctionHooksModules')
    expect(start).toBeGreaterThan(0)
    const body = src.slice(start, start + 1800)
    // gold E1e.onInvalidate → Vi; analog is bumpFaultRenderFv → invalidateRender
    expect(body).toContain('bumpFaultRenderFv()')
    expect(body).toContain('bumpRasterFrames()')
    const bump = src.indexOf('function bumpFaultRenderFv')
    expect(bump).toBeGreaterThan(0)
    expect(src.slice(bump, bump + 400)).toContain(
      "invalidateRender('ui.render')",
    )
  })
})
