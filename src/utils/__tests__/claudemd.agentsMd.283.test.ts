import { afterAll, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import * as realSettings from 'src/utils/settings/settings.js'
import {
  createSettingsMock,
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../tests/mocks/settings.js'
import {
  DEFAULT_MODE,
  USER_CONFIG,
  isKeptWithoutInstructions,
  legacyModeOf,
  modeOf,
  register,
  unseenFiles,
  withProjectFiles,
} from '../../../vendor/claude-code-mods/mods/agents-md/hooks/register.js'

const settingsSnap = snapshotModuleExports(realSettings)

mock.module(
  'src/utils/settings/settings.js',
  createSettingsMock(settingsSnap, {
    getInitialSettings: () => ({}),
  }),
)

afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap)
})

type InstructionFile = {
  path: string
  kind: 'managed' | 'user' | 'project' | 'local' | 'memory'
  content: string
  parent?: string
}

function file(
  path: string,
  kind: InstructionFile['kind'],
  content: string,
): InstructionFile {
  return { path, kind, content }
}

describe('AGENTS.md densable 2.1.283 compositor', () => {
  test('USER_CONFIG is titled Project instructions with default fallback mode', () => {
    expect(USER_CONFIG.instructionFiles.title).toBe('Project instructions')
    expect(USER_CONFIG.instructionFiles.default).toBe(DEFAULT_MODE)
    expect(USER_CONFIG.instructionFiles.options).toEqual([
      'claude-md',
      'claude-md-or-agents-md',
      'claude-md-and-agents-md',
      'managed-only',
    ])
  })

  test('legacy projectInstructions maps onto instructionFiles modes', () => {
    expect(legacyModeOf('none')).toBe('managed-only')
    expect(legacyModeOf('claude')).toBe('claude-md')
    expect(legacyModeOf('agents-fallback')).toBe('claude-md-or-agents-md')
    expect(legacyModeOf('both')).toBe('claude-md-and-agents-md')
    expect(modeOf('not-a-mode')).toBe(DEFAULT_MODE)
  })

  test('managed-only prompt.context drops user/project/local files', async () => {
    const hooks: Array<{
      pattern: string
      hook: (
        api: unknown,
        event: Record<string, unknown>,
        next: (value?: unknown) => Promise<unknown>,
      ) => unknown
    }> = []
    register(
      (pattern: string, matcherOrHook: unknown, maybeHook?: unknown) => {
        const hook = maybeHook === undefined ? matcherOrHook : maybeHook
        hooks.push({
          pattern,
          hook: hook as (typeof hooks)[number]['hook'],
        })
      },
      { instructionFiles: 'managed-only' },
    )
    const context = hooks.find(hook => hook.pattern === 'prompt.context')
    expect(context).toBeDefined()
    const next = async (value: unknown) => value
    const returned = (await context!.hook(
      {},
      {
        instructionFiles: [
          file('/m', 'managed', 'keep'),
          file('/p', 'project', 'drop'),
          file('/u', 'user', 'drop'),
        ],
      },
      next,
    )) as { instructionFiles: InstructionFile[] }
    expect(returned.instructionFiles.map(item => item.kind)).toEqual([
      'managed',
    ])
    expect(isKeptWithoutInstructions(file('/n', 'memory', 'x'))).toBe(true)
  })

  test('unseenFiles skips path and content duplicates', () => {
    const existing = [file('/repo/CLAUDE.md', 'project', 'same')]
    const incoming = [
      file('/repo/AGENTS.md', 'project', 'same'),
      file('/repo/AGENTS.md', 'project', 'other'),
      file('/repo/nested/AGENTS.md', 'project', 'fresh'),
    ]
    expect(unseenFiles(incoming, existing).map(item => item.path)).toEqual([
      '/repo/AGENTS.md',
      '/repo/nested/AGENTS.md',
    ])
  })

  test('withProjectFiles inserts AGENTS.md among project files', () => {
    const existing = [
      file('/managed', 'managed', 'm'),
      file('/repo/CLAUDE.md', 'project', 'c'),
      file('/memory', 'memory', 'n'),
    ]
    const merged = withProjectFiles(existing, [
      file('/repo/AGENTS.md', 'project', 'a'),
    ])
    expect(merged.map(item => item.path)).toEqual([
      '/managed',
      '/repo/CLAUDE.md',
      '/repo/AGENTS.md',
      '/memory',
    ])
  })

  test('GEn walk no longer loads AGENTS.md (compositor injects)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agents-md-gen-'))
    writeFileSync(join(dir, 'AGENTS.md'), 'from agents')
    const { setOriginalCwd } = await import('../../bootstrap/state.js')
    setOriginalCwd(dir)
    const { getMemoryFiles, resetGetMemoryFilesCache } = await import(
      '../claudemd.js'
    )
    resetGetMemoryFilesCache()
    const files = await getMemoryFiles()
    expect(files.some(f => f.path.endsWith('AGENTS.md'))).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test('fallback prompt.context skips ancestor AGENTS.md when a descendant CLAUDE.md is on the walk', async () => {
    const hooks: Array<{
      pattern: string
      hook: (
        api: {
          session: { root: () => Promise<string> }
          fs: {
            ancestors: (input: {
              names: readonly string[]
            }) => Promise<unknown[]>
          }
        },
        event: Record<string, unknown>,
        next: (value?: unknown) => Promise<unknown>,
      ) => unknown
    }> = []
    register((pattern: string, matcherOrHook: unknown, maybeHook?: unknown) => {
      const hook = maybeHook === undefined ? matcherOrHook : maybeHook
      hooks.push({
        pattern,
        hook: hook as (typeof hooks)[number]['hook'],
      })
    })
    const context = hooks.find(hook => hook.pattern === 'prompt.context')
    expect(context).toBeDefined()
    const api = {
      session: { root: async () => '/repo/pkg' },
      fs: {
        ancestors: async (input: { names: readonly string[] }) => {
          if (input.names.includes('AGENTS.md')) {
            return [
              {
                dir: '/repo',
                name: 'AGENTS.md',
                content: 'PARENT',
                parts: [{ path: '/repo/AGENTS.md', content: 'PARENT' }],
              },
            ]
          }
          return []
        },
      },
      telemetry: { log: () => undefined, mark: () => undefined },
      ui: { log: () => undefined },
    }
    const next = async (value: unknown) => value
    const returned = (await context!.hook(
      api,
      {
        instructionFiles: [file('/repo/pkg/CLAUDE.md', 'project', 'CHILD')],
      },
      next,
    )) as { instructionFiles: InstructionFile[] }
    expect(
      returned.instructionFiles.some(item => item.path.endsWith('AGENTS.md')),
    ).toBe(false)
    expect(
      returned.instructionFiles.some(item => item.path.endsWith('CLAUDE.md')),
    ).toBe(true)
  })
})
