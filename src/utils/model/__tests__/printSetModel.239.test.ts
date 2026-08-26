/**
 * Official 2.1.239 L4 leftover on the local print/SDK host:
 * family alias fable steps via XNn (getDefaultFableModel), not the haiku else.
 * Suggestion candidates include official qOe fable / fable[1m].
 */
import { afterEach, describe, expect, test } from 'bun:test'

import { ALL_MODEL_CONFIGS } from '../configs.js'
import { getDefaultFableModel } from '../model.js'
import {
  decidePrintSetModel,
  recognizePrintModel,
  stepFamilyAliasToAllowed,
  unrecognizedModelMessage,
} from '../printSetModel.js'

afterEach(() => {
  delete process.env.ANTHROPIC_DEFAULT_FABLE_MODEL
})

describe('printSetModel 239 fable leftover', () => {
  test('stepFamilyAliasToAllowed(fable) uses XNn, not haiku', () => {
    expect(stepFamilyAliasToAllowed('fable')).toBe(getDefaultFableModel())
    expect(stepFamilyAliasToAllowed('fable')).toBe(
      ALL_MODEL_CONFIGS.fable5.firstParty,
    )
    expect(stepFamilyAliasToAllowed('fable')?.includes('haiku')).toBe(false)
  })

  test('fable[1m] never steps to haiku', () => {
    const stepped = stepFamilyAliasToAllowed('fable[1m]')
    expect(stepped?.includes('haiku') ?? false).toBe(false)
  })

  test('haiku still maps to the haiku default', () => {
    const stepped = stepFamilyAliasToAllowed('haiku')
    expect(stepped).toBeTruthy()
    expect(stepped?.toLowerCase()).toContain('haiku')
  })

  test('print set_model recognizes fable', () => {
    expect(recognizePrintModel('fable').recognized).toBe(true)
    const d = decidePrintSetModel('fable', undefined)
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.model.toLowerCase()).toContain('fable')
  })

  test('unrecognized fab suggests fable', () => {
    expect(unrecognizedModelMessage('fab', 'fable')).toBe(
      'Model "fab" is not a recognized model id. Did you mean \'fable\'?',
    )
  })
})
