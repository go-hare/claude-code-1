/**
 * densable 2.1.247 #33 — J$ fail-close when admin managed settings unreadable.
 */
import { mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'
import {
  formatPolicyUnreadableFailClose,
  parseSettingsFile,
} from '../settings/settings.js'

describe('densable 2.1.247 #33 policy unreadable fail-close', () => {
  test('official fail-close message + Detail', () => {
    const message = formatPolicyUnreadableFailClose({
      file: '/etc/claude-code/managed-settings.json',
      message: '/etc/claude-code/managed-settings.json could not be read',
    })
    expect(message).toContain('Unable to read managed policy settings.')
    expect(message).toContain(
      'This machine may require organization login enforcement, but the policy file failed to load.',
    )
    expect(message).toContain('Contact your administrator.')
    expect(message).toContain(
      'Detail: /etc/claude-code/managed-settings.json: /etc/claude-code/managed-settings.json could not be read',
    )
  })

  test('Detail omits file prefix when file is absent', () => {
    const message = formatPolicyUnreadableFailClose({
      message: 'managed settings could not be read',
    })
    expect(message).toContain('Detail: managed settings could not be read')
  })

  test('parseSettingsFile records could not be read (not ENOENT)', () => {
    const dir = join(tmpdir(), `cc-247-policy-unreadable-${Date.now()}`)
    mkdirSync(dir)
    const { settings, errors } = parseSettingsFile(dir)
    expect(settings).toBeNull()
    expect(errors.some(e => e.message.includes('could not be read'))).toBe(true)
  })
})
