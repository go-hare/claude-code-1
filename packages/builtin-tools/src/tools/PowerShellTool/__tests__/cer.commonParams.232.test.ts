/**
 * densable 2.1.232 #13 — Cer / CUp: variable-writing common params must not
 * silently pass read-only when targeting preference vars.
 */
import { describe, expect, test } from 'bun:test'
import type { ParsedCommandElement } from 'src/utils/powershell/parser.js'
import {
  hasDangerousVariableWriteCommonParam,
  isVariableWritingCommonParam,
  PREFERENCE_VARIABLE_NAMES,
  VARIABLE_WRITING_COMMON_PARAMS,
} from '../commonParameters.js'
import { isAllowlistedCommand } from '../readOnlyValidation.js'

function cmd(name: string, args: string[]): ParsedCommandElement {
  const elementTypes = [
    'StringConstant',
    ...args.map(a =>
      a.startsWith('-') || a.startsWith('–') ? 'Parameter' : 'StringConstant',
    ),
  ] as ParsedCommandElement['elementTypes']
  return {
    name,
    nameType: 'cmdlet',
    elementType: 'CommandAst',
    text: [name, ...args].join(' '),
    args,
    elementTypes,
  }
}

describe('densable 2.1.232 Loi/Jka/CUp', () => {
  test('Loi full names are variable-writing', () => {
    for (const p of VARIABLE_WRITING_COMMON_PARAMS) {
      expect(isVariableWritingCommonParam(p)).toBe(true)
    }
  })

  test('short aliases -ov/-ev are variable-writing', () => {
    expect(isVariableWritingCommonParam('-ov')).toBe(true)
    expect(isVariableWritingCommonParam('-ev')).toBe(true)
  })

  test('CUp includes PSDefaultParameterValues', () => {
    expect(PREFERENCE_VARIABLE_NAMES.has('psdefaultparametervalues')).toBe(true)
    expect(PREFERENCE_VARIABLE_NAMES.has('erroractionpreference')).toBe(true)
  })
})

describe('densable Cer hasDangerousVariableWriteCommonParam', () => {
  test('OutVariable PSDefaultParameterValues is dangerous', () => {
    expect(
      hasDangerousVariableWriteCommonParam(
        ['file.txt', '-OutVariable', 'PSDefaultParameterValues'],
        ['StringConstant', 'StringConstant', 'Parameter', 'StringConstant'],
      ),
    ).toBe(true)
  })

  test('colon form -OutVariable:PSDefaultParameterValues is dangerous', () => {
    expect(
      hasDangerousVariableWriteCommonParam(
        ['file.txt', '-OutVariable:PSDefaultParameterValues'],
        ['StringConstant', 'StringConstant', 'Parameter'],
      ),
    ).toBe(true)
  })

  test('short -ov ErrorActionPreference is dangerous', () => {
    expect(
      hasDangerousVariableWriteCommonParam(
        ['-ov', 'ErrorActionPreference'],
        ['StringConstant', 'Parameter', 'StringConstant'],
      ),
    ).toBe(true)
  })

  test('normal -OutVariable result is safe', () => {
    expect(
      hasDangerousVariableWriteCommonParam(
        ['file.txt', '-OutVariable', 'result'],
        ['StringConstant', 'StringConstant', 'Parameter', 'StringConstant'],
      ),
    ).toBe(false)
  })

  test('dynamic $target is dangerous', () => {
    expect(
      hasDangerousVariableWriteCommonParam(
        ['-OutVariable', '$name'],
        ['StringConstant', 'Parameter', 'Variable'],
      ),
    ).toBe(true)
  })

  test('invalid scope is dangerous', () => {
    expect(
      hasDangerousVariableWriteCommonParam(
        ['-OutVariable', 'env:PATH'],
        ['StringConstant', 'Parameter', 'StringConstant'],
      ),
    ).toBe(true)
  })

  test('global:result is safe (scope ok, not preference)', () => {
    expect(
      hasDangerousVariableWriteCommonParam(
        ['-OutVariable', 'global:result'],
        ['StringConstant', 'Parameter', 'StringConstant'],
      ),
    ).toBe(false)
  })
})

describe('densable Ter: isAllowlistedCommand rejects Cer hits', () => {
  test('Get-Content -OutVariable PSDefaultParameterValues not allowlisted', () => {
    const c = cmd('Get-Content', [
      'readme.md',
      '-OutVariable',
      'PSDefaultParameterValues',
    ])
    expect(isAllowlistedCommand(c, c.text)).toBe(false)
  })

  test('Get-Content -ErrorAction SilentlyContinue not a Cer hit', () => {
    const c = cmd('Get-Content', [
      'readme.md',
      '-ErrorAction',
      'SilentlyContinue',
    ])
    expect(hasDangerousVariableWriteCommonParam(c.args, c.elementTypes)).toBe(
      false,
    )
  })

  test('Get-Content -OutVariable result not rejected by Cer alone', () => {
    const c = cmd('Get-Content', ['readme.md', '-OutVariable', 'result'])
    expect(hasDangerousVariableWriteCommonParam(c.args, c.elementTypes)).toBe(
      false,
    )
  })
})
