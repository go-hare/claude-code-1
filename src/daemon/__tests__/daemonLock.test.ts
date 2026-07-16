import { describe, expect, test } from 'bun:test'
import { buildSpawnedByPayload, daemonSpawnedByLabel } from '../daemonLock.js'

describe('daemonSpawnedByLabel (official eAO)', () => {
  test('agents subcommand', () => {
    expect(daemonSpawnedByLabel(['agents'])).toBe('claude agents')
  })

  test('--bg flag', () => {
    expect(daemonSpawnedByLabel(['--bg', 'do stuff'])).toBe('claude --bg')
  })

  test('default', () => {
    expect(daemonSpawnedByLabel([])).toBe('claude')
    expect(daemonSpawnedByLabel(['mcp', 'list'])).toBe('claude')
  })
})

describe('buildSpawnedByPayload', () => {
  test('includes label cwd pid JSON', () => {
    const raw = buildSpawnedByPayload({
      label: 'claude agents',
      cwd: 'D:\\work',
      pid: 42,
    })
    expect(JSON.parse(raw)).toEqual({
      label: 'claude agents',
      cwd: 'D:\\work',
      pid: 42,
    })
  })
})
