import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import {
  clearRefusalFallbackModelLatch,
  getRefusalFallbackModelLatch,
  setRefusalFallbackModelLatch,
  takeCarriedEffortEnd,
} from '../../bootstrap/state.js'
import type { ToolPermissionContext } from '../../Tool.js'
import * as cliRelaunch from '../../utils/cliRelaunch.js'
import {
  clearSessionOrgEffortCaps,
  getSessionOrgEffortCap,
  INHERIT_SESSION_EFFORT,
  levelSessionEffort,
  stepDownOrgEffortCap,
} from '../../utils/effort.js'
import {
  resetSettingsCache,
  setCachedSettingsForSource,
  setSessionSettingsCache,
} from '../../utils/settings/settingsCache.js'
import type { AppState } from '../AppStateStore.js'
import {
  externalMetadataToAppState,
  onChangeAppState,
} from '../onChangeAppState.js'

function makeContext(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
    ...overrides,
  }
}

function makeAppState(overrides: Partial<AppState> = {}): AppState {
  return {
    toolPermissionContext: makeContext(),
    tasks: {},
    mainLoopModel: null,
    mainLoopModelForSession: null,
    sessionEffort: INHERIT_SESSION_EFFORT,
    settingsEffortTable: undefined,
    ultracode: false,
    advisorModel: undefined,
    expandedView: 'none',
    verbose: false,
    settings: {},
    mcp: {
      clientsInitialized: true,
      clients: [],
      tools: [],
      commands: [],
      resources: {},
      resourceTemplates: {},
      suppressedPluginMcpServers: [],
      pluginReconnectKey: 0,
    },
    ...overrides,
  } as unknown as AppState
}

describe('Wave 1C: externalMetadataToAppState [P0-14]', () => {
  afterEach(() => {
    resetSettingsCache()
  })

  test('refuses restored bypassPermissions when isBypassPermissionsModeAvailable is false', () => {
    const prev = makeAppState({
      toolPermissionContext: makeContext({
        mode: 'default',
        isBypassPermissionsModeAvailable: false,
      }),
    })
    const next = externalMetadataToAppState({
      permission_mode: 'bypassPermissions',
    })(prev)
    expect(next.toolPermissionContext.mode).toBe('default')
  })

  test('refuses restored bypassPermissions when disabled by policySettings', () => {
    setCachedSettingsForSource('policySettings', {
      permissions: { disableBypassPermissionsMode: 'disable' },
    })
    setSessionSettingsCache({
      settings: {
        permissions: { disableBypassPermissionsMode: 'disable' },
      },
      errors: [],
    })
    const prev = makeAppState({
      toolPermissionContext: makeContext({
        mode: 'default',
        isBypassPermissionsModeAvailable: true,
      }),
    })
    const next = externalMetadataToAppState({
      permission_mode: 'bypassPermissions',
    })(prev)
    expect(next.toolPermissionContext.mode).toBe('default')
  })

  test('strips dangerous allow rules when restoring auto mode', () => {
    const prev = makeAppState({
      toolPermissionContext: makeContext({
        mode: 'auto',
        alwaysAllowRules: {
          userSettings: ['Bash(python:*)', 'Read'],
        },
      }),
    })
    const next = externalMetadataToAppState({
      permission_mode: 'auto',
    })(prev)
    expect(next.toolPermissionContext.mode).toBe('auto')
    expect(
      next.toolPermissionContext.alwaysAllowRules.userSettings ?? [],
    ).not.toContain('Bash(python:*)')
    expect(
      next.toolPermissionContext.strippedDangerousRules?.userSettings,
    ).toContain('Bash(python:*)')
  })
})

describe('Wave 1C: onChangeAppState [P1-#24]', () => {
  afterEach(() => {
    clearSessionOrgEffortCaps()
    clearRefusalFallbackModelLatch('test_cleanup')
    takeCarriedEffortEnd()
  })

  test('clears session org effort caps, clears carriedEffort latch, and updates bg respawn flags for model/effort/advisor', () => {
    const flagCalls: Array<[string, readonly string[], string | null]> = []
    const flagSpy = spyOn(
      cliRelaunch,
      'updateBgRespawnFlag',
    ).mockImplementation((flag, aliases, value) => {
      flagCalls.push([flag, aliases, value])
      return true
    })

    try {
      stepDownOrgEffortCap('claude-opus-4-6', 'max')
      expect(getSessionOrgEffortCap('claude-opus-4-6')).toBeDefined()
      setRefusalFallbackModelLatch({
        fallbackModel: 'claude-sonnet-4-6',
        carriedEffort: 'high',
      } as Parameters<typeof setRefusalFallbackModelLatch>[0])

      const oldState = makeAppState({
        mainLoopModel: 'sonnet',
        sessionEffort: INHERIT_SESSION_EFFORT,
        advisorModel: undefined,
      })
      const effortOnlyState = makeAppState({
        mainLoopModel: 'sonnet',
        sessionEffort: levelSessionEffort('low'),
        advisorModel: undefined,
      })

      onChangeAppState({ oldState, newState: effortOnlyState })

      expect(getSessionOrgEffortCap('claude-opus-4-6')).toBeUndefined()
      expect(getRefusalFallbackModelLatch()?.carriedEffort).toBeUndefined()
      expect(takeCarriedEffortEnd()).toBe('effort_change')

      const modelAndAdvisorState = makeAppState({
        mainLoopModel: 'opus',
        sessionEffort: levelSessionEffort('low'),
        advisorModel: 'claude-sonnet-4-6',
      })
      onChangeAppState({
        oldState: effortOnlyState,
        newState: modelAndAdvisorState,
      })

      expect(flagCalls).toContainEqual(['--model', ['-m'], 'opus'])
      expect(flagCalls).toContainEqual(['--effort', [], 'low'])
      expect(flagCalls).toContainEqual(['--advisor', [], 'claude-sonnet-4-6'])
    } finally {
      flagSpy.mockRestore()
    }
  })

  test('notifies connected MCP clients when additionalWorkingDirectories changes', () => {
    let notified = 0
    const fakeClient = {
      sendRootsListChanged: async () => {
        notified++
      },
    }
    const oldState = makeAppState({
      toolPermissionContext: makeContext({
        additionalWorkingDirectories: new Map(),
      }),
    })
    const newDirs = new Map([
      ['/tmp/extra', { path: '/tmp/extra', source: 'session' as const }],
    ])
    const newState = makeAppState({
      toolPermissionContext: makeContext({
        additionalWorkingDirectories: newDirs,
      }),
      mcp: {
        clientsInitialized: true,
        clients: [
          {
            type: 'connected',
            name: 'test-mcp',
            client: fakeClient,
          } as unknown as AppState['mcp']['clients'][number],
        ],
        tools: [],
        commands: [],
        resources: {},
        resourceTemplates: {},
        suppressedPluginMcpServers: [],
        pluginReconnectKey: 0,
      },
    })

    onChangeAppState({ oldState, newState })
    expect(notified).toBe(1)
  })
})
