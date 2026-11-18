import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const CLAUDE_API_DIR = join(import.meta.dir, '..', 'claude-api')

describe('claude-api skill v2.1.301 alignment (#844, #868)', () => {
  test('#844 OpenTelemetry tracing docs exist for all SDK languages and shared', () => {
    const expectedFiles = [
      'shared/opentelemetry.md',
      'csharp/claude-api/opentelemetry.md',
      'go/claude-api/opentelemetry.md',
      'java/claude-api/opentelemetry.md',
      'php/claude-api/opentelemetry.md',
      'python/claude-api/opentelemetry.md',
      'ruby/claude-api/opentelemetry.md',
      'typescript/claude-api/opentelemetry.md',
    ]
    for (const rel of expectedFiles) {
      const full = join(CLAUDE_API_DIR, rel)
      expect(existsSync(full)).toBe(true)
      expect(readFileSync(full, 'utf8').length).toBeGreaterThan(100)
    }
    const skillMd = readFileSync(join(CLAUDE_API_DIR, 'SKILL.md'), 'utf8')
    expect(skillMd).toContain('shared/opentelemetry.md')
    expect(skillMd).toContain('{lang}/claude-api/opentelemetry.md')
  })

  test('#868 shared/admin-api.md documents CMEK external-key endpoints on Claude Platform on AWS', () => {
    const adminApi = readFileSync(
      join(CLAUDE_API_DIR, 'shared/admin-api.md'),
      'utf8',
    )
    expect(adminApi).not.toContain(
      'CMEK external-key endpoints are not yet available there',
    )
    expect(adminApi).toContain('CMEK external-key')
    expect(adminApi).toContain('shared/claude-platform-on-aws.md')
    expect(
      existsSync(join(CLAUDE_API_DIR, 'shared/claude-platform-on-aws.md')),
    ).toBe(true)
  })
})
