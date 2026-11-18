import { describe, expect, test } from 'bun:test'
import {
  SHELL_EXPORTS_DELIMITER,
  SHELL_EXPORTS_PROBE_SCRIPT,
  getSnapshotScript,
  parseShellExports,
} from '../ShellSnapshot.js'

describe('#981 ShellSnapshot env exports capture for Desktop Code tab', () => {
  test('parseShellExports extracts custom env vars and decodes escapes', () => {
    const stdout = [
      'noise before',
      SHELL_EXPORTS_DELIMITER,
      'MY_ZSH_VAR=hello%20world',
      'MULTILINE_VAR=line1%0Aline2%0D%25end',
      'PWD=/should/skip',
      'OLDPWD=/should/skip',
      'SHLVL=2',
      'LD_PRELOAD=/bad/lib.so',
      'DYLD_INSERT_LIBRARIES=/bad/dylib',
      'IFS=:',
      SHELL_EXPORTS_DELIMITER,
      'noise after',
    ].join('\n')

    const parsed = parseShellExports(stdout)
    expect(parsed.get('MY_ZSH_VAR')).toBe('hello%20world')
    expect(parsed.get('MULTILINE_VAR')).toBe('line1\nline2\r%end')
    expect(parsed.has('PWD')).toBe(false)
    expect(parsed.has('OLDPWD')).toBe(false)
    expect(parsed.has('SHLVL')).toBe(false)
    expect(parsed.has('LD_PRELOAD')).toBe(false)
    expect(parsed.has('DYLD_INSERT_LIBRARIES')).toBe(false)
    expect(parsed.has('IFS')).toBe(false)
  })

  test('parseShellExports returns empty map if delimiter is missing or duplicated', () => {
    expect(parseShellExports('FOO=bar').size).toBe(0)
    const dup = [
      SHELL_EXPORTS_DELIMITER,
      'FOO=1',
      SHELL_EXPORTS_DELIMITER,
      SHELL_EXPORTS_DELIMITER,
    ].join('\n')
    expect(parseShellExports(dup).size).toBe(0)
  })

  test('getSnapshotScript injects SHELL_EXPORTS_PROBE_SCRIPT only when captureShellExports is true', async () => {
    const withoutExports = await getSnapshotScript(
      '/bin/zsh',
      '/tmp/snap.sh',
      false,
      [],
      false,
    )
    expect(withoutExports).not.toContain(SHELL_EXPORTS_DELIMITER)

    const withExports = await getSnapshotScript(
      '/bin/zsh',
      '/tmp/snap.sh',
      false,
      [],
      true,
    )
    expect(withExports).toContain(SHELL_EXPORTS_PROBE_SCRIPT.trim())
  })
})
