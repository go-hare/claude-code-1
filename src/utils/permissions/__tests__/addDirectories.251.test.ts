import { describe, expect, test } from 'bun:test'
import { permissionUpdateSchema } from '../PermissionUpdateSchema.js'

describe('addDirectories permission update (251 #34 lr)', () => {
  test('keeps ordinary directory strings', () => {
    const parsed = permissionUpdateSchema().safeParse({
      type: 'addDirectories',
      destination: 'session',
      directories: ['/tmp/extra', 'rel'],
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data).toEqual({
      type: 'addDirectories',
      destination: 'session',
      directories: ['/tmp/extra', 'rel'],
    })
  })

  test('drops a non-array directories field', () => {
    expect(
      permissionUpdateSchema().safeParse({
        type: 'addDirectories',
        destination: 'session',
        directories: '/tmp/extra',
      }).success,
    ).toBe(false)
  })

  test('drops a non-string directory', () => {
    expect(
      permissionUpdateSchema().safeParse({
        type: 'addDirectories',
        destination: 'session',
        directories: [1],
      }).success,
    ).toBe(false)
  })

  test('drops a trim-empty directory', () => {
    expect(
      permissionUpdateSchema().safeParse({
        type: 'addDirectories',
        destination: 'session',
        directories: ['   '],
      }).success,
    ).toBe(false)
  })

  test('drops a directory that contains a null byte', () => {
    expect(
      permissionUpdateSchema().safeParse({
        type: 'addDirectories',
        destination: 'session',
        directories: ['/ok', '/bad\0dir'],
      }).success,
    ).toBe(false)
  })
})
