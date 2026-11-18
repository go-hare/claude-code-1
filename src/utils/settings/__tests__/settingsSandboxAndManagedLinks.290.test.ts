import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  formatManagedDocumentLinkWarning,
  inspectManagedDocumentLink,
  parseSettingsFileContent,
} from '../settings.js'
import { filterAndWithholdSandboxRestrictions } from '../validation.js'

describe('v2.1.290 #10/#11: managed-settings outside link & withheld allowRead/allowedDomains', () => {
  test('#10: inspectManagedDocumentLink detects outside symlink and formats exact warning', () => {
    const root = mkdtempSync(join(tmpdir(), 'ms-link-290-'))
    const managedDir = join(root, 'managed')
    const outsideDir = join(root, 'outside')
    mkdirSync(managedDir)
    mkdirSync(outsideDir)
    const outsideFile = join(outsideDir, 'real-managed.json')
    writeFileSync(outsideFile, '{}')
    symlinkSync(outsideFile, join(managedDir, 'managed-settings.json'))

    try {
      const link = inspectManagedDocumentLink(managedDir, [
        'managed-settings.json',
      ])
      expect(link).not.toBeNull()
      expect(link!.kind).toBe('outside')
      const msg = formatManagedDocumentLinkWarning(link!, true)
      expect(msg).not.toBeNull()
      expect(msg![0]).toContain('is reached through a link that leads outside')
      expect(msg![0]).toContain('Claude Code still reads it.')
      expect(msg![1]).toContain(
        'Ask your administrator to replace the link with the file or folder it points to.',
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('#10: inspectManagedDocumentLink returns inside for internal symlink and null for regular file', () => {
    const root = mkdtempSync(join(tmpdir(), 'ms-inside-290-'))
    const managedDir = join(root, 'managed')
    mkdirSync(managedDir)
    const regular = join(managedDir, 'regular.json')
    writeFileSync(regular, '{}')
    symlinkSync(regular, join(managedDir, 'managed-settings.json'))

    try {
      const inside = inspectManagedDocumentLink(managedDir, [
        'managed-settings.json',
      ])
      expect(inside?.kind).toBe('inside')
      expect(formatManagedDocumentLinkWarning(inside!, true)).toBeNull()

      const plain = inspectManagedDocumentLink(managedDir, ['regular.json'])
      expect(plain).toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('#11: withholds allowedDomains when deniedDomains is unreadable or has invalid entry', () => {
    const raw = JSON.stringify({
      sandbox: {
        network: {
          deniedDomains: [123, 'bad.example.com'],
          allowedDomains: ['good.example.com'],
        },
      },
    })
    const parsed = parseSettingsFileContent(raw, '/tmp/test-settings.json')
    expect(parsed.settings).not.toBeNull()
    expect(parsed.settings?.sandbox?.network?.allowedDomains).toBeUndefined()
    expect(parsed.settings?.sandbox?.network?.deniedDomains).toEqual([
      'bad.example.com',
    ])
    expect(
      parsed.errors.some(
        e =>
          e.path === 'sandbox.network.allowedDomains' &&
          e.message.includes('"allowedDomains" was withheld because'),
      ),
    ).toBe(true)
  })

  test('#11: withholds allowRead and allowWrite when denyRead is non-array', () => {
    const data = {
      sandbox: {
        filesystem: {
          denyRead: 'not-an-array',
          allowRead: ['/tmp/ok'],
          allowWrite: ['/tmp/w'],
        },
      },
    }
    const warnings = filterAndWithholdSandboxRestrictions(
      data,
      '/tmp/test-fs.json',
    )
    expect(data.sandbox.filesystem.allowRead).toBeUndefined()
    expect(data.sandbox.filesystem.allowWrite).toBeUndefined()
    expect(
      warnings.some(
        w =>
          w.path === 'sandbox.filesystem.allowRead' &&
          w.message.includes('"allowRead" was withheld because "denyRead"'),
      ),
    ).toBe(true)
  })
})
