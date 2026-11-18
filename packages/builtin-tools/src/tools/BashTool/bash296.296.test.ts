import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { posixPathToWindowsPath } from 'src/utils/windowsPaths.js'

describe('BashTool v2.1.292-296 alignment (#327, #535)', () => {
  test('#535: posixPathToWindowsPath normalizes Git Bash /c/Users/... and /cygdrive/c/Users/...', () => {
    expect(posixPathToWindowsPath('/c/Users/alice')).toBe('C:\\Users\\alice')
    expect(posixPathToWindowsPath('/cygdrive/c/Users/alice')).toBe(
      'C:\\Users\\alice',
    )
  })

  test('#327: BashToolResultMessage convenience note mentions changes by the command or another process', () => {
    const src = readFileSync(
      join(import.meta.dir, 'BashToolResultMessage.tsx'),
      'utf8',
    )
    expect(src).toContain(
      '(files that changed while this command ran, by the command or by another process; a convenience view, not a review or audit of the command)',
    )
  })
})
