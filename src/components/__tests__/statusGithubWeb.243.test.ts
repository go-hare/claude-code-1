import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'

describe('status GitHub web 243', () => {
  test('Status and tip use SEA GitHub-for-web copy', () => {
    const status = readFileSync(
      join(import.meta.dir, '../../utils/status.tsx'),
      'utf8',
    )
    expect(status).toContain("label: 'Claude Code on the web'")
    expect(status).toContain('GitHub connected')
    expect(status).toContain('Not set up · /web-setup to connect GitHub')

    const tips = readFileSync(
      join(import.meta.dir, '../../services/tips/tipRegistry.ts'),
      'utf8',
    )
    expect(tips).toContain("id: 'web-setup-github'")
    expect(tips).toContain(
      '/web-setup to use Claude Code on the web with the GitHub account gh is signed in to',
    )
  })
})
