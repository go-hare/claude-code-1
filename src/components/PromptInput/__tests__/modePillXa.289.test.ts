/**
 * densable 2.1.289 kx footer mode pill.
 * Gold JFe() is `return !1`, so TK always mounts dHe/kx — not Jse/xA.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(
  join(import.meta.dir, '../PromptInputFooterLeftSide.tsx'),
  'utf8',
)

describe('densable 2.1.289 kx mode pill', () => {
  test('pR colors bie+DL+on; ml is nested in kx; dHe clips the row', () => {
    expect(src).toContain('const ModePill = memo(function ModePill')
    expect(src).toContain('color={getModeColor(mode)}')
    expect(src).toContain('{permissionModeIndicator(mode)}')
    expect(src).toContain("{' on'}")
    expect(src).toContain('action="cycle" parens')
    expect(src).not.toContain('permissionModeFooterLabel')
    expect(src).not.toContain('pickFooterSlots')
    expect(src).not.toContain('FooterCse')
    expect(src).not.toContain('function cycleHintSlot')
    expect(src).not.toContain('const modeCyclePart =')
    expect(src).not.toContain('key="mode-cycle"')
    const pill = src.slice(
      src.indexOf('const ModePill = memo'),
      src.indexOf('type ModeIndicatorProps'),
    )
    expect(pill).toContain('cycleShortcut')
    expect(pill).toContain('KeyboardShortcutHint')
    expect(pill).toContain('<Text dimColor>')
    const modePart = src.slice(
      src.indexOf('const modePart ='),
      src.indexOf('const parts = ['),
    )
    expect(modePart).toContain('<ModePill')
    expect(modePart).toContain('key="mode"')
    expect(modePart).toContain('cycleShortcut=')
    expect(src).not.toContain(
      '<Text color={getModeColor(currentMode)} key="mode-cycle">',
    )
    expect(src).toContain('{modePart && <Box flexShrink={0}>{modePart}</Box>}')
    expect(src).toContain('<Box height={1} overflow="hidden">')
    expect(src).not.toContain('overflow="hidden" flexGrow={1}')
  })
})
