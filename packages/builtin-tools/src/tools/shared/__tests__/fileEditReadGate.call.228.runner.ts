/**
 * densable 2.1.228 #17 — FileWriteTool.call / FileEditTool.call integration
 * runner (isolated via fileEditReadGate.call.228.test.ts).
 *
 * Locks the call-path twin of validateInput guardSkipped: missing/partial
 * readFileState must not always throw FILE_UNEXPECTEDLY_MODIFIED when
 * non-legacy + MCt would skip the unread gate.
 *
 * Loaded only in a dedicated bun:test subprocess so process-global
 * mock.module cannot poison the full suite. Disk I/O is real (tmpdir).
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolPermissionContext, ToolUseContext } from 'src/Tool.js'
import { FILE_EDIT_TOOL_NAME } from '../../FileEditTool/constants.js'
import { FILE_UNEXPECTEDLY_MODIFIED_ERROR } from '../../FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '../../FileReadTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '../../FileWriteTool/prompt.js'

// Preload real modules BEFORE mock.module (process-global last-write-wins).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const requireActual = (relFromSrc: string): Record<string, unknown> =>
  require(`../../../../../../${relFromSrc}`) as Record<string, unknown>

const permissionLayerActual = requireActual(
  'src/engine/permissionLayerReaders.js',
)
const filesystemActual = requireActual('src/utils/permissions/filesystem.js')
const permissionsActual = requireActual('src/utils/permissions/permissions.js')
const diagnosticActual = requireActual('src/services/diagnosticTracking.js')
const lspManagerActual = requireActual('src/services/lsp/manager.js')
const lspDiagActual = requireActual('src/services/lsp/LSPDiagnosticRegistry.js')
const vscodeActual = requireActual('src/services/mcp/vscodeSdkMcp.js')
const skillsActual = requireActual('src/skills/loadSkillsDir.js')
const fileHistoryActual = requireActual('src/utils/fileHistory.js')
const fileOpAnalyticsActual = requireActual(
  'src/utils/fileOperationAnalytics.js',
)
const stampActual = requireActual('src/memdir/stampNewMemoryContent.js')
const gitDiffActual = requireActual('src/utils/gitDiff.js')
const analyticsActual = requireActual('src/services/analytics/index.js')
const growthbookActual = requireActual('src/services/analytics/growthbook.js')
const debugActual = requireActual('src/utils/debug.js')
const logActual = requireActual('src/utils/log.js')
const envUtilsActual = requireActual('src/utils/envUtils.js')

const getMainLoopModelMock = mock(() => 'claude-sonnet-4-6')
const getToolPermissionContextMock = mock(
  (): ToolPermissionContext =>
    ({
      mode: 'default',
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: false,
    }) as ToolPermissionContext,
)
const checkReadPermissionForToolMock = mock(() => ({
  behavior: 'allow' as const,
}))
const matchingRuleForInputMock = mock(() => null)
const getDenyRuleForToolMock = mock(() => null)
const getAskRuleForToolMock = mock(() => null)

function installMocks(): void {
  mock.module('src/engine/permissionLayerReaders.js', () => ({
    ...permissionLayerActual,
    getMainLoopModelFromLayers: getMainLoopModelMock,
    getToolPermissionContextFromLayers: getToolPermissionContextMock,
  }))
  mock.module('src/utils/permissions/filesystem.js', () => ({
    ...filesystemActual,
    checkReadPermissionForTool: checkReadPermissionForToolMock,
    matchingRuleForInput: matchingRuleForInputMock,
    checkWritePermissionForTool: mock(() => ({ behavior: 'allow' as const })),
    matchesPathRule: mock(() => false),
  }))
  mock.module('src/utils/permissions/permissions.js', () => ({
    ...permissionsActual,
    getDenyRuleForTool: getDenyRuleForToolMock,
    getAskRuleForTool: getAskRuleForToolMock,
  }))
  mock.module('src/services/diagnosticTracking.js', () => ({
    ...diagnosticActual,
    diagnosticTracker: {
      ...(diagnosticActual.diagnosticTracker as object),
      beforeFileEdited: async () => {},
    },
  }))
  mock.module('src/services/lsp/manager.js', () => ({
    ...lspManagerActual,
    getLspServerManager: () => null,
  }))
  mock.module('src/services/lsp/LSPDiagnosticRegistry.js', () => ({
    ...lspDiagActual,
    clearDeliveredDiagnosticsForFile: () => {},
  }))
  mock.module('src/services/mcp/vscodeSdkMcp.js', () => ({
    ...vscodeActual,
    notifyVscodeFileUpdated: () => {},
  }))
  mock.module('src/skills/loadSkillsDir.js', () => ({
    ...skillsActual,
    discoverSkillDirsForPaths: async () => [],
    addSkillDirectories: async () => {},
    activateConditionalSkillsForPaths: () => {},
  }))
  mock.module('src/utils/fileHistory.js', () => ({
    ...fileHistoryActual,
    fileHistoryEnabled: () => false,
    fileHistoryTrackEdit: async () => {},
  }))
  mock.module('src/utils/fileOperationAnalytics.js', () => ({
    ...fileOpAnalyticsActual,
    logFileOperation: () => {},
  }))
  mock.module('src/memdir/stampNewMemoryContent.js', () => ({
    ...stampActual,
    stampNewMemoryContent: (_path: string, content: string) => content,
  }))
  mock.module('src/utils/gitDiff.js', () => ({
    ...gitDiffActual,
    fetchSingleFileGitDiff: async () => undefined,
  }))
  mock.module('src/services/analytics/index.js', () => ({
    ...analyticsActual,
    logEvent: () => {},
  }))
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookActual,
    getFeatureValue_CACHED_MAY_BE_STALE: () => false,
  }))
  mock.module('src/utils/debug.js', () => ({
    ...debugActual,
    logForDebugging: () => {},
  }))
  mock.module('src/utils/log.js', () => ({
    ...logActual,
    logError: () => {},
  }))
  // Do NOT stub isEnvTruthy / isBareMode wholesale — restore envUtils fully;
  // skill discovery is already no-op above.
  mock.module('src/utils/envUtils.js', () => envUtilsActual)
}

function restoreMocks(): void {
  mock.module(
    'src/engine/permissionLayerReaders.js',
    () => permissionLayerActual,
  )
  mock.module('src/utils/permissions/filesystem.js', () => filesystemActual)
  mock.module('src/utils/permissions/permissions.js', () => permissionsActual)
  mock.module('src/services/diagnosticTracking.js', () => diagnosticActual)
  mock.module('src/services/lsp/manager.js', () => lspManagerActual)
  mock.module('src/services/lsp/LSPDiagnosticRegistry.js', () => lspDiagActual)
  mock.module('src/services/mcp/vscodeSdkMcp.js', () => vscodeActual)
  mock.module('src/skills/loadSkillsDir.js', () => skillsActual)
  mock.module('src/utils/fileHistory.js', () => fileHistoryActual)
  mock.module(
    'src/utils/fileOperationAnalytics.js',
    () => fileOpAnalyticsActual,
  )
  mock.module('src/memdir/stampNewMemoryContent.js', () => stampActual)
  mock.module('src/utils/gitDiff.js', () => gitDiffActual)
  mock.module('src/services/analytics/index.js', () => analyticsActual)
  mock.module('src/services/analytics/growthbook.js', () => growthbookActual)
  mock.module('src/utils/debug.js', () => debugActual)
  mock.module('src/utils/log.js', () => logActual)
  mock.module('src/utils/envUtils.js', () => envUtilsActual)
}

installMocks()

const { FileWriteTool } = await import('../../FileWriteTool/FileWriteTool.js')
const { FileEditTool } = await import('../../FileEditTool/FileEditTool.js')

function makeCallCtx(
  readFileState: Map<string, unknown>,
  tools: Array<{ name: string }> = [
    { name: FILE_WRITE_TOOL_NAME },
    { name: FILE_EDIT_TOOL_NAME },
    { name: FILE_READ_TOOL_NAME },
  ],
): ToolUseContext {
  return {
    readFileState,
    updateFileHistoryState: () => {},
    dynamicSkillDirTriggers: new Set(),
    userModified: false,
    options: { tools },
  } as unknown as ToolUseContext
}

const parentMessage = { uuid: 'test-uuid' } as { uuid: string }
/** call()'s 3rd arg is CanUseToolFn; unused by Write/Edit body. */
const canUseToolNoop = (async () => ({
  behavior: 'allow' as const,
})) as never

let dir: string

beforeAll(() => {
  installMocks()
  getMainLoopModelMock.mockImplementation(() => 'claude-sonnet-4-6')
  checkReadPermissionForToolMock.mockImplementation(() => ({
    behavior: 'allow',
  }))
  getDenyRuleForToolMock.mockImplementation(() => null)
  getAskRuleForToolMock.mockImplementation(() => null)
})

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true })
    dir = ''
  }
  getMainLoopModelMock.mockImplementation(() => 'claude-sonnet-4-6')
  checkReadPermissionForToolMock.mockImplementation(() => ({
    behavior: 'allow',
  }))
})

afterAll(() => {
  restoreMocks()
})

describe('densable 2.1.228 #17 FileWriteTool.call unread skip', () => {
  test('non-legacy + MCt + empty readFileState overwrites existing file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'write-call-228-'))
    const path = join(dir, 'a.ts')
    writeFileSync(path, 'old content\n', 'utf8')
    const readFileState = new Map()
    const result = await FileWriteTool.call(
      { file_path: path, content: 'new content\n' },
      makeCallCtx(readFileState),
      canUseToolNoop,
      parentMessage as never,
    )
    expect(readFileSync(path, 'utf8')).toBe('new content\n')
    expect(result.data).toBeDefined()
    expect((result.data as { type?: string }).type).toBe('update')
  })

  test('legacy model + empty readFileState throws FILE_UNEXPECTEDLY_MODIFIED', async () => {
    dir = mkdtempSync(join(tmpdir(), 'write-call-legacy-'))
    const path = join(dir, 'a.ts')
    writeFileSync(path, 'old content\n', 'utf8')
    getMainLoopModelMock.mockImplementation(() => 'claude-opus-4-6')
    await expect(
      FileWriteTool.call(
        { file_path: path, content: 'new content\n' },
        makeCallCtx(new Map()),
        canUseToolNoop,
        parentMessage as never,
      ),
    ).rejects.toThrow(FILE_UNEXPECTEDLY_MODIFIED_ERROR)
    expect(readFileSync(path, 'utf8')).toBe('old content\n')
  })

  test('partial view on Write never skips on call (densable !c only)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'write-call-partial-'))
    const path = join(dir, 'a.ts')
    writeFileSync(path, 'old content\n', 'utf8')
    const readFileState = new Map([
      [
        path,
        {
          content: 'partial',
          timestamp: Date.now(),
          isPartialView: true,
        },
      ],
    ])
    await expect(
      FileWriteTool.call(
        { file_path: path, content: 'new content\n' },
        makeCallCtx(readFileState),
        canUseToolNoop,
        parentMessage as never,
      ),
    ).rejects.toThrow(FILE_UNEXPECTEDLY_MODIFIED_ERROR)
  })
})

describe('densable 2.1.228 #17 FileEditTool.call unread skip', () => {
  test('non-legacy + MCt + empty readFileState edits existing file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'edit-call-228-'))
    const path = join(dir, 'b.ts')
    writeFileSync(path, 'hello world\n', 'utf8')
    const result = await FileEditTool.call(
      {
        file_path: path,
        old_string: 'hello world',
        new_string: 'hello densable',
        replace_all: false,
      },
      makeCallCtx(new Map()),
      canUseToolNoop,
      parentMessage as never,
    )
    expect(readFileSync(path, 'utf8')).toBe('hello densable\n')
    expect(result.data).toBeDefined()
  })

  test('legacy model + empty readFileState throws FILE_UNEXPECTEDLY_MODIFIED', async () => {
    dir = mkdtempSync(join(tmpdir(), 'edit-call-legacy-'))
    const path = join(dir, 'b.ts')
    writeFileSync(path, 'hello world\n', 'utf8')
    getMainLoopModelMock.mockImplementation(() => 'claude-haiku-4-5')
    await expect(
      FileEditTool.call(
        {
          file_path: path,
          old_string: 'hello world',
          new_string: 'hello densable',
          replace_all: false,
        },
        makeCallCtx(new Map()),
        canUseToolNoop,
        parentMessage as never,
      ),
    ).rejects.toThrow(FILE_UNEXPECTEDLY_MODIFIED_ERROR)
    expect(readFileSync(path, 'utf8')).toBe('hello world\n')
  })
})
