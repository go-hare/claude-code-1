/**
 * densable 2.1.235 #12 / #7 coordination — contentWithheld omits accept-session.
 */
import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../../../Tool.js'
import { getFilePermissionOptions } from '../permissionOptions.js'

describe('getFilePermissionOptions contentWithheld (2.1.235)', () => {
  test('contentWithheld omits accept-session', () => {
    const options = getFilePermissionOptions({
      filePath: '/tmp/example.ts',
      toolPermissionContext: getEmptyToolPermissionContext(),
      operationType: 'write',
      contentWithheld: true,
    })
    expect(options.map(o => o.option.type)).toEqual(['accept-once', 'reject'])
    expect(options.some(o => o.option.type === 'accept-session')).toBe(false)
  })

  test('suppressPersistentAllow also omits accept-session', () => {
    const options = getFilePermissionOptions({
      filePath: '/tmp/example.ts',
      toolPermissionContext: getEmptyToolPermissionContext(),
      operationType: 'write',
      suppressPersistentAllow: true,
    })
    expect(options.map(o => o.option.type)).toEqual(['accept-once', 'reject'])
  })

  test('default still includes accept-session', () => {
    const options = getFilePermissionOptions({
      filePath: '/tmp/example.ts',
      toolPermissionContext: getEmptyToolPermissionContext(),
      operationType: 'write',
    })
    expect(options.some(o => o.option.type === 'accept-session')).toBe(true)
  })
})
