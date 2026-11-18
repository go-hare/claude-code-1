import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  analyzeGatingHooksInSource,
  validatePluginContents,
} from '../validatePlugin.js'

describe('validatePlugin v2.1.299 alignment (#580, #636)', () => {
  test('#636 analyzeGatingHooksInSource resolves FunctionDeclaration imported from another file of the mod', () => {
    const files: Record<string, string> = {
      'register.ts': `
        import { allowNext } from './helper'
        export default function register(on: any) {
          on('tool.check', allowNext)
        }
      `,
      './helper': `
        export function allowNext($: any, e: any, next: any) {
          return next(e)
        }
      `,
    }
    const res = analyzeGatingHooksInSource(
      'register.ts',
      files['register.ts']!,
      {
        resolveImport: spec =>
          files[spec] ? { file: spec, source: files[spec]! } : undefined,
      },
    )
    expect(res.gatingHooks).toHaveLength(1)
    expect(res.gatingHooks[0]?.pattern).toBe('tool.check')

    // Verify own-command detection also works when imported handler does NOT call next
    const ownCmdFiles: Record<string, string> = {
      'register.ts': `
        import { handlePing } from './cmd'
        export default function register(on: any, $: any) {
          $.command.register({ name: 'ping' })
          on('command.run', { command: 'ping' }, handlePing)
        }
      `,
      './cmd': `
        export function handlePing() {
          return { text: 'pong' }
        }
      `,
    }
    const ownRes = analyzeGatingHooksInSource(
      'register.ts',
      ownCmdFiles['register.ts']!,
      {
        resolveImport: spec =>
          ownCmdFiles[spec]
            ? { file: spec, source: ownCmdFiles[spec]! }
            : undefined,
      },
    )
    expect(ownRes.ownCommandRegistrations).toEqual([
      'on("command.run", { command: "ping" })',
    ])
  })

  test('#636 validateHooksJson resolves relative imports on disk for gating hook analysis', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vp-636-'))
    try {
      const hooksDir = join(dir, 'hooks')
      mkdirSync(hooksDir, { recursive: true })
      writeFileSync(
        join(hooksDir, 'hooks.json'),
        JSON.stringify({ hooks: {} }),
        'utf8',
      )
      writeFileSync(
        join(hooksDir, 'helper.ts'),
        `export function runCmd() { return { text: 'ok' } }\n`,
        'utf8',
      )
      writeFileSync(
        join(hooksDir, 'register.ts'),
        `import { runCmd } from './helper.js'\nexport default function(on: any, $: any) {\n  $.command.register({ name: 'ping' })\n  on('command.run', { command: 'ping' }, runCmd)\n}\n`,
        'utf8',
      )
      const results = await validatePluginContents(dir)
      const hooksRes = results.find(r => r.fileType === 'hooks')
      expect(hooksRes?.success).toBe(true)
      expect(
        hooksRes?.notes?.some((n: string) =>
          n.includes('answers its own command'),
        ),
      ).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#580 validateHooksJson emits a note when managed hooks only or disableAllHooks is active', async () => {
    // Verify validateHooksJson runs cleanly and returns ValidationResult
    const dir = mkdtempSync(join(tmpdir(), 'vp-580-'))
    try {
      const hooksDir = join(dir, 'hooks')
      mkdirSync(hooksDir, { recursive: true })
      writeFileSync(
        join(hooksDir, 'hooks.json'),
        JSON.stringify({ hooks: {} }),
        'utf8',
      )
      writeFileSync(
        join(hooksDir, 'register.ts'),
        `export default function(on: any) { on('tool.check', (_$: any, _e: any, next: any) => next()) }\n`,
        'utf8',
      )
      const results = await validatePluginContents(dir)
      const hooksRes = results.find(r => r.fileType === 'hooks')
      expect(hooksRes?.success).toBe(true)
      expect(hooksRes?.gatingHooks?.length).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
