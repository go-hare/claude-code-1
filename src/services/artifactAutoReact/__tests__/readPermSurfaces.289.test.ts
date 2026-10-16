import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  getEmptyToolPermissionContext,
  type ToolPermissionContext,
} from 'src/Tool.js'
import type { AppState } from 'src/state/AppState.js'
import type { PermissionMode } from 'src/types/permissions.js'
import {
  artifactApprovalCoversFilesHint,
  arePermissionPromptsUnavailable,
  arePromptsAvoidedWithoutClassifier,
  type ConsentSurfaceContext,
  isArtifactAssetsOn,
  isArtifactCopyFromOn,
  isArtifactUserOnlyConsentGateOn,
  isClassifierDecidingMode,
  isCoworkFrameSession,
  isCoworkFrameWithoutConsentSurface,
  isPlanModeArtifactAsk,
  isPlanModeBypassElevated,
  isPlanWithoutConsentSurface,
  isPromptingPermissionMode,
  isServedCall,
  isServerClassifierMode,
  isServerClassifierTransport,
  noOneCanAnswerPrompt,
  setConsentSurfaceDepsForTests,
  shouldDropCircuitBreaker,
} from '../readPerm/surfaces.js'
import { resetArtifactAutoReactStoreForTests, un } from '../store.js'

const ENV_KEYS = [
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDECODE',
  'CLAUDE_CODE_COWORK_FRAME_ARTIFACTS',
  'CLAUDE_CODE_ARTIFACT_ASSETS',
] as const
const savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))

let interactive = true
let autoActive = false
let gates: Record<string, unknown> = {}

beforeEach(() => {
  interactive = true
  autoActive = false
  gates = {}
  for (const k of ENV_KEYS) delete process.env[k]
  setConsentSurfaceDepsForTests({
    isInteractive: () => interactive,
    isAutoModeActive: () => autoActive,
    featureValue: <T>(name: string, fallback: T): T =>
      name in gates ? (gates[name] as T) : fallback,
  })
})

afterEach(() => {
  setConsentSurfaceDepsForTests(null)
  resetArtifactAutoReactStoreForTests()
  for (const k of ENV_KEYS) {
    const prev = savedEnv[k]
    if (prev === undefined) delete process.env[k]
    else process.env[k] = prev
  }
})

function ctx(
  overrides: Partial<ToolPermissionContext> = {},
  permissionLayers?: ConsentSurfaceContext['permissionLayers'],
): ConsentSurfaceContext {
  const toolPermissionContext = {
    ...getEmptyToolPermissionContext(),
    isBypassPermissionsModeAvailable: false,
    ...overrides,
  } as ToolPermissionContext
  return {
    getAppState: () => ({ toolPermissionContext }) as unknown as AppState,
    permissionLayers,
  }
}

function coworkEnv(): void {
  process.env.CLAUDE_CODE_ENTRYPOINT = 'local-agent'
  process.env.CLAUDE_CODE_COWORK_FRAME_ARTIFACTS = '1'
}

describe('isPlanModeBypassElevated (DW)', () => {
  test('plan + bypass available + interactive', () => {
    expect(isPlanModeBypassElevated('plan', true)).toBe(true)
  })
  test('non-interactive session is not elevated', () => {
    interactive = false
    expect(isPlanModeBypassElevated('plan', true)).toBe(false)
  })
  test('needs plan mode and bypass availability', () => {
    expect(isPlanModeBypassElevated('default', true)).toBe(false)
    expect(isPlanModeBypassElevated('plan', false)).toBe(false)
    expect(isPlanModeBypassElevated('plan', undefined)).toBe(false)
  })
})

describe('isPromptingPermissionMode (Im)', () => {
  test.each<PermissionMode>([
    'default',
    'acceptEdits',
    'dontAsk',
    'auto',
  ])('%s prompts', mode => {
    expect(isPromptingPermissionMode(ctx({ mode }))).toBe(true)
  })
  test('bypassPermissions does not prompt', () => {
    expect(isPromptingPermissionMode(ctx({ mode: 'bypassPermissions' }))).toBe(
      false,
    )
  })
  test('plan elevated from bypass does not prompt', () => {
    const c = ctx({ mode: 'plan', isBypassPermissionsModeAvailable: true })
    expect(isPromptingPermissionMode(c)).toBe(false)
    interactive = false
    expect(isPromptingPermissionMode(c)).toBe(true)
  })
  test('reads the effective mode from permissionLayers', () => {
    const c = ctx({ mode: 'default', isBypassPermissionsModeAvailable: true }, [
      { kind: 'permission_mode', mode: 'bypassPermissions' },
    ] as unknown as ConsentSurfaceContext['permissionLayers'])
    expect(isPromptingPermissionMode(c)).toBe(false)
  })
})

describe('arePermissionPromptsUnavailable (vg)', () => {
  test('prompting mode without avoid flag has a surface', () => {
    expect(arePermissionPromptsUnavailable(ctx())).toBe(false)
  })
  test('shouldAvoidPermissionPrompts removes the surface', () => {
    expect(
      arePermissionPromptsUnavailable(
        ctx({ shouldAvoidPermissionPrompts: true }),
      ),
    ).toBe(true)
  })
  test('avoid_prompts layer removes the surface', () => {
    const c = ctx({}, [
      { kind: 'avoid_prompts' },
    ] as unknown as ConsentSurfaceContext['permissionLayers'])
    expect(arePermissionPromptsUnavailable(c)).toBe(true)
  })
  test('bypass mode is unavailable', () => {
    expect(
      arePermissionPromptsUnavailable(ctx({ mode: 'bypassPermissions' })),
    ).toBe(true)
  })
})

describe('isPlanWithoutConsentSurface (b_)', () => {
  test('false outside plan mode even when prompts are avoided', () => {
    expect(
      isPlanWithoutConsentSurface(ctx({ shouldAvoidPermissionPrompts: true })),
    ).toBe(false)
  })
  test('plan + avoid prompts', () => {
    expect(
      isPlanWithoutConsentSurface(
        ctx({ mode: 'plan', shouldAvoidPermissionPrompts: true }),
      ),
    ).toBe(true)
  })
  test('plan elevated from bypass', () => {
    expect(
      isPlanWithoutConsentSurface(
        ctx({ mode: 'plan', isBypassPermissionsModeAvailable: true }),
      ),
    ).toBe(true)
  })
  test('plan with a live prompt surface', () => {
    expect(isPlanWithoutConsentSurface(ctx({ mode: 'plan' }))).toBe(false)
  })
})

describe('isCoworkFrameSession (ik)', () => {
  test('local-agent + cowork frame artifacts', () => {
    coworkEnv()
    expect(isCoworkFrameSession()).toBe(true)
  })
  test('other entrypoints are not cowork frames', () => {
    coworkEnv()
    process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-desktop'
    expect(isCoworkFrameSession()).toBe(false)
    process.env.CLAUDE_CODE_ENTRYPOINT = 'local_agent'
    expect(isCoworkFrameSession()).toBe(false)
  })
  test('child session or nested CLAUDECODE excluded', () => {
    coworkEnv()
    process.env.CLAUDE_CODE_CHILD_SESSION = '1'
    expect(isCoworkFrameSession()).toBe(false)
    delete process.env.CLAUDE_CODE_CHILD_SESSION
    process.env.CLAUDECODE = '1'
    expect(isCoworkFrameSession()).toBe(false)
  })
  test('frame artifacts env must be truthy', () => {
    coworkEnv()
    process.env.CLAUDE_CODE_COWORK_FRAME_ARTIFACTS = '0'
    expect(isCoworkFrameSession()).toBe(false)
  })
})

describe('isCoworkFrameWithoutConsentSurface (l0) / noOneCanAnswerPrompt (pi)', () => {
  test('cowork frame + avoided prompts', () => {
    coworkEnv()
    const c = ctx({ shouldAvoidPermissionPrompts: true })
    expect(isCoworkFrameWithoutConsentSurface(c)).toBe(true)
    expect(noOneCanAnswerPrompt(c)).toBe(true)
  })
  test('cowork frame with a live surface', () => {
    coworkEnv()
    expect(isCoworkFrameWithoutConsentSurface(ctx())).toBe(false)
    expect(noOneCanAnswerPrompt(ctx())).toBe(false)
  })
  test('avoided prompts outside plan and cowork frame still count as answerable', () => {
    expect(
      noOneCanAnswerPrompt(ctx({ shouldAvoidPermissionPrompts: true })),
    ).toBe(false)
  })
  test('plan without surface counts', () => {
    expect(
      noOneCanAnswerPrompt(
        ctx({ mode: 'plan', shouldAvoidPermissionPrompts: true }),
      ),
    ).toBe(true)
  })
})

describe('isPlanModeArtifactAsk (PN)', () => {
  test('true only in plan mode', () => {
    expect(isPlanModeArtifactAsk(ctx({ mode: 'plan' }))).toBe(true)
    expect(isPlanModeArtifactAsk(ctx({ mode: 'auto' }))).toBe(false)
  })
})

describe('isClassifierDecidingMode (qi)', () => {
  test('auto always', () => {
    expect(isClassifierDecidingMode('auto')).toBe(true)
    expect(isClassifierDecidingMode('auto', true)).toBe(true)
  })
  test('plan only while auto mode is active and not served', () => {
    expect(isClassifierDecidingMode('plan')).toBe(false)
    autoActive = true
    expect(isClassifierDecidingMode('plan')).toBe(true)
    expect(isClassifierDecidingMode('plan', true)).toBe(false)
  })
  test('other modes never', () => {
    autoActive = true
    expect(isClassifierDecidingMode('default')).toBe(false)
    expect(isClassifierDecidingMode('bypassPermissions')).toBe(false)
  })
})

describe('arePromptsAvoidedWithoutClassifier', () => {
  test('prompting mode + avoid + no classifier', () => {
    expect(
      arePromptsAvoidedWithoutClassifier(
        ctx({ shouldAvoidPermissionPrompts: true }),
      ),
    ).toBe(true)
  })
  test('auto mode classifier stands in', () => {
    expect(
      arePromptsAvoidedWithoutClassifier(
        ctx({ mode: 'auto', shouldAvoidPermissionPrompts: true }),
      ),
    ).toBe(false)
  })
  test('bypass mode does not prompt', () => {
    expect(
      arePromptsAvoidedWithoutClassifier(
        ctx({ mode: 'bypassPermissions', shouldAvoidPermissionPrompts: true }),
      ),
    ).toBe(false)
  })
})

describe('isServedCall', () => {
  test('only servedCall === true', () => {
    const base = getEmptyToolPermissionContext()
    expect(isServedCall(base)).toBe(false)
    expect(isServedCall({ ...base, servedCall: true })).toBe(true)
  })
})

describe('isServerClassifierMode (Vqe)', () => {
  test('lut accepts arbiter transports only', () => {
    expect(isServerClassifierTransport('arbiter')).toBe(true)
    expect(isServerClassifierTransport('arbiterWithLocalFallback')).toBe(true)
    expect(isServerClassifierTransport('off')).toBe(false)
  })
  test('no server classifier in this build', () => {
    autoActive = true
    expect(isServerClassifierMode('auto')).toBe(false)
    expect(isServerClassifierMode('plan')).toBe(false)
  })
})

describe('isArtifactUserOnlyConsentGateOn (Yw)', () => {
  test('tengu_cobalt_plinth_sedge default false', () => {
    expect(isArtifactUserOnlyConsentGateOn()).toBe(false)
    gates.tengu_cobalt_plinth_sedge = true
    expect(isArtifactUserOnlyConsentGateOn()).toBe(true)
  })
})

describe('isArtifactAssetsOn (K0t)', () => {
  test('env tri-bool wins over roster', () => {
    un().assetsOnRoster = true
    process.env.CLAUDE_CODE_ARTIFACT_ASSETS = '0'
    expect(isArtifactAssetsOn()).toBe(false)
    un().assetsOnRoster = false
    process.env.CLAUDE_CODE_ARTIFACT_ASSETS = '1'
    expect(isArtifactAssetsOn()).toBe(true)
  })
  test('falls back to the roster capability', () => {
    expect(isArtifactAssetsOn()).toBe(false)
    un().assetsOnRoster = true
    expect(isArtifactAssetsOn()).toBe(true)
  })
})

describe('isArtifactCopyFromOn (Q6)', () => {
  test('needs assets and tengu_cobalt_plinth_samphire', () => {
    process.env.CLAUDE_CODE_ARTIFACT_ASSETS = '1'
    expect(isArtifactCopyFromOn()).toBe(false)
  })
  test('latches per session store', () => {
    process.env.CLAUDE_CODE_ARTIFACT_ASSETS = '1'
    gates.tengu_cobalt_plinth_samphire = true
    expect(isArtifactCopyFromOn()).toBe(true)
    gates.tengu_cobalt_plinth_samphire = false
    expect(isArtifactCopyFromOn()).toBe(true)
    resetArtifactAutoReactStoreForTests()
    expect(isArtifactCopyFromOn()).toBe(false)
  })
})

describe('artifactApprovalCoversFilesHint (xAr)', () => {
  test('without copy-from', () => {
    expect(artifactApprovalCoversFilesHint(false)).toBe(
      'Approving covers its files for the rest of the conversation.',
    )
  })
  test('with copy-from', () => {
    expect(artifactApprovalCoversFilesHint(true)).toBe(
      'Approving covers its files, and copying them into other artifacts, for the rest of the conversation.',
    )
  })
})

describe('shouldDropCircuitBreaker (OW)', () => {
  test.each([
    'dangerousRemoval',
    'backgroundOperator',
    'suspiciousWindowsPath',
  ])('%s is classifier-routed', circuitBreaker => {
    expect(shouldDropCircuitBreaker({ circuitBreaker })).toBe(true)
  })
  test.each([
    'isolatePeerMachines',
    'restrictedMode',
    'outsideReadsBlocked',
    'claudeSettingsFile',
    'internalHardDeny',
  ])('%s is kept', circuitBreaker => {
    expect(shouldDropCircuitBreaker({ circuitBreaker })).toBe(false)
  })
  test('no circuit breaker', () => {
    expect(shouldDropCircuitBreaker({})).toBe(false)
  })
})
