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

  test('offersBlockOutsideReads is gold Yes/Block/ask_again/one-off Yes (2.1.289)', () => {
    const options = getFilePermissionOptions({
      filePath: '/etc/hosts',
      toolPermissionContext: getEmptyToolPermissionContext(),
      operationType: 'read',
      offersBlockOutsideReads: true,
    })
    expect(options.map(o => o.option.type)).toEqual([
      'accept-once',
      'block-outside-reads',
      'ask-again-outside-reads',
      'allow-outside-read-once',
    ])
    expect(options.map(o => o.label)).toEqual([
      'Yes, and keep allowing any reads outside the working directories',
      'No, and block reads outside the working directories from now on',
      'No, and ask again next time',
      'Yes, but ask again next time',
    ])
  })
})
