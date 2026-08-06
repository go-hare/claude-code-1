import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { clearBundledSkills, getBundledSkills } from '../../bundledSkills.js'
import { codeReview, simplify } from '../../../commands/codeReview.js'
import type { Command } from '../../../types/command.js'
import { registerVerifySkill } from '../verify.js'

describe('densable 2.1.215: /verify and /code-review user-only', () => {
  const prevUserType = process.env.USER_TYPE
  const g = globalThis as { MACRO?: { VERSION?: string } }
  let prevMacro: { VERSION?: string } | undefined

  beforeEach(() => {
    clearBundledSkills()
    process.env.USER_TYPE = 'ant'
    // registerBundledSkill uses MACRO.VERSION for extract path when files exist.
    prevMacro = g.MACRO
    g.MACRO = { ...(prevMacro ?? {}), VERSION: '0.0.0-test' }
  })

  afterEach(() => {
    clearBundledSkills()
    if (prevMacro === undefined) {
      delete g.MACRO
    } else {
      g.MACRO = prevMacro
    }
    if (prevUserType === undefined) {
      delete process.env.USER_TYPE
    } else {
      process.env.USER_TYPE = prevUserType
    }
  })

  test('registerVerifySkill sets disableModelInvocation + userInvocable', () => {
    registerVerifySkill()
    const verify = getBundledSkills().find(s => s.name === 'verify')
    expect(verify).toBeDefined()
    expect(verify?.userInvocable).toBe(true)
    expect(verify?.disableModelInvocation).toBe(true)
  })

  test('code-review command is user slash only; simplify stays model-callable', () => {
    const review = codeReview as Command
    const simp = simplify as Command
    expect(review.userInvocable).toBe(true)
    expect(review.disableModelInvocation).toBe(true)
    expect(simp.userInvocable).toBe(true)
    // densable omits the flag on /simplify — must stay model-callable
    expect(simp.disableModelInvocation).toBeFalsy()
  })
})
