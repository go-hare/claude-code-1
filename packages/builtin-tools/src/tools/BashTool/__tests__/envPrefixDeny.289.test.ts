/**
 * densable 2.1.289 T4/eut — TZ="$HOME" rm still matches Bash(rm:*).
 */
import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from 'src/Tool.js'
import {
  bashToolCheckPermission,
  eutPeelArgv,
  stripAllLeadingEnvVars,
} from '../bashPermissions.js'

function denyRmContext() {
  return {
    ...getEmptyToolPermissionContext(),
    alwaysDenyRules: { session: ['Bash(rm:*)'] },
  }
}

describe('densable 2.1.289 TZ="$HOME" Bash deny strip', () => {
  test('eutPeelArgv peels TZ="$HOME" / TZ=$HOME argv tokens', () => {
    expect(eutPeelArgv(['TZ=$HOME', 'rm', '-rf', 'build'])).toEqual([
      'rm',
      '-rf',
      'build',
    ])
    expect(eutPeelArgv(['TZ=$HOME', 'rm'])).toEqual(['rm'])
  })

  test('string Eue analog still does not peel TZ="$HOME"', () => {
    expect(stripAllLeadingEnvVars('TZ="$HOME" rm -rf build')).toBe(
      'TZ="$HOME" rm -rf build',
    )
  })

  test('TZ="$HOME" rm -rf build matches Bash(rm:*) deny', () => {
    const result = bashToolCheckPermission(
      { command: 'TZ="$HOME" rm -rf build' },
      denyRmContext(),
    )
    expect(result.behavior).toBe('deny')
  })

  test('FOO=bar rm still matches via string env strip', () => {
    const result = bashToolCheckPermission(
      { command: 'FOO=bar rm -rf build' },
      denyRmContext(),
    )
    expect(result.behavior).toBe('deny')
  })
})
