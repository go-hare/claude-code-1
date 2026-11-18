;(globalThis as unknown as { MACRO: { VERSION: string } }).MACRO = {
  VERSION: '2.1.290',
}

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import { hasGlobBeforeDotDot, validatePath } from '../pathValidation.js'

describe('v2.1.290 #104 pathValidation brace & glob-before-dotdot checks', () => {
  test('rejects brace characters in write/create targets with gold reason', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pv290-'))
    try {
      const ctx = {
        ...getEmptyToolPermissionContext(),
        mode: 'acceptEdits' as const,
        additionalWorkingDirectories: new Map([
          [dir, { path: dir, source: 'session' as const }],
        ]),
      }
      for (const op of ['write', 'create'] as const) {
        const res = validatePath('{foo,bar}.txt', dir, ctx, op)
        expect(res.allowed).toBe(false)
        expect(res.decisionReason).toEqual({
          type: 'other',
          reason:
            'Brace characters in write target require manual approval — bash may brace-expand to paths outside the working directory',
        })
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('hasGlobBeforeDotDot detects globs and char-class brackets spanning ..', () => {
    expect(hasGlobBeforeDotDot('foo/*/../bar')).toBe(true)
    expect(hasGlobBeforeDotDot('foo/a[b/../c]')).toBe(true)
    expect(hasGlobBeforeDotDot('foo/bar/../baz')).toBe(false)
    expect(hasGlobBeforeDotDot('foo/bar/../*.ts')).toBe(false)
  })

  test('read with glob before .. triggers outsideReadsBlocked when blockReadsOutsideWorkingDirectories is true', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pv290-read-'))
    try {
      const ctx = {
        ...getEmptyToolPermissionContext(),
        blockReadsOutsideWorkingDirectories: true,
        additionalWorkingDirectories: new Map([
          [dir, { path: dir, source: 'session' as const }],
        ]),
      }
      const res = validatePath('sub/*/../secret.txt', dir, ctx, 'read')
      expect(res.allowed).toBe(false)
      expect(res.decisionReason?.type).toBe('safetyCheck')
      if (res.decisionReason?.type === 'safetyCheck') {
        expect(res.decisionReason.circuitBreaker).toBe('outsideReadsBlocked')
        expect(res.decisionReason.classifierApprovable).toBe(false)
        expect(res.decisionReason.reason).toContain("A glob before the '..'")
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('.. traversal surfaces explicit Read deny rule instead of generic traversal message', () => {
    const rawDir = mkdtempSync(join(tmpdir(), 'pv290-deny-'))
    const dir = realpathSync(rawDir)
    try {
      mkdirSync(join(dir, 'sub'), { recursive: true })
      const secret = join(dir, 'secret.txt')
      writeFileSync(secret, 'top-secret')
      const ctx = {
        ...getEmptyToolPermissionContext(),
        alwaysDenyRules: {
          userSettings: [`Read(//${secret.replace(/^\/+/, '')})`],
        },
        additionalWorkingDirectories: new Map([
          [dir, { path: dir, source: 'session' as const }],
        ]),
      }
      const res = validatePath('sub/../secret.txt', dir, ctx, 'read')
      expect(res.allowed).toBe(false)
      expect(res.decisionReason?.type).toBe('rule')
    } finally {
      rmSync(rawDir, { recursive: true, force: true })
    }
  })
})
