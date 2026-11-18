import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildReplConfigArgv } from '../../../utils/forkReplayLaunchConfig.js'

describe('Official 2.1.293 #292 /tui preserves --chrome and --no-chrome', () => {
  test('buildReplConfigArgv includes --chrome or --no-chrome when chrome is defined', () => {
    expect(buildReplConfigArgv({ chrome: true })).toEqual(['--chrome'])
    expect(buildReplConfigArgv({ chrome: false })).toEqual(['--no-chrome'])
    expect(buildReplConfigArgv({})).toEqual([])
  })

  test('src/commands/tui/index.ts passes getChromeFlagOverride() via extraArgs', () => {
    const src = readFileSync(join(import.meta.dir, '../index.ts'), 'utf-8')
    expect(src).toContain('getChromeFlagOverride')
    expect(src).toContain("'--chrome'")
    expect(src).toContain("'--no-chrome'")
    expect(src).toContain('extraArgs: chromeExtraArgs')
  })
})
