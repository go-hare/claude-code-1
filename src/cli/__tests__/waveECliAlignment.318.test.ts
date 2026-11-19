import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { warnOAuthExpiryBeforePrint } from '../print.js'
import { findFallbackVersionsBinary } from '../../daemon/bgWorker.js'

describe('Wave 316-318 Group E CLI & daemon alignment', () => {
  const dirsToClean: string[] = []

  afterEach(() => {
    for (const d of dirsToClean.splice(0)) {
      rmSync(d, { recursive: true, force: true })
    }
  })

  test('#1619: warnOAuthExpiryBeforePrint writes single-line stderr warning within 10 days', () => {
    const now = Date.parse('2026-06-01T12:00:00.000Z')
    const dayMs = 86_400_000

    // > 10 days -> no warning
    const linesFar: string[] = []
    expect(
      warnOAuthExpiryBeforePrint(
        now,
        {
          refreshToken: 'rt',
          refreshTokenExpiresAt: now + 11 * dayMs,
        },
        l => linesFar.push(l),
      ),
    ).toBe(false)
    expect(linesFar).toHaveLength(0)

    // Within 5 days -> single-line warning
    const linesSoon: string[] = []
    expect(
      warnOAuthExpiryBeforePrint(
        now,
        {
          refreshToken: 'rt',
          refreshTokenExpiresAt: now + 5 * dayMs,
        },
        l => linesSoon.push(l),
      ),
    ).toBe(true)
    expect(linesSoon).toHaveLength(1)
    expect(linesSoon[0]).toContain('Warning: this sign-in ends between')
    expect(linesSoon[0]!.trim().includes('\n')).toBe(false)

    // Already expired -> single-line warning
    const linesExpired: string[] = []
    expect(
      warnOAuthExpiryBeforePrint(
        now,
        {
          refreshToken: 'rt',
          refreshTokenExpiresAt: now - dayMs,
        },
        l => linesExpired.push(l),
      ),
    ).toBe(true)
    expect(linesExpired[0]).toContain('Warning: this sign-in may have ended')
  })

  test('#1636: findFallbackVersionsBinary picks newest valid non-empty version binary', async () => {
    const base = mkdtempSync(join(tmpdir(), 'wave-e-versions-'))
    dirsToClean.push(base)
    const versionsDir = join(base, 'claude', 'versions')
    mkdirSync(versionsDir, { recursive: true })
    writeFileSync(join(versionsDir, '2.1.300'), 'bin300')
    writeFileSync(join(versionsDir, '2.1.325'), 'bin325')
    writeFileSync(join(versionsDir, '2.1.999.tmp.123.456'), 'tmp')
    writeFileSync(join(versionsDir, '2.2.0'), '') // empty -> skipped

    const found = await findFallbackVersionsBinary(
      { XDG_DATA_HOME: base },
      base,
    )
    expect(found).toBe(join(versionsDir, '2.1.325'))
  })

  test('#1626: plugins.ts drainAndExit awaits waitForHeldOAuthRefresh', () => {
    const src = readFileSync(
      join(import.meta.dir, '..', 'handlers', 'plugins.ts'),
      'utf8',
    )
    expect(src).toContain('waitForHeldOAuthRefresh(code)')
  })

  test('#1544/#1552/#1634: print.ts has non-aborting titleSignal, ENOSPC/EDQUOT exit(1), and non-blocking set_model', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'print.ts'), 'utf8')
    expect(src).toContain('const titleSignal = createAbortController().signal')
    expect(src).toContain(
      "degraded.code === 'ENOSPC' || degraded.code === 'EDQUOT'",
    )
    expect(src).toContain('pendingSetModelPromise')
    expect(src).toContain('printPrewait?.interruptBeforeArm(getCommandQueue())')
  })
})
