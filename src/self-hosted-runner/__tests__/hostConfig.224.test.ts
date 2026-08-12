/**
 * densable 2.1.224 #1 — host config snapshot filters (Qqv/ejv).
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HOST_CONFIG_MAX_BYTES,
  HOST_CONFIG_SKIP_NAMES,
  MCP_SERVER_TYPES,
  mcpServerEntryProblem,
  shouldIncludeHostConfigTopName,
  snapshotHostConfig,
} from '../hostConfig.js'

describe('densable 2.1.224 #1 hostConfig (Q2h/ejv)', () => {
  test('constants jUi/Qqv', () => {
    expect(HOST_CONFIG_MAX_BYTES).toBe(67_108_864)
    expect(HOST_CONFIG_SKIP_NAMES.has('projects')).toBe(true)
    expect(HOST_CONFIG_SKIP_NAMES.has('.credentials.json')).toBe(true)
    expect(MCP_SERVER_TYPES.has('stdio')).toBe(true)
    expect(MCP_SERVER_TYPES.has('streamable-http')).toBe(true)
  })

  test('shouldIncludeHostConfigTopName', () => {
    expect(shouldIncludeHostConfigTopName('settings.json')).toBe(true)
    expect(shouldIncludeHostConfigTopName('projects')).toBe(false)
    expect(shouldIncludeHostConfigTopName('.claude.json')).toBe(false)
    expect(shouldIncludeHostConfigTopName('.claude.json.backup')).toBe(false)
    expect(shouldIncludeHostConfigTopName('.config.json')).toBe(false)
    expect(shouldIncludeHostConfigTopName('.claude.json.bak')).toBe(false)
  })

  test('mcpServerEntryProblem (ejv)', () => {
    expect(mcpServerEntryProblem(null)).toMatch(/non-object/)
    expect(mcpServerEntryProblem({ url: 'http://x' })).toMatch(/no "type"/)
    expect(mcpServerEntryProblem({ type: 'stdio', command: 'npx' })).toBe(
      undefined,
    )
    expect(mcpServerEntryProblem({ type: 'bogus' })).toMatch(/unsupported type/)
    expect(mcpServerEntryProblem({ type: 1 })).toMatch(/non-string type/)
  })

  test('snapshotHostConfig walks slim dir', async () => {
    const dir = join(
      tmpdir(),
      `shr-hostcfg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    )
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'settings.json'), '{"a":1}')
    writeFileSync(join(dir, 'projects'), 'skip-me') // file named projects skipped at top
    const prev = process.env.SELF_HOSTED_RUNNER_HOST_CONFIG_DIR
    process.env.SELF_HOSTED_RUNNER_HOST_CONFIG_DIR = dir
    try {
      const statuses: string[] = []
      const snap = await snapshotHostConfig(m => statuses.push(m))
      expect(snap?.files.has('settings.json')).toBe(true)
      expect(snap?.files.has('projects')).toBe(false)
      expect(statuses.some(s => s.includes('host config snapshot'))).toBe(true)
    } finally {
      if (prev === undefined)
        delete process.env.SELF_HOSTED_RUNNER_HOST_CONFIG_DIR
      else process.env.SELF_HOSTED_RUNNER_HOST_CONFIG_DIR = prev
    }
  })
})
