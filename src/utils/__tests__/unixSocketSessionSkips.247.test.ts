/**
 * densable 2.1.247 — behaviours a `claude ssh` remote must suppress because the
 * credentials it can see are the launcher's placeholders, not the real ones.
 *
 * Mapping of every upstream ANTHROPIC_UNIX_SOCKET site onto our tree lives in
 * docs/upstream-extraction/v2.1.247/snippets/gold-unix-socket-map.txt.
 */
import { describe, expect, test } from 'bun:test'

async function read(rel: string): Promise<string> {
  return (await Bun.file(new URL(rel, import.meta.url)).text()).replace(
    /\s+/g,
    ' ',
  )
}

describe('api bootstrap under a unix-socket session', () => {
  test('is skipped, and the skip is instrumented', async () => {
    const src = await read('../../services/api/bootstrap.ts')
    expect(src).toContain('process.env.ANTHROPIC_UNIX_SOCKET')
    expect(src).toContain('[Bootstrap] Skipped: unix-socket-proxied session')
    expect(src).toContain('unix_socket_skip')
  })

  test('the skip lands before the request is built', async () => {
    const src = await read('../../services/api/bootstrap.ts')
    const skipAt = src.indexOf('unix-socket-proxied session')
    const endpointAt = src.indexOf('/api/claude_cli/bootstrap')
    expect(skipAt).toBeGreaterThan(-1)
    expect(endpointAt).toBeGreaterThan(skipAt)
  })

  test('upstream instruments only this skip, so the others stay debug-only', async () => {
    const src = await read('../../services/api/bootstrap.ts')
    for (const other of [
      'Skipped: Nonessential traffic disabled',
      'Skipped: 3P provider',
      'Skipped: no usable OAuth or API key',
    ]) {
      const at = src.indexOf(other)
      expect(at).toBeGreaterThan(-1)
      // No logEvent between this message and its `return null`.
      expect(src.slice(at, at + 80)).not.toContain('logEvent')
    }
  })
})

describe('settings-sourced env scrub under a unix-socket session', () => {
  test('drops the five auth vars the launcher owns', async () => {
    const src = await read('../managedEnv.ts')
    const at = src.indexOf('function withoutSSHTunnelVars')
    expect(at).toBeGreaterThan(-1)
    const body = src.slice(at, at + 900)
    for (const key of [
      'ANTHROPIC_UNIX_SOCKET',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'CLAUDE_CODE_OAUTH_TOKEN',
    ]) {
      expect(body).toContain(key)
    }
  })

  test('also drops artifact vars, which the local launcher wires up', async () => {
    const src = await read('../managedEnv.ts')
    const at = src.indexOf('function withoutSSHTunnelVars')
    const body = src.slice(at, at + 900)
    expect(body).toContain("startsWith('CLAUDE_CODE_ARTIFACT')")
    // Case-insensitive, matching upstream's uppercased Set lookup.
    expect(body).toContain('toUpperCase()')
  })

  test('the scrub only applies when a tunnel is actually in use', async () => {
    const src = await read('../managedEnv.ts')
    const at = src.indexOf('function withoutSSHTunnelVars')
    const body = src.slice(at, at + 900)
    expect(body).toContain('!process.env.ANTHROPIC_UNIX_SOCKET) return env')
  })
})
