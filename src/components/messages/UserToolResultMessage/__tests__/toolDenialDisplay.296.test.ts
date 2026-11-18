import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  AUTOMODE_UNAVAILABLE_REASON,
  isAutomodeUnavailable,
} from '../UserToolErrorMessage.js'

describe('2.1.292 #231 & 2.1.296 #541 tool denial display', () => {
  test('#541 isAutomodeUnavailable matches automode-unavailable and automode-parsing-error when not verbose', () => {
    expect(isAutomodeUnavailable('automode-unavailable', false)).toBe(true)
    expect(isAutomodeUnavailable('automode-parsing-error', false)).toBe(true)
    expect(isAutomodeUnavailable('automode-unavailable', true)).toBe(false)
    expect(isAutomodeUnavailable('automode-blocked', false)).toBe(false)
    expect(isAutomodeUnavailable('permission-rule', false)).toBe(false)
    expect(AUTOMODE_UNAVAILABLE_REASON).toBe(
      "auto mode's check had no usable answer",
    )
  })

  test('#231 & #541 UserToolResultMessage passes toolDenialKind and isInterrupted; UserToolErrorMessage renders reason on permission-rule', () => {
    const resultSrc = readFileSync(
      join(import.meta.dir, '../UserToolResultMessage.tsx'),
      'utf8',
    )
    expect(resultSrc).toContain('toolDenialKind={toolDenialKind}')
    expect(resultSrc).toContain('isInterrupted={isInterrupted}')

    const rejectSrc = readFileSync(
      join(import.meta.dir, '../UserToolRejectMessage.tsx'),
      'utf8',
    )
    expect(rejectSrc).toContain('isInterrupted,')

    const errorSrc = readFileSync(
      join(import.meta.dir, '../UserToolErrorMessage.tsx'),
      'utf8',
    )
    expect(errorSrc).toContain("toolDenialKind === 'permission-rule'")
    expect(errorSrc).toContain('<AutomodeNotRunRow />')
    expect(errorSrc).toContain('dimColor')
  })
})
