/**
 * densable 2.1.289 permission Select stays on screen:
 * - plan teu: DA ScrollBox + flexShrink:0 Select sibling (not tot.bottom sticky)
 * - bash/powershell Cmy/tyy: Aa overflow:"hidden" around the command preview
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const dir = import.meta.dir

describe('plan teu Select sibling (not tot.bottom sticky)', () => {
  const src = readFileSync(
    join(
      dir,
      '../ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx',
    ),
    'utf8',
  )

  test('Select is a flexShrink:0 sibling of the plan ScrollBox', () => {
    expect(src).toContain('<ScrollBox')
    expect(src).toContain('flexShrink={0}')
    expect(src).toContain('Would you like to proceed?')
    expect(src).not.toContain('const useStickyFooter')
    expect(src).not.toContain('setStickyFooter(')
    expect(src).toContain('setStickyFooter?.(null)')
    expect(src).toContain('claimScrollBox(selectHeight)')
  })
})

describe('Aa overflow clip on bash/powershell command preview', () => {
  test('PermissionOverflowBox is gold Aa overflow:hidden dashed clip', () => {
    const src = readFileSync(join(dir, '../PermissionOverflowBox.tsx'), 'utf8')
    expect(src).toContain('overflow="hidden"')
    expect(src).toContain(
      "borderStyle={isScreenReaderModeEnabled() ? undefined : 'dashed'}",
    )
    expect(src).toContain('borderLeft={false}')
    expect(src).toContain('borderRight={false}')
  })

  test('bash Host wraps command preview in PermissionOverflowBox', () => {
    const src = readFileSync(
      join(dir, '../../../dialog/dialogs/PermissionBashDialog.tsx'),
      'utf8',
    )
    expect(src).toContain('<PermissionOverflowBox')
    expect(src).toContain('Do you want to proceed?')
  })

  test('powershell Host wraps command preview in PermissionOverflowBox', () => {
    const src = readFileSync(
      join(dir, '../../../dialog/dialogs/PermissionPowerShellDialog.tsx'),
      'utf8',
    )
    expect(src).toContain('<PermissionOverflowBox')
  })

  test('leftover PowerShellPermissionRequest wraps command preview in PermissionOverflowBox', () => {
    const src = readFileSync(
      join(
        dir,
        '../PowerShellPermissionRequest/PowerShellPermissionRequest.tsx',
      ),
      'utf8',
    )
    expect(src).toContain('<PermissionOverflowBox')
    expect(src).toContain('Do you want to proceed?')
  })

  test('OverflowBox is gold Aa overflow:hidden only (no flexGrow/minHeight)', () => {
    const src = readFileSync(join(dir, '../PermissionOverflowBox.tsx'), 'utf8')
    expect(src).toContain('overflow="hidden"')
    expect(src).not.toContain('flexGrow={1}')
    expect(src).not.toContain('minHeight={0}')
  })

  test('PermissionDialog has no leftover chrome budget', () => {
    const src = readFileSync(join(dir, '../PermissionDialog.tsx'), 'utf8')
    expect(src).not.toContain('PromptChromeBudgetContext')
    expect(src).not.toContain('chromeBudget')
  })

  test('Cmy/tyy Host pass innerPaddingX={0}', () => {
    const bash = readFileSync(
      join(dir, '../../../dialog/dialogs/PermissionBashDialog.tsx'),
      'utf8',
    )
    const ps = readFileSync(
      join(dir, '../../../dialog/dialogs/PermissionPowerShellDialog.tsx'),
      'utf8',
    )
    expect(bash).toContain('innerPaddingX={0}')
    expect(ps).toContain('innerPaddingX={0}')
  })

  test('leftover bash/powershell pass innerPaddingX={0}', () => {
    const bash = readFileSync(
      join(dir, '../BashPermissionRequest/BashPermissionRequest.tsx'),
      'utf8',
    )
    const ps = readFileSync(
      join(
        dir,
        '../PowerShellPermissionRequest/PowerShellPermissionRequest.tsx',
      ),
      'utf8',
    )
    expect(bash).toContain('innerPaddingX={0}')
    expect(ps).toContain('innerPaddingX={0}')
  })

  test('Xs gutter only when needsGutter / command has newline', () => {
    const gutter = readFileSync(
      join(dir, '../PermissionPreviewGutter.tsx'),
      'utf8',
    )
    expect(gutter).toContain("role: 'blockquote'")
    expect(gutter).toContain('if (!multiline)')
    expect(gutter).toContain('borderLeft')
    const bash = readFileSync(
      join(dir, '../BashPermissionRequest/BashPermissionRequest.tsx'),
      'utf8',
    )
    expect(bash).toContain('PermissionPreviewGutter')
    expect(bash).toContain("command.includes('\\n')")
    expect(bash).not.toContain('wrap="wrap"')
    const leftoverPs = readFileSync(
      join(
        dir,
        '../PowerShellPermissionRequest/PowerShellPermissionRequest.tsx',
      ),
      'utf8',
    )
    expect(leftoverPs).not.toContain('wrap="wrap"')
    expect(leftoverPs).toContain('PermissionPreviewGutter')
    const hostPs = readFileSync(
      join(dir, '../../../dialog/dialogs/PermissionPowerShellDialog.tsx'),
      'utf8',
    )
    expect(hostPs).toContain("preview.kind === 'full' && preview.needsGutter")
    expect(hostPs).not.toContain('wrap="wrap"')
    const host = readFileSync(
      join(dir, '../../../dialog/dialogs/PermissionBashDialog.tsx'),
      'utf8',
    )
    expect(host).toContain("preview.kind === 'full' && preview.needsGutter")
    expect(host).not.toContain('wrap="wrap"')
    expect(host).toContain('PermissionPreviewGutter')
    expect(hostPs).toContain('PermissionPreviewGutter')
  })
})
