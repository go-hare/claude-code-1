/**
 * densable 2.1.283 Zp: client_composed → skipSlash + skipAttachments.
 * Security: @path must not expand when the SDK stamps verbatim_prompts.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '../../..')

describe('densable 2.1.283 client_composed / verbatim', () => {
  test('schema + print + QueryEngine stamp skipAttachments', () => {
    const schemas = readFileSync(
      join(ROOT, 'src/entrypoints/sdk/coreSchemas.ts'),
      'utf8',
    )
    expect(schemas).toContain('client_composed')
    expect(schemas).toContain('seeded_summon')
    const print = readFileSync(join(ROOT, 'src/cli/print.ts'), 'utf8')
    expect(print).toContain('userMsg.client_composed === true')
    expect(print).toContain('skipSlashCommands: true, skipAttachments: true')
    expect(print).toContain('skipAttachments: cmd.skipAttachments')
    const qe = readFileSync(join(ROOT, 'src/QueryEngine.ts'), 'utf8')
    expect(qe).toContain('skipAttachments: options?.skipAttachments')
  })

  test('processUserInput honors skipAttachments / skipSlashCommands', () => {
    const src = readFileSync(
      join(ROOT, 'src/utils/processUserInput/processUserInput.ts'),
      'utf8',
    )
    expect(src).toContain('skipAttachments')
    expect(src).toContain('shouldExtractAttachments')
    expect(src).toContain('!skipAttachments')
    expect(src).toContain('skipSlashCommands')
  })
})
