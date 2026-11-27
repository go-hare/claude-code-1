import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

describe('v2.1.290 #126 — MCP 403 early abort to needs-auth on claudeai-proxy', () => {
  test('connectToServer handles both 401 and 403 (status or code) for claudeai-proxy', () => {
    const clientDir = join(import.meta.dir, '../client')
    const clientSrc = [
      readFileSync(join(import.meta.dir, '../client.ts'), 'utf8'),
      ...readdirSync(clientDir)
        .filter(f => f.endsWith('.ts'))
        .sort()
        .map(f => readFileSync(join(clientDir, f), 'utf8')),
    ].join('\n')
    const idx = clientSrc.indexOf('claude.ai proxy connection failed after')
    expect(idx).toBeGreaterThan(-1)
    const slice = clientSrc.slice(idx, idx + 1200)
    expect(slice).toContain('error instanceof SdkHttpError')
    expect(slice).toContain('errorCode === 401 || errorCode === 403')
    expect(slice).toContain(
      "handleRemoteAuthFailure(name, serverRef, 'claudeai-proxy')",
    )
  })
})
