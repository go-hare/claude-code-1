/**
 * densable 2.1.228 #2 — `uio` cwd-shadow filter for where.exe hits.
 */
import { describe, expect, test } from 'bun:test'
import { shouldSkipWhereCandidateAsCwdShadow } from '../windowsPaths.js'

describe('densable 2.1.228 #2 shouldSkipWhereCandidateAsCwdShadow (uio)', () => {
  test('rejects exact cwd directory (malicious git.bat in project root)', () => {
    expect(
      shouldSkipWhereCandidateAsCwdShadow(
        'D:\\work\\project\\git.exe',
        'D:\\work\\project',
      ),
    ).toBe(true)
  })

  test('rejects under cwd via node_modules shadow', () => {
    expect(
      shouldSkipWhereCandidateAsCwdShadow(
        'D:\\work\\project\\node_modules\\.bin\\git.exe',
        'D:\\work\\project',
      ),
    ).toBe(true)
  })

  test('rejects under cwd via .venv shadow', () => {
    expect(
      shouldSkipWhereCandidateAsCwdShadow(
        'D:\\work\\project\\.venv\\Scripts\\git.exe',
        'D:\\work\\project',
      ),
    ).toBe(true)
  })

  test('ALLOWS parent-of-git install (cwd is parent of exe dir)', () => {
    // densable 2.1.228: launched from C:\\Program Files\\Git — where hits
    // C:\\Program Files\\Git\\cmd\\git.exe must NOT be skipped.
    expect(
      shouldSkipWhereCandidateAsCwdShadow(
        'C:\\Program Files\\Git\\cmd\\git.exe',
        'C:\\Program Files\\Git',
      ),
    ).toBe(false)
  })

  test('ALLOWS install outside cwd tree entirely', () => {
    expect(
      shouldSkipWhereCandidateAsCwdShadow(
        'C:\\Program Files\\Git\\cmd\\git.exe',
        'D:\\work\\project',
      ),
    ).toBe(false)
  })

  test('ALLOWS non-shadow subdir under cwd (densable tradeoff: not every child is rejected)', () => {
    // densable 2.1.228: only exact-cwd, shadow dirs (node_modules/.venv/…),
    // WindowsApps alias — NOT arbitrary cwd/tools/git.exe. Document so we
    // do not re-tighten to “any child of cwd” by accident.
    expect(
      shouldSkipWhereCandidateAsCwdShadow(
        'D:\\work\\project\\tools\\git.exe',
        'D:\\work\\project',
      ),
    ).toBe(false)
    expect(
      shouldSkipWhereCandidateAsCwdShadow(
        'D:\\work\\project\\bin\\git.exe',
        'D:\\work\\project',
      ),
    ).toBe(false)
  })
})
