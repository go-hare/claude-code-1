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

// mock.module is process-global. Snapshot + flag-gate (default OFF) so
// siblings keep real getClaudeConfigHomeDir / getMainLoopModel.
let useMockForMagicDocs = false
const mockGetMainLoopModel = mock((..._args: unknown[]) => 'claude-opus-4-7')
const mockGetDisplayedEffortLevel = mock(
  (..._args: unknown[]): string => 'high',
)

const realModel = await import('src/utils/model/model.js')
const modelSnap = snapshotModuleExports(realModel)
mock.module('src/utils/model/model.js', () => ({
  ...modelSnap,
  getMainLoopModel: ((...args: unknown[]) =>
    useMockForMagicDocs
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
      useMockForMagicDocs ? '/mock/home/.claude' : realGetClaudeConfigHomeDir(),
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
    useMockForMagicDocs
      ? mockGetDisplayedEffortLevel(...args)
      : (effortSnap.getDisplayedEffortLevel as (...a: unknown[]) => unknown)(
          ...args,
        )) as typeof effortSnap.getDisplayedEffortLevel,
}))

beforeAll(() => {
  useMockForMagicDocs = true
})
afterAll(() => {
  useMockForMagicDocs = false
})

// Mock the file system so loadMagicDocsPrompt() returns our controlled template
const mockReadFile = mock(
  async (_path: string, _opts?: unknown): Promise<string> => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  },
)

// IMPORTANT: mock.module is process-global and this file used to mock
// fsOperations wholesale (readdir → [], exists → false, …), which silently
// broke sibling tests that walk .claude/skills, probe git-tracked settings
// (realpathSync / lstatSync), etc. The real module is imported and
// snapshotted BEFORE the mock is registered, so once this suite finishes
// (useMockForMagicDocs flips to false) we fall through to the genuine
// getFsImplementation() — every sync/async method, no hand-rolled subset.
import * as realFsOperations from 'src/utils/fsOperations.js'

const fsOpsSnap = snapshotModuleExports(realFsOperations)

mock.module('src/utils/fsOperations.js', () => ({
  ...fsOpsSnap,
  getFsImplementation: () =>
    useMockForMagicDocs
      ? ({
          readFile: mockReadFile,
          writeFile: mock(async () => {}),
          exists: mock(async () => false),
          mkdir: mock(async () => {}),
          readdir: mock(async () => []),
          stat: mock(async () => ({})),
          unlink: mock(async () => {}),
        } as unknown)
      : fsOpsSnap.getFsImplementation(),
}))

// ── Import module under test (after all mock.module calls) ──────────────────
import { buildMagicDocsUpdatePrompt } from '../prompts.js'

// ── Tests ───────────────────────────────────────────────────────────────────

describe('buildMagicDocsUpdatePrompt – dynamic variable substitution', () => {
  beforeEach(() => {
    mockGetMainLoopModel.mockReturnValue('claude-opus-4-7')
    mockGetDisplayedEffortLevel.mockReturnValue('high')
    mockReadFile.mockImplementation(async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
  })

  test('substitutes {{CLAUDE_MODEL}} with the current model', async () => {
    mockReadFile.mockImplementation(async () => 'Model: {{CLAUDE_MODEL}}')
    mockGetMainLoopModel.mockReturnValue('claude-opus-4-7')

    const result = await buildMagicDocsUpdatePrompt(
      'contents',
      '/doc.md',
      'Title',
    )
    expect(result).toContain('Model: claude-opus-4-7')
    expect(result).not.toContain('{{CLAUDE_MODEL}}')
  })

  test('substitutes {{CLAUDE_EFFORT}} with the current effort level', async () => {
    mockReadFile.mockImplementation(async () => 'Effort: {{CLAUDE_EFFORT}}')
    mockGetDisplayedEffortLevel.mockReturnValue('high')

    const result = await buildMagicDocsUpdatePrompt(
      'contents',
      '/doc.md',
      'Title',
    )
    expect(result).toContain('Effort: high')
    expect(result).not.toContain('{{CLAUDE_EFFORT}}')
  })

  test('substitutes {{CLAUDE_CWD}} with process.cwd()', async () => {
    mockReadFile.mockImplementation(async () => 'CWD: {{CLAUDE_CWD}}')

    const result = await buildMagicDocsUpdatePrompt(
      'contents',
      '/doc.md',
      'Title',
    )
    expect(result).toContain(`CWD: ${process.cwd()}`)
    expect(result).not.toContain('{{CLAUDE_CWD}}')
  })

  test('substitutes all three dynamic variables in one template', async () => {
    mockReadFile.mockImplementation(
      async () =>
        'effort={{CLAUDE_EFFORT}} model={{CLAUDE_MODEL}} cwd={{CLAUDE_CWD}}',
    )
    mockGetMainLoopModel.mockReturnValue('claude-sonnet-4-6')
    mockGetDisplayedEffortLevel.mockReturnValue('medium')

    const result = await buildMagicDocsUpdatePrompt(
      'contents',
      '/doc.md',
      'Title',
    )
    expect(result).toContain('effort=medium')
    expect(result).toContain('model=claude-sonnet-4-6')
    expect(result).toContain(`cwd=${process.cwd()}`)
  })

  test('leaves unknown template variables unchanged', async () => {
    mockReadFile.mockImplementation(
      async () => '{{UNKNOWN_VAR}} {{CLAUDE_MODEL}}',
    )
    mockGetMainLoopModel.mockReturnValue('claude-opus-4-7')

    const result = await buildMagicDocsUpdatePrompt(
      'contents',
      '/doc.md',
      'Title',
    )
    expect(result).toContain('{{UNKNOWN_VAR}}')
    expect(result).toContain('claude-opus-4-7')
  })

  test('existing substitution variables still work alongside new ones', async () => {
    mockReadFile.mockImplementation(
      async () =>
        '{{docTitle}} effort={{CLAUDE_EFFORT}} model={{CLAUDE_MODEL}}',
    )
    mockGetMainLoopModel.mockReturnValue('claude-haiku')
    mockGetDisplayedEffortLevel.mockReturnValue('low')

    const result = await buildMagicDocsUpdatePrompt(
      'contents',
      '/doc.md',
      'My Doc',
    )
    expect(result).toContain('My Doc')
    expect(result).toContain('effort=low')
    expect(result).toContain('model=claude-haiku')
  })
})
