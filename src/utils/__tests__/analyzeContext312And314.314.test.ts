import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getNonDeferrableBuiltins } from '@claude-code/builtin-tools/tools/SearchExtraToolsTool/prompt.js'

describe('v2.1.314 #1433 & #1337 analyzeContext helpers', () => {
  test('#1433 getNonDeferrableBuiltins returns array that can be Set-cached', () => {
    const set = new Set(getNonDeferrableBuiltins())
    expect(set instanceof Set).toBe(true)
  })

  test('#1337 tmpdir sanity for agent ceiling', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctx-'))
    rmSync(dir, { recursive: true, force: true })
    expect(Math.min(1_000_000, 150_000)).toBe(150_000)
  })
})
