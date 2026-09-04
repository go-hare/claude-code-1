import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * densable 2.1.243 #19 — overflowing /login URL keeps leading columns.
 *
 * Official Zi: q = (Zo()?er:0)+F
 *   Zo = useIsInsideModal (T6a / S)
 *   er = Io = 2 (FullscreenLayout paddingX)
 *   F  = urlOutdent (default 0)
 * URL box: marginX: q?-q:void 0; hint boxes paddingX:q; Link assumeSupport:!0
 * /login + teleport: F = insideModal ? V(1) : U(2)  (Pane paddingX)
 * setup-token + onboarding: F = 1 (onboarding parent paddingLeft:1)
 */
describe('urlOutdent 243 #19', () => {
  const oauth = readFileSync(
    join(import.meta.dir, '../ConsoleOAuthFlow.tsx'),
    'utf8',
  )
  const login = readFileSync(
    join(import.meta.dir, '../../commands/login/login.tsx'),
    'utf8',
  )
  const teleport = readFileSync(
    join(import.meta.dir, '../TeleportError.tsx'),
    'utf8',
  )
  const setupToken = readFileSync(
    join(import.meta.dir, '../../cli/handlers/util.tsx'),
    'utf8',
  )
  const onboarding = readFileSync(
    join(import.meta.dir, '../Onboarding.tsx'),
    'utf8',
  )
  const pane = readFileSync(
    join(import.meta.dir, '../../../packages/@ant/ink/src/theme/Pane.tsx'),
    'utf8',
  )
  const link = readFileSync(
    join(import.meta.dir, '../../../packages/@ant/ink/src/components/Link.tsx'),
    'utf8',
  )

  test('Pane exports official U/V/Io (2 / 1 / 2)', () => {
    expect(pane).toContain('export const PANE_PADDING_X_MODAL = 1')
    expect(pane).toContain('export const PANE_PADDING_X_INLINE = 2')
    expect(pane).toContain('export const MODAL_LAYOUT_PADDING_X = 2')
    expect(pane).toContain('paddingX={PANE_PADDING_X_MODAL}')
    expect(pane).toContain('paddingX={PANE_PADDING_X_INLINE}')
  })

  test('Zi stacks q = (useIsInsideModal() ? Io : 0) + F', () => {
    expect(oauth).toContain('urlOutdent: urlOutdentProp = 0')
    expect(oauth).toContain(
      '(useIsInsideModal() ? MODAL_LAYOUT_PADDING_X : 0) + urlOutdentProp',
    )
    expect(oauth).toContain('marginX={urlOutdent ? -urlOutdent : undefined}')
    expect(oauth).toContain('paddingX={urlOutdent}')
    expect(oauth).toContain('assumeSupport')
  })

  test('Link assumeSupport forces OSC 8 wrap', () => {
    expect(link).toContain('assumeSupport = false')
    expect(link).toContain('assumeSupport || supportsHyperlinks()')
  })

  test('/login and teleport pass Pane paddingX as F', () => {
    expect(login).toContain(
      'useIsInsideModal() ? PANE_PADDING_X_MODAL : PANE_PADDING_X_INLINE',
    )
    expect(login).toContain('urlOutdent={urlOutdent}')
    expect(teleport).toContain(
      'useIsInsideModal() ? PANE_PADDING_X_MODAL : PANE_PADDING_X_INLINE',
    )
    expect(teleport).toContain('urlOutdent={urlOutdent}')
  })

  test('setup-token and onboarding pass F=1', () => {
    expect(setupToken).toContain('urlOutdent={1}')
    expect(onboarding).toContain('paddingLeft={1}')
    expect(onboarding).toContain('urlOutdent={1}')
  })
})
