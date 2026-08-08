import { describe, test, expect } from 'bun:test'

describe('/daemon command', () => {
  test('index exports a valid Command', async () => {
    const mod = await import('../index.js')
    const cmd = mod.default
    expect(cmd.name).toBe('daemon')
    expect(cmd.type).toBe('local-jsx')
    expect(typeof cmd.load).toBe('function')
    // densable SEA: "Manage background services and routines"
    expect(cmd.description).toMatch(/background services and routines|daemon/i)
    expect(cmd.immediate).toBe(true)
  })

  test('daemon module exports call function', async () => {
    const mod = await import('../daemon.js')
    expect(typeof mod.call).toBe('function')
  })

  test('argumentHint lists subcommands including hub', async () => {
    const mod = await import('../index.js')
    const cmd = mod.default
    expect(cmd.argumentHint).toContain('status')
    expect(cmd.argumentHint).toContain('bg')
    expect(cmd.argumentHint).toContain('hub')
  })

  test('bare hub path loads DaemonHubDialog (source)', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(import.meta.dir, '../daemon.tsx'), 'utf8')
    expect(src).toContain('DaemonHubDialog')
    expect(src).toContain("sub === 'hub'")
  })
})
