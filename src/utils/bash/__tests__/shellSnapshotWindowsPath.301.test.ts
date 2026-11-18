import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { windowsPathToPosixPath } from '../../windowsPaths.js'
import { probeWindowsBashPath } from '../ShellSnapshot.js'

describe('#699 Windows Bash PATH probe (probeWindowsBashPath)', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function makeFakeBash(scriptBody: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'cc-winpath-'))
    tempDirs.push(dir)
    const binPath = join(dir, 'fake-bash.sh')
    writeFileSync(binPath, `#!/bin/sh\n${scriptBody}\n`, 'utf8')
    chmodSync(binPath, 0o755)
    return binPath
  }

  test('returns POSIX PATH when binShell -lc outputs a valid /-prefixed path without semicolons', async () => {
    const fakeBash = makeFakeBash(
      'echo "banner line"\necho "/c/Program Files/Git/usr/bin:/usr/bin:/bin"',
    )
    const probed = await probeWindowsBashPath(fakeBash)
    expect(probed).toBe('/c/Program Files/Git/usr/bin:/usr/bin:/bin')
  })

  test('returns undefined when output contains Windows semicolons or is not /-prefixed', async () => {
    const fakeBashWin = makeFakeBash(
      'echo "C:\\\\Windows\\\\System32;C:\\\\Git\\\\bin"',
    )
    expect(await probeWindowsBashPath(fakeBashWin)).toBeUndefined()

    const fakeBashLiteral = makeFakeBash('echo "\\$PATH"')
    expect(await probeWindowsBashPath(fakeBashLiteral)).toBeUndefined()
  })

  test('returns undefined when binShell exits non-zero', async () => {
    const fakeBashFail = makeFakeBash('echo "/usr/bin:/bin"\nexit 1')
    expect(await probeWindowsBashPath(fakeBashFail)).toBeUndefined()
  })

  test('windowsPathToPosixPath converts drive and UNC paths for plugin bin dirs', () => {
    expect(windowsPathToPosixPath('C:\\Users\\dev\\.claude\\bin')).toBe(
      '/c/Users/dev/.claude/bin',
    )
    expect(windowsPathToPosixPath('\\\\server\\share\\bin')).toBe(
      '//server/share/bin',
    )
  })
})
