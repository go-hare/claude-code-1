/**
 * densable 2.1.289 plugin band treats overlay (BackgroundTasksDialog) as blocking.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = join(import.meta.dir, '../PluginRasterPanes.tsx')

describe('densable 2.1.289 plugin band overlay gate', () => {
  test('AbovePrompt band auto-settle and wheel gate overlayActive', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain('const overlayActive = useIsOverlayActive()')
    expect(src).toContain('const bandBlocked = dialogOpen || overlayActive')
    expect(src).toContain("s.activeOverlays.has('background-tasks-dialog')")
    expect(src).toContain('if (backgroundTasksOpen) return null')
    expect(src).toContain(
      'onWheel={hasCue && !bandBlocked ? bandWheel : undefined}',
    )
    expect(src).toContain('!bandBlocked &&')
    expect(src).toContain(
      'onWheel={\n                dialogOpen || overlayActive',
    )
  })
})
