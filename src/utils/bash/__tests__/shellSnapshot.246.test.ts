/**
 * densable 2.1.246 #53 — bash snapshot functions via printf %q, no base64 subshell.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const SRC = readFileSync(join(import.meta.dir, '../ShellSnapshot.ts'), 'utf8')

describe('densable 2.1.246 #53 bash snapshot no base64', () => {
  test('bash dumps shopt before functions, then %q eval', () => {
    expect(SRC).toContain('# shopt before functions')
    expect(SRC).toContain('echo "# Shopt" >> "$SNAPSHOT_FILE"')
    expect(SRC).toContain(
      'printf \'eval %q > /dev/null 2>&1\\\\n\' "$(declare -f "$func")"',
    )
    expect(SRC).not.toContain('encoded_func=$(declare -f')
    expect(SRC).not.toContain('base64 -d')
    expect(SRC).not.toContain('LITERAL_BACKSLASH')
  })

  test('bash shell-options block no longer repeats shopt -p', () => {
    const optionsIdx = SRC.indexOf('echo "# Shell Options"')
    const bashOptions = SRC.slice(optionsIdx)
    expect(bashOptions).toContain('set -o | grep "on"')
    expect(bashOptions).toContain('shopt -s expand_aliases')
    expect(bashOptions.indexOf('shopt -p')).toBe(-1)
  })
})
