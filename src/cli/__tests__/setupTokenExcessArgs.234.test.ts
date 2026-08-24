/**
 * densable 2.1.234 #44 — setup-token allowExcessArguments(false).
 * Source-sniff both Commander registration sites (main + cli host).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../..')

function extractSetupTokenBlock(source: string): string {
  const idx = source.indexOf(".command('setup-token')")
  expect(idx).toBeGreaterThanOrEqual(0)
  return source.slice(idx, idx + 400)
}

describe('densable 2.1.234 #44 setup-token excess args', () => {
  test('registerCliHostCommands rejects excess arguments', () => {
    const src = readFileSync(
      join(ROOT, 'src/cli/registerCliHostCommands.ts'),
      'utf8',
    )
    const block = extractSetupTokenBlock(src)
    expect(block).toContain('.allowExcessArguments(false)')
  })

  test('main.tsx setup-token rejects excess arguments', () => {
    const src = readFileSync(join(ROOT, 'src/main.tsx'), 'utf8')
    const block = extractSetupTokenBlock(src)
    expect(block).toContain('.allowExcessArguments(false)')
  })
})
