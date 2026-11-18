import { describe, expect, test } from 'bun:test'
import { appendPluginBinPathsToPath } from './ShellSnapshot.js'
import { parseForSecurity } from './ast.js'

describe('#52 & #73 & #93 bash ast and shell snapshot', () => {
  test('#93 appendPluginBinPathsToPath appends new dirs and drops delimiter-containing dirs', () => {
    const res = appendPluginBinPathsToPath(
      '/usr/bin:/bin',
      ['/opt/plugin/bin', '/usr/bin', '/bad:path/bin'],
      ':',
    )
    expect(res.appended).toEqual(['/opt/plugin/bin'])
    expect(res.path).toBe('/usr/bin:/bin:/opt/plugin/bin')
  })

  test('#52 parseForSecurity handles empty command', async () => {
    const res = await parseForSecurity('')
    expect(res.kind).toBe('simple')
  })

  test('#73 parseForSecurity rejects unquoted heredoc by default and accepts plainUnquotedHeredocs option', async () => {
    const cmd = 'cat <<EOF | python3\nprint(1)\nEOF'
    const strict = await parseForSecurity(cmd)
    if (strict.kind !== 'parse-unavailable') {
      expect(strict.kind).toBe('too-complex')
      const relaxed = await parseForSecurity(cmd, {
        plainUnquotedHeredocs: true,
      })
      expect(relaxed.kind).toBe('simple')
    }
  })
})
