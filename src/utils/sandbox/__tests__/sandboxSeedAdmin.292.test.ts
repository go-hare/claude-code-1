import { describe, expect, test } from 'bun:test'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../envUtils.js'
import { convertToSandboxRuntimeConfig } from '../sandbox-adapter.js'

describe('sandbox-adapter #200 seed-admin isolation', () => {
  test('denies both reads and writes to ~/.claude/seed-admin', () => {
    const config = convertToSandboxRuntimeConfig({})
    const seedAdminDir = join(getClaudeConfigHomeDir(), 'seed-admin')
    expect(config.filesystem.denyRead).toContain(seedAdminDir)
    expect(config.filesystem.denyWrite).toContain(seedAdminDir)
  })
})
