import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  extractSandboxViolationSuffix,
  mergeBashStderr,
} from '../sandboxViolationResult.js'

const BLOCK = `<sandbox_violations>
Network denied: example.com (proxy 403)
</sandbox_violations>`

describe('sandbox violation on exit 0 243', () => {
  test('suffix is the appended violations block', () => {
    const stdout = 'HTTP/1.1 403 Forbidden\n'
    const annotated = `${stdout}\n${BLOCK}`
    expect(extractSandboxViolationSuffix(stdout, annotated)).toBe(BLOCK)
  })

  test('no suffix when annotate is a no-op', () => {
    expect(extractSandboxViolationSuffix('ok', 'ok')).toBe('')
  })

  test('success stderr is p, or [p, f] joined', () => {
    expect(mergeBashStderr('', BLOCK)).toBe(BLOCK)
    expect(mergeBashStderr('Shell cwd was reset to /tmp', BLOCK)).toBe(
      `Shell cwd was reset to /tmp\n${BLOCK}`,
    )
    expect(mergeBashStderr('Shell cwd was reset to /tmp', '')).toBe(
      'Shell cwd was reset to /tmp',
    )
  })

  test('BashTool success path merges violation suffix into stderr', () => {
    const src = readFileSync(join(import.meta.dir, '../BashTool.tsx'), 'utf8')
    expect(src).toContain('extractSandboxViolationSuffix')
    expect(src).toContain(
      'mergeBashStderr(stderrForShellReset, sandboxViolationSuffix',
    )
  })
})
