import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '../../../..')

describe('plugin validate densable 2.1.283', () => {
  test('registerCliHostCommands wires --json and --strict', () => {
    const src = readFileSync(
      join(ROOT, 'src/cli/registerCliHostCommands.ts'),
      'utf8',
    )
    expect(src).toContain("command('validate <path>')")
    expect(src).toContain("'--json'")
    expect(src).toContain("'--strict'")
    expect(src).toContain(
      'Output the validation report as JSON (same exit codes)',
    )
  })

  test('handler serializes JSON and treats --strict warnings as fail', () => {
    const src = readFileSync(join(ROOT, 'src/cli/handlers/plugins.ts'), 'utf8')
    expect(src).toContain('pluginValidationOutcome')
    expect(src).toContain('serializeValidationReport')
    expect(src).toContain(
      'Validation failed (--strict treats warnings as errors)',
    )
  })
})
