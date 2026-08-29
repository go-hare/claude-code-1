/**
 * densable _Gw / xPl isHidden.
 * Gold: get isHidden(){return!jn()} on xPl; listing uses fqi on _Gw.
 */
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getIsInteractive, setIsInteractive } from '../../../bootstrap/state.js'
import { isAutoModeSetupSkillAllowed } from '../../../services/autoModeSetup/gates.js'
import { autoModeSetup, autoModeSetupNonInteractive } from '../index.js'

describe('auto-mode-setup command isHidden (densable _Gw/xPl)', () => {
  let previousInteractive: boolean

  beforeEach(() => {
    previousInteractive = getIsInteractive()
  })

  afterEach(() => {
    setIsInteractive(previousInteractive)
  })

  test('xPl isHidden is !getIsNonInteractiveSession()', () => {
    setIsInteractive(true)
    expect(autoModeSetupNonInteractive.isHidden).toBe(true)
    setIsInteractive(false)
    expect(autoModeSetupNonInteractive.isHidden).toBe(false)
  })

  test('_Gw isHidden is !fqi', () => {
    expect(autoModeSetup.isHidden).toBe(!isAutoModeSetupSkillAllowed())
  })

  test('COMMANDS() registers both _Gw and xPl', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../commands.ts'),
      'utf8',
    )
    expect(src).toContain('autoModeSetup')
    expect(src).toContain('autoModeSetupNonInteractive')
  })
})
