import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  register as registerAgentsMd,
  USER_CONFIG,
} from '../../../../vendor/claude-code-mods/mods/agents-md/hooks/register.js'

const ROOT = join(import.meta.dir, '../../../..')

describe('v2.1.290 #57 & #101 bundled mods alignment', () => {
  test('#57 cc-plugin-you-should-know includes session Language instruction in suggest and explain prompts', () => {
    const src = readFileSync(
      join(
        ROOT,
        'vendor/claude-code-mods/mods/cc-plugin-you-should-know/hooks/register.ts',
      ),
      'utf8',
    )
    expect(src).toContain(
      'Write the title and the explanation in the language the session’s Language instruction names; if there is none, in the language the user has been writing in.',
    )
    expect(src).toContain(
      'Write the learn line, the title and the explanation in the language ',
    )
    expect(src).toContain(
      'Keep the labels learn:, tag:, explain:, the word none, and the tags You should know / Heads up exactly as written, in English.',
    )
    expect(src).toContain('plain-language explanation')
  })

  test('#101 cc-plugin-agents-md injects subdirectory AGENTS.md on Read and prompt.mention', async () => {
    expect(USER_CONFIG.instructionFiles.default).toBe('claude-md-or-agents-md')

    type Handler = ($: any, e: any, next: (ev: any) => Promise<any>) => any
    const hooks = new Map<string, Handler>()
    const on = (pattern: string, matcherOrFn: any, maybeFn?: any) => {
      const fn = typeof matcherOrFn === 'function' ? matcherOrFn : maybeFn
      hooks.set(pattern, fn)
    }
    registerAgentsMd(on, { instructionFiles: 'claude-md-or-agents-md' })

    expect(hooks.has('prompt.context')).toBe(true)
    expect(hooks.has('tool.call')).toBe(true)
    expect(hooks.has('prompt.mention')).toBe(true)
    expect(hooks.has('prompt.submit')).toBe(true)
    expect(hooks.has('turn.start')).toBe(true)
    expect(hooks.has('turn.complete')).toBe(true)
    expect(hooks.has('session.compact')).toBe(true)
    expect(hooks.has('command.run')).toBe(true)
    expect(hooks.has('agent.spawn')).toBe(true)

    const mock$: any = {
      env: { get: async () => undefined },
      session: {
        id: async () => 'sess-1',
        root: async () => '/repo',
        cwd: async () => '/repo',
      },
      store: { get: async () => undefined, set: async () => {} },
      telemetry: { log: async () => {}, mark: async () => {} },
      ui: { log: () => {} },
      fs: {
        ancestors: async ({ names, of }: { names: string[]; of?: string }) => {
          if (names.includes('CLAUDE.md')) return []
          if (of === '/repo/packages/app/src/index.ts') {
            return [
              {
                dir: '/repo/packages/app',
                parts: [
                  {
                    path: '/repo/packages/app/AGENTS.md',
                    content: 'App rules here',
                  },
                ],
              },
            ]
          }
          return []
        },
      },
    }

    // Initialize context at root (no CLAUDE.md, no root AGENTS.md)
    await hooks.get('prompt.context')!(
      mock$,
      { instructionFiles: [] },
      async (ev: any) => ev,
    )

    // Read inside /repo/packages/app/src/index.ts injects /repo/packages/app/AGENTS.md once
    const readRes1 = await hooks.get('tool.call')!(
      mock$,
      { tool: 'Read', file_path: '/repo/packages/app/src/index.ts' },
      async () => ({}),
    )
    expect(readRes1.context).toEqual([
      'Contents of /repo/packages/app/AGENTS.md:\n\nApp rules here',
    ])

    // Second Read in same directory is deduped
    const readRes2 = await hooks.get('tool.call')!(
      mock$,
      { tool: 'Read', file_path: '/repo/packages/app/src/index.ts' },
      async () => ({}),
    )
    expect(readRes2.context).toBeUndefined()
  })
})
