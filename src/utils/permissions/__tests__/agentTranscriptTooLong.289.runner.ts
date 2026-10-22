/**
 * Isolated runner — mock.module yoloClassifier would pollute
 * classifierWait.289 in the same bun-test process.
 *
 * densable ht: Agent allow on transcriptTooLong before headless abort.
 * HTTP seam: classifierWallClock.sideQueryWithClassifierWallClock throws
 * "prompt is too long" (detectPromptTooLong). Do not mock yoloClassifier.
 */
import { afterAll, describe, expect, mock, test } from 'bun:test'
import { z } from 'zod'
import {
  bunBundleMock,
  pushFeatureOverride,
} from '../../../../tests/mocks/bunBundle.js'

mock.module('bun:bundle', bunBundleMock)
const popFeature = pushFeatureOverride(name => name === 'TRANSCRIPT_CLASSIFIER')

const { logMock } = await import('../../../../tests/mocks/log.js')
const { debugMock } = await import('../../../../tests/mocks/debug.js')
mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)
const { analyticsMock } = await import('../../../../tests/mocks/analytics.js')
mock.module('src/services/analytics/index.js', analyticsMock)
mock.module('src/services/analytics/index.ts', analyticsMock)

const { snapshotModuleExports } = await import(
  '../../../../tests/mocks/settings.js'
)
const wallClockSnap = snapshotModuleExports(
  await import('../classifierWallClock.js'),
)
const sideQueryWithClassifierWallClock = mock(async () => {
  throw new Error('prompt is too long: 200000 tokens > 100000 maximum')
})
function wallClockMock() {
  return {
    ...wallClockSnap,
    sideQueryWithClassifierWallClock,
  }
}
mock.module('./classifierWallClock.js', wallClockMock)
mock.module('../classifierWallClock.js', wallClockMock)
mock.module('src/utils/permissions/classifierWallClock.js', wallClockMock)
mock.module('src/utils/permissions/classifierWallClock.ts', wallClockMock)

const { getEmptyToolPermissionContext } = await import('../../../Tool.js')
const { hasPermissionsToUseTool } = await import('../permissions.js')
const { AbortError } = await import('../../errors.js')

afterAll(() => {
  popFeature()
})

function makeContext(
  opts: { shouldAvoidPermissionPrompts?: boolean },
  tools: unknown[] = [],
) {
  const toolPermissionContext = {
    ...getEmptyToolPermissionContext(),
    mode: 'auto' as const,
    shouldAvoidPermissionPrompts: opts.shouldAvoidPermissionPrompts === true,
  }
  let appState = {
    toolPermissionContext,
    mcp: { tools: [] as never[] },
    denialTracking: { consecutiveDenials: 0, totalDenials: 0 },
  }
  return {
    getAppState: () => appState,
    setAppState: (updater: (prev: typeof appState) => typeof appState) => {
      appState = updater(appState)
    },
    abortController: new AbortController(),
    messages: [],
    options: { tools, mainLoopModel: 'claude-opus' },
  }
}

function makeTool(name: string, extra?: Record<string, unknown>) {
  return {
    name,
    inputSchema: z.object({ prompt: z.string().optional() }).passthrough(),
    toAutoClassifierInput: (input: Record<string, unknown>) =>
      JSON.stringify(input),
    checkPermissions: async (input: unknown) => ({
      behavior: 'ask' as const,
      message: `${name} needs review`,
      updatedInput: input,
    }),
    ...extra,
  }
}

const dummyMsg = { message: { id: 'msg_ht' } }

describe('hasPermissionsToUseTool transcriptTooLong (densable ht)', () => {
  test('Agent allows on overflow (interactive auto)', async () => {
    const tool = makeTool('Agent')
    const result = await hasPermissionsToUseTool(
      tool as never,
      { prompt: 'spawn' },
      makeContext({}, [tool]) as never,
      dummyMsg as never,
      'tu_agent',
    )
    expect(sideQueryWithClassifierWallClock).toHaveBeenCalled()
    expect(result.behavior).toBe('allow')
    if (result.behavior === 'allow') {
      expect(result.decisionReason).toEqual({ type: 'mode', mode: 'auto' })
    }
  })

  test('Agent allows on overflow even when headless (before abort)', async () => {
    const tool = makeTool('Agent')
    const result = await hasPermissionsToUseTool(
      tool as never,
      { prompt: 'spawn' },
      makeContext({ shouldAvoidPermissionPrompts: true }, [tool]) as never,
      dummyMsg as never,
      'tu_agent_headless',
    )
    expect(result.behavior).toBe('allow')
  })

  test('Bash headless overflow aborts', async () => {
    const tool = makeTool('Bash')
    await expect(
      hasPermissionsToUseTool(
        tool as never,
        { prompt: 'rm' },
        makeContext({ shouldAvoidPermissionPrompts: true }, [tool]) as never,
        dummyMsg as never,
        'tu_bash_headless',
      ),
    ).rejects.toBeInstanceOf(AbortError)
  })

  test('classifierOnly interactive overflow denies without a prompt', async () => {
    const tool = makeTool('Handback', {
      classifierOnly: () => ({ onBlock: 'block' }),
    })
    const result = await hasPermissionsToUseTool(
      tool as never,
      { prompt: 'x' },
      makeContext({}, [tool]) as never,
      dummyMsg as never,
      'tu_only',
    )
    expect(result.behavior).toBe('deny')
    if (result.behavior === 'deny') {
      expect(result.message).toContain(
        'no permission prompt is raised for this tool',
      )
    }
  })
})
