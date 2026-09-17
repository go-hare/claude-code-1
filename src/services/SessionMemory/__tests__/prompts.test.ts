import {
  afterAll,
  beforeAll,
  describe,
  test,
  expect,
  mock,
  beforeEach,
} from 'bun:test'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'
import { logMock } from '../../../../tests/mocks/log.js'

// mock.module is process-global. Snapshot real modules, then flag-gate
// overrides (default OFF) so siblings see real getClaudeConfigHomeDir /
// getMainLoopModel even if this file's mock is last-write-wins.
let useMockForSessionMemory = false
const mockGetMainLoopModel = mock((..._args: unknown[]) => 'claude-opus-4-7')
const mockGetDisplayedEffortLevel = mock(
  (..._args: unknown[]): string => 'high',
)

const realModel = await import('src/utils/model/model.js')
const modelSnap = snapshotModuleExports(realModel)
mock.module('src/utils/model/model.js', () => ({
  ...modelSnap,
  getMainLoopModel: ((...args: unknown[]) =>
    useMockForSessionMemory
      ? mockGetMainLoopModel(...args)
      : (modelSnap.getMainLoopModel as (...a: unknown[]) => unknown)(
          ...args,
        )) as typeof modelSnap.getMainLoopModel,
}))

const realEnvUtils = await import('src/utils/envUtils.js')
const envUtilsSnap = snapshotModuleExports(realEnvUtils)
const realGetClaudeConfigHomeDir = envUtilsSnap.getClaudeConfigHomeDir as ((
  ...a: unknown[]
) => string) & {
  cache?: { clear?: () => void; get?: (k: unknown) => unknown }
}
mock.module('src/utils/envUtils.js', () => ({
  ...envUtilsSnap,
  getClaudeConfigHomeDir: Object.assign(
    () =>
      useMockForSessionMemory
        ? '/mock/home/.claude'
        : realGetClaudeConfigHomeDir(),
    {
      cache: {
        clear: () => realGetClaudeConfigHomeDir.cache?.clear?.(),
        get: (k: unknown) => realGetClaudeConfigHomeDir.cache?.get?.(k),
      },
    },
  ),
}))

const realEffort = await import('src/utils/effort.js')
const effortSnap = snapshotModuleExports(realEffort)
mock.module('src/utils/effort.js', () => ({
  ...effortSnap,
  getDisplayedEffortLevel: ((...args: unknown[]) =>
    useMockForSessionMemory
      ? mockGetDisplayedEffortLevel(...args)
      : (effortSnap.getDisplayedEffortLevel as (...a: unknown[]) => unknown)(
          ...args,
        )) as typeof effortSnap.getDisplayedEffortLevel,
}))

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/log.js', logMock)

const realTokenEstimation = await import('src/services/tokenEstimation.js')
const tokenEstimationSnap = snapshotModuleExports(realTokenEstimation)
mock.module('src/services/tokenEstimation.js', () => ({
  ...tokenEstimationSnap,
  roughTokenCountEstimation: mock((s: string) => Math.ceil(s.length / 4)),
  countTokens: mock(async () => 0),
}))

beforeAll(() => {
  useMockForSessionMemory = true
})
afterAll(() => {
  useMockForSessionMemory = false
})

// Mock fs/promises so loadSessionMemoryPrompt() and loadSessionMemoryTemplate()
// return our controlled templates. Once afterAll flips
// useMockForSessionMemory off, readFile delegates to the real impl so
// sibling tests in the same process (skill prefetch, skillLearning smoke)
// still see real disk reads. We must list every export the prefetch /
// skillLearning paths use so this process-global mock doesn't strip names
// to undefined.
//
// Instead of pre-importing node:fs/promises (which can interact poorly
// with bun:test mock processing), use require() at mock-factory-call time
// to fetch the real module lazily.
const mockReadFileFsPromises = mock(
  async (_path: string, _opts?: unknown): Promise<string> => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  },
)

mock.module('fs/promises', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const real = require('node:fs/promises') as Record<string, unknown>
  return {
    ...real,
    readFile: ((path: unknown, opts?: unknown) => {
      if (useMockForSessionMemory) {
        return mockReadFileFsPromises(path as string, opts)
      }
      return (real.readFile as (...a: unknown[]) => unknown)(
        path as string,
        opts,
      )
    }) as typeof real.readFile,
  }
})

// ── Import module under test (after all mock.module calls) ──────────────────
import { buildSessionMemoryUpdatePrompt } from '../prompts.js'

// ── Tests ───────────────────────────────────────────────────────────────────

describe('buildSessionMemoryUpdatePrompt – dynamic variable substitution', () => {
  beforeEach(() => {
    mockGetMainLoopModel.mockReturnValue('claude-opus-4-7')
    mockGetDisplayedEffortLevel.mockReturnValue('high')
    // Default: ENOENT so the built-in default prompt is used
    mockReadFileFsPromises.mockImplementation(async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
  })

  test('substitutes {{CLAUDE_MODEL}} with the current model', async () => {
    mockReadFileFsPromises.mockImplementation(async (path: string) => {
      if ((path as string).includes('prompt.md'))
        return 'Model: {{CLAUDE_MODEL}}'
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    mockGetMainLoopModel.mockReturnValue('claude-opus-4-7')

    const result = await buildSessionMemoryUpdatePrompt('notes', '/notes.md')
    expect(result).toContain('Model: claude-opus-4-7')
    expect(result).not.toContain('{{CLAUDE_MODEL}}')
  })

  test('substitutes {{CLAUDE_EFFORT}} with the current effort level', async () => {
    mockReadFileFsPromises.mockImplementation(async (path: string) => {
      if ((path as string).includes('prompt.md'))
        return 'Effort: {{CLAUDE_EFFORT}}'
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    mockGetDisplayedEffortLevel.mockReturnValue('high')

    const result = await buildSessionMemoryUpdatePrompt('notes', '/notes.md')
    expect(result).toContain('Effort: high')
    expect(result).not.toContain('{{CLAUDE_EFFORT}}')
  })

  test('substitutes {{CLAUDE_CWD}} with process.cwd()', async () => {
    mockReadFileFsPromises.mockImplementation(async (path: string) => {
      if ((path as string).includes('prompt.md')) return 'CWD: {{CLAUDE_CWD}}'
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    const result = await buildSessionMemoryUpdatePrompt('notes', '/notes.md')
    expect(result).toContain(`CWD: ${process.cwd()}`)
    expect(result).not.toContain('{{CLAUDE_CWD}}')
  })

  test('substitutes all three dynamic variables in one template', async () => {
    mockReadFileFsPromises.mockImplementation(async (path: string) => {
      if ((path as string).includes('prompt.md'))
        return 'effort={{CLAUDE_EFFORT}} model={{CLAUDE_MODEL}} cwd={{CLAUDE_CWD}}'
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    mockGetMainLoopModel.mockReturnValue('claude-sonnet-4-6')
    mockGetDisplayedEffortLevel.mockReturnValue('medium')

    const result = await buildSessionMemoryUpdatePrompt('notes', '/notes.md')
    expect(result).toContain('effort=medium')
    expect(result).toContain('model=claude-sonnet-4-6')
    expect(result).toContain(`cwd=${process.cwd()}`)
  })

  test('leaves unknown template variables unchanged', async () => {
    mockReadFileFsPromises.mockImplementation(async (path: string) => {
      if ((path as string).includes('prompt.md'))
        return '{{UNKNOWN_VAR}} {{CLAUDE_MODEL}}'
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    mockGetMainLoopModel.mockReturnValue('claude-opus-4-7')

    const result = await buildSessionMemoryUpdatePrompt('notes', '/notes.md')
    expect(result).toContain('{{UNKNOWN_VAR}}')
    expect(result).toContain('claude-opus-4-7')
  })

  test('existing substitution variables still work alongside new ones', async () => {
    mockReadFileFsPromises.mockImplementation(async (path: string) => {
      if ((path as string).includes('prompt.md'))
        return '{{notesPath}} effort={{CLAUDE_EFFORT}} model={{CLAUDE_MODEL}}'
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    mockGetMainLoopModel.mockReturnValue('claude-haiku')
    mockGetDisplayedEffortLevel.mockReturnValue('low')

    const result = await buildSessionMemoryUpdatePrompt('notes', '/notes.md')
    expect(result).toContain('/notes.md')
    expect(result).toContain('effort=low')
    expect(result).toContain('model=claude-haiku')
  })
})
