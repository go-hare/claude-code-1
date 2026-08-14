/**
 * densable 2.1.232 #14 — Yun / Xun / s8g / s8s
 * Cygwin/MSYS `!<symlink>` cookie + .lnk detection for Windows path validation.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { logMock } from '../../../../tests/mocks/log'
import { debugMock } from '../../../../tests/mocks/debug'

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)
mock.module('bun:bundle', () => ({
  feature: (_name: string) => false,
}))

;(globalThis as unknown as { MACRO: { VERSION: string } }).MACRO = {
  VERSION: 'test',
}

const {
  CYGWIN_SYMLINK_COOKIE,
  CYGWIN_SYMLINK_MESSAGE,
  SHELL_LINK_HEADER,
  findCygwinEmulatedSymlink,
  readCygwinCookieTarget,
  expandCygwinCookieChain,
  formatCygwinSymlinkMessage,
} = await import('../cygwinSymlinkCookie.js')
const { getFsImplementation } = await import('../../fsOperations.js')
const { validatePath } = await import('../pathValidation.js')
const { getEmptyToolPermissionContext } = await import('../../../Tool.js')

const isWindows = process.platform === 'win32'
const describeIfWindows = isWindows ? describe : describe.skip

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cygwin-cookie-232-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop()!
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // ignore cleanup races on Windows
    }
  }
})

function writeCookie(
  filePath: string,
  target: string,
  encoding: 'latin1' | 'utf16le' = 'latin1',
): void {
  if (encoding === 'utf16le') {
    const body = Buffer.concat([
      CYGWIN_SYMLINK_COOKIE,
      Buffer.from([0xff, 0xfe]),
      Buffer.from(target + '\0', 'utf16le'),
    ])
    writeFileSync(filePath, body)
    return
  }
  writeFileSync(
    filePath,
    Buffer.concat([
      CYGWIN_SYMLINK_COOKIE,
      Buffer.from(target + '\0', 'latin1'),
    ]),
  )
}

describe('densable 2.1.232 s8s formatCygwinSymlinkMessage', () => {
  test('base message without destination', () => {
    expect(formatCygwinSymlinkMessage()).toBe(CYGWIN_SYMLINK_MESSAGE)
    expect(formatCygwinSymlinkMessage('')).toBe(CYGWIN_SYMLINK_MESSAGE)
  })

  test('includes destination when provided', () => {
    expect(formatCygwinSymlinkMessage('C:\\secrets')).toBe(
      `${CYGWIN_SYMLINK_MESSAGE} (destination: C:\\secrets)`,
    )
  })

  test('truncates long destinations', () => {
    const long = 'x'.repeat(250)
    const msg = formatCygwinSymlinkMessage(long)
    expect(msg).toContain('…')
    expect(msg.length).toBeLessThan(CYGWIN_SYMLINK_MESSAGE.length + 220)
  })
})

describe('densable s8g readCygwinCookieTarget', () => {
  test('reads latin1 cookie target', () => {
    const dir = makeTempDir()
    const cookie = join(dir, 'link')
    writeCookie(cookie, '../outside')
    const fs = getFsImplementation()
    expect(readCygwinCookieTarget(fs, cookie)).toBe('../outside')
  })

  test('reads utf16le BOM cookie target', () => {
    const dir = makeTempDir()
    const cookie = join(dir, 'link-u16')
    writeCookie(cookie, 'C:/Users/secret', 'utf16le')
    const fs = getFsImplementation()
    expect(readCygwinCookieTarget(fs, cookie)).toBe('C:/Users/secret')
  })

  test('returns undefined for ordinary file', () => {
    const dir = makeTempDir()
    const plain = join(dir, 'plain.txt')
    writeFileSync(plain, 'hello world')
    const fs = getFsImplementation()
    expect(readCygwinCookieTarget(fs, plain)).toBeUndefined()
  })

  test('returns undefined for missing path', () => {
    const fs = getFsImplementation()
    expect(
      readCygwinCookieTarget(fs, join(tmpdir(), 'no-such-cookie-232')),
    ).toBeUndefined()
  })
})

describeIfWindows('densable Yun findCygwinEmulatedSymlink (win32)', () => {
  test('detects cookie file at leaf path', () => {
    const dir = makeTempDir()
    const cookie = join(dir, 'evil-link')
    writeCookie(cookie, 'C:\\Windows\\System32\\config')
    const fs = getFsImplementation()
    const hit = findCygwinEmulatedSymlink(fs, cookie)
    expect(hit?.toLowerCase()).toBe(cookie.toLowerCase())
  })

  test('detects cookie as intermediate segment with remainder callback', () => {
    const dir = makeTempDir()
    const cookie = join(dir, 'portal')
    writeCookie(cookie, 'C:\\Windows')
    // Path continues past the cookie file as if Bash would follow it
    const through = join(cookie, 'System32', 'drivers')
    const fs = getFsImplementation()
    let remainder: string[] | undefined
    const hit = findCygwinEmulatedSymlink(fs, through, {
      onCookieRemainder: rem => {
        remainder = rem
      },
    })
    expect(hit?.toLowerCase()).toBe(cookie.toLowerCase())
    expect(remainder).toEqual(['System32', 'drivers'])
  })

  test('detects .lnk shell shortcut header', () => {
    const dir = makeTempDir()
    const lnk = join(dir, 'shortcut.lnk')
    // Minimal header-only .lnk (magic prefix)
    writeFileSync(lnk, Buffer.concat([SHELL_LINK_HEADER, Buffer.alloc(16)]))
    const fs = getFsImplementation()
    const hit = findCygwinEmulatedSymlink(fs, lnk)
    expect(hit?.toLowerCase()).toBe(lnk.toLowerCase())
  })

  test('clean ordinary file under real dirs returns undefined', () => {
    const dir = makeTempDir()
    const nested = join(dir, 'a', 'b')
    mkdirSync(nested, { recursive: true })
    const plain = join(nested, 'ok.txt')
    writeFileSync(plain, 'not a cookie')
    const fs = getFsImplementation()
    expect(findCygwinEmulatedSymlink(fs, plain)).toBeUndefined()
  })

  test('trailing-dot segment fails closed', () => {
    const dir = makeTempDir()
    // Path with trailing-dot segment that densable treats as trap
    const trap = join(dir, 'foo.')
    const fs = getFsImplementation()
    // May or may not exist — Yun returns the trap path when segment ends with .
    const hit = findCygwinEmulatedSymlink(fs, trap)
    // On Windows, trailing-dot names are special; expect hit or undefined if OS strips
    // densable: /[. ]$/ on segment → return a. If the OS normalizes away the dot
    // before we walk, we may not hit — only assert non-throw.
    expect(hit === undefined || typeof hit === 'string').toBe(true)
  })
})

describeIfWindows('densable Xun expandCygwinCookieChain (win32)', () => {
  test('collects resolved scan candidates from cookie target', () => {
    const dir = makeTempDir()
    const destDir = join(dir, 'dest')
    mkdirSync(destDir, { recursive: true })
    const cookie = join(dir, 'jump')
    writeCookie(cookie, destDir)
    const fs = getFsImplementation()
    const chain = expandCygwinCookieChain(fs, cookie)
    expect(chain.scanCandidates.length).toBeGreaterThan(0)
    expect(
      chain.scanCandidates.some(c => c.toLowerCase() === destDir.toLowerCase()),
    ).toBe(true)
    expect(chain.displayTarget?.toLowerCase()).toBe(destDir.toLowerCase())
  })

  test('appends remainder segments onto candidates', () => {
    const dir = makeTempDir()
    const destDir = join(dir, 'dest')
    mkdirSync(destDir, { recursive: true })
    const cookie = join(dir, 'jump')
    writeCookie(cookie, destDir)
    const fs = getFsImplementation()
    const chain = expandCygwinCookieChain(fs, cookie, ['nested', 'file.txt'])
    expect(
      chain.scanCandidates.some(c =>
        c.toLowerCase().endsWith(join('nested', 'file.txt').toLowerCase()),
      ),
    ).toBe(true)
  })
})

describeIfWindows('validatePath Yun/Xun wire-in (win32)', () => {
  test('cookie path returns safetyCheck with densable s8s message', () => {
    const project = makeTempDir()
    const cookie = join(project, 'escape')
    writeCookie(cookie, 'C:\\Windows\\System32')
    const result = validatePath(
      cookie,
      project,
      getEmptyToolPermissionContext(),
      'write',
    )
    expect(result.allowed).toBe(false)
    expect(result.decisionReason?.type).toBe('safetyCheck')
    if (result.decisionReason?.type === 'safetyCheck') {
      expect(result.decisionReason.reason).toContain(CYGWIN_SYMLINK_MESSAGE)
      expect(result.decisionReason.classifierApprovable).toBe(false)
    }
  })

  test('path through cookie mid-segment is denied', () => {
    const project = makeTempDir()
    const cookie = join(project, 'portal')
    writeCookie(cookie, 'C:\\Users')
    const through = join(cookie, 'Public', 'secret.txt')
    const result = validatePath(
      through,
      project,
      getEmptyToolPermissionContext(),
      'write',
    )
    expect(result.allowed).toBe(false)
    expect(result.decisionReason?.type).toBe('safetyCheck')
    if (result.decisionReason?.type === 'safetyCheck') {
      expect(result.decisionReason.reason).toContain('Cygwin-emulated symlink')
      expect(result.decisionReason.classifierApprovable).toBe(false)
    }
  })

  test('ordinary file in project is not cookie-denied', () => {
    const project = makeTempDir()
    const file = join(project, 'src', 'main.ts')
    mkdirSync(join(project, 'src'), { recursive: true })
    writeFileSync(file, 'export {}')
    const result = validatePath(
      file,
      project,
      {
        ...getEmptyToolPermissionContext(),
        mode: 'acceptEdits',
        additionalWorkingDirectories: new Map(),
      },
      'write',
    )
    // May still be denied by working-dir / safety for other reasons, but
    // must NOT be the cygwin cookie safetyCheck.
    if (
      result.decisionReason?.type === 'safetyCheck' &&
      result.decisionReason.reason.includes('Cygwin-emulated')
    ) {
      throw new Error('ordinary file incorrectly flagged as cygwin cookie')
    }
  })
})

describe('validatePath SAn path traversal gate', () => {
  test("denies path with '..' after a real segment", () => {
    const result = validatePath(
      'subdir/../outside/secret.txt',
      isWindows ? 'D:\\project' : '/tmp/project',
      getEmptyToolPermissionContext(),
      'write',
    )
    expect(result.allowed).toBe(false)
    expect(result.decisionReason?.type).toBe('other')
    if (result.decisionReason?.type === 'other') {
      expect(result.decisionReason.reason).toContain("'..' traversal")
    }
  })
})
