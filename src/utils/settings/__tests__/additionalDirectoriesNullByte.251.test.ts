import { describe, expect, test } from 'bun:test'
import { parseSettingsFileContent } from '../settings.js'
import { PermissionsSchema, SettingsSchema } from '../types.js'

describe('additionalDirectories null byte (251 #34)', () => {
  test('startup parse drops entries that contain a null byte', () => {
    const parsed = parseSettingsFileContent(
      JSON.stringify({
        permissions: {
          additionalDirectories: ['/ok', '/bad\u0000dir', 'also\0bad'],
        },
      }),
      'settings.json',
    )
    expect(parsed.errors).toEqual([])
    expect(parsed.settings?.permissions?.additionalDirectories).toEqual(['/ok'])
  })

  test('a directory that is only a null byte is dropped', () => {
    const result = PermissionsSchema().safeParse({
      additionalDirectories: ['\0'],
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.additionalDirectories).toEqual([])
  })

  test('directories without a null byte are kept', () => {
    const result = SettingsSchema().safeParse({
      permissions: { additionalDirectories: ['/tmp/extra', 'rel'] },
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.permissions?.additionalDirectories).toEqual([
      '/tmp/extra',
      'rel',
    ])
  })
})
