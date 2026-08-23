import { afterEach, describe, expect, test } from 'bun:test'
import { homedir } from 'os'
import { join } from 'path'
import {
  dontAskAgainMaxLabelWidth,
  dontAskAgainMaxLabelWidthFromTracked,
  initialDontAskAgainSelectWidth,
  renderDontAskAgainLabel,
  toTildePath,
} from '../dontAskAgainLabel.js'

describe('renderDontAskAgainLabel densable 2.1.238 MYg', () => {
  test('fits full cwd when budget is wide', () => {
    const cwd = '/tmp/proj'
    const label = renderDontAskAgainLabel({
      toolName: 'Bash',
      cwd,
      maxLabelWidth: 120,
    })
    expect(label).toBe(`Yes, and don't ask again for Bash commands in ${cwd}`)
  })

  test('collapses home to tilde when full path is too wide', () => {
    const home = homedir()
    const cwd = join(home, 'very', 'deep', 'project', 'path', 'leaf')
    const tilde = toTildePath(cwd)
    expect(tilde.startsWith('~')).toBe(true)
    const prefix = "Yes, and don't ask again for Bash commands in "
    const tildeWidth = prefix.length + tilde.length
    const fullWidth = prefix.length + cwd.length
    expect(fullWidth).toBeGreaterThan(tildeWidth)
    const label = renderDontAskAgainLabel({
      toolName: 'Bash',
      cwd,
      // wide enough for tilde form, not absolute (absolute is longer)
      maxLabelWidth: tildeWidth,
    })
    expect(label).toBe(`Yes, and don't ask again for Bash commands in ${tilde}`)
  })

  test('narrow budget truncates tilde path (FJe), not basename', () => {
    const home = homedir()
    const cwd = join(home, 'very-long-directory-name-here')
    const label = renderDontAskAgainLabel({
      toolName: 'Bash',
      cwd,
      maxLabelWidth: 50,
    })
    expect(label).not.toBeNull()
    expect(
      label!.startsWith("Yes, and don't ask again for Bash commands in "),
    ).toBe(true)
    expect(label!.includes('…')).toBe(true)
    // FJe walks the tilde path (`~/very-long…`), not basename only.
    expect(label).toContain('~')
  })

  test('Ih rewrite that still overflows returns null (does not FL)', () => {
    const cwd = `/tmp/proj\x1b[31m${'x'.repeat(80)}`
    expect(
      renderDontAskAgainLabel({
        toolName: 'Bash',
        cwd,
        maxLabelWidth: 24,
      }),
    ).toBeNull()
  })

  test('returns null when tool name already contains ellipsis', () => {
    expect(
      renderDontAskAgainLabel({
        toolName: 'Very…Long',
        cwd: '/tmp',
        maxLabelWidth: 80,
      }),
    ).toBeNull()
  })

  test('returns null when cwd already contains ellipsis', () => {
    expect(
      renderDontAskAgainLabel({
        toolName: 'Bash',
        cwd: '/tmp/…/x',
        maxLabelWidth: 80,
      }),
    ).toBeNull()
  })

  test('dontAskAgainMaxLabelWidth first-frame mirrors SEA Aa0 then -8', () => {
    expect(initialDontAskAgainSelectWidth(80)).toBe(40)
    expect(dontAskAgainMaxLabelWidth(80)).toBe(32)
    expect(dontAskAgainMaxLabelWidth(10)).toBe(
      Math.max(20, Math.min(40, 10 - 6)) - 8,
    )
  })

  test('first-frame budget 32 withholds Bash /tmp/proj DAA', () => {
    expect(
      renderDontAskAgainLabel({
        toolName: 'Bash',
        cwd: '/tmp/proj',
        maxLabelWidth: dontAskAgainMaxLabelWidth(80),
      }),
    ).toBeNull()
  })

  test('measured Select width (sVc Ilt-8) produces Bash /tmp/proj DAA', () => {
    // columns 80 → max(20, columns-6)=74; measured Select ~80 → tracked 78;
    // Ilt=min(78,74)=74 → maxLabelWidth 66. Full label is 55 cols.
    const maxLabelWidth = dontAskAgainMaxLabelWidthFromTracked(78, 80)
    expect(maxLabelWidth).toBe(66)
    expect(
      renderDontAskAgainLabel({
        toolName: 'Bash',
        cwd: '/tmp/proj',
        maxLabelWidth,
      }),
    ).toBe("Yes, and don't ask again for Bash commands in /tmp/proj")
  })
})

afterEach(() => {
  // no shared mocks
})
