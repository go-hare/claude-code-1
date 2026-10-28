/**
 * densable 2.1.289 — ctrl+r history picker scopes (l5n + cycleScope).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { DEFAULT_BINDINGS } from '../../keybindings/defaultBindings.js'
import { KEYBINDING_ACTIONS } from '../../keybindings/schema.js'

const SRC = join(import.meta.dir, '../HistorySearchDialog.tsx')

describe('densable 2.1.289 history search scope cycle', () => {
  test('dialog title, extraHints, and ctrl+s cycle match gold doe', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain("['session', 'project', 'everywhere']")
    expect(src).toContain('Search prompts · ${scope}')
    expect(src).toContain('newest ${scan.items.length.toLocaleString()} only')
    expect(src).toContain('placeholder="Filter history…"')
    expect(src).toContain('extraHints=')
    expect(src).toContain('description="scope"')
    expect(src).toContain('fallback="ctrl+s"')
    expect(src).toContain("useRegisterKeybindingContext('HistorySearch')")
    expect(src).toContain("'historySearch:cycleScope'")
    expect(src).toContain("'tengu_history_picker_scope'")
    expect(src).toContain('selectAction="use"')
    expect(src).toContain('direction="up"')
    expect(src).toContain("previewOnRight ? 'right' : 'bottom'")
    expect(src).toContain('columns >= 100')
    expect(src).toContain('PREVIEW_ROWS = 6')
    expect(src).toContain('AGE_WIDTH = 8')
    expect(src).toContain("Couldn't read prompt history")
  })

  test('HistorySearch bindings include ctrl+s cycleScope', () => {
    const block = DEFAULT_BINDINGS.find(b => b.context === 'HistorySearch')
    expect(block?.bindings['ctrl+s']).toBe('historySearch:cycleScope')
    expect(KEYBINDING_ACTIONS).toContain('historySearch:cycleScope')
  })
})
