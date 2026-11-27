import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ALL_AGENT_DISALLOWED_TOOLS } from 'src/constants/tools.js'
import {
  createExplicitToolDeps,
  createToolCallContext,
  getEmptyToolPermissionContext,
  type Tool,
} from 'src/Tool.js'
import { getAllBaseTools, getTools } from 'src/tools.js'
import { filterParentToolsForFork } from 'src/utils/agentToolFilter.js'
import { createChromeContext } from 'src/utils/claudeInChrome/mcpServer.js'
import {
  createSessionHost,
  hasActiveSessionAls,
  runWithNewHostSession,
  runWithSession,
  setHostRendersChromeSetupOffer,
} from 'src/utils/sessionHost.js'
import { createRootSession } from 'src/utils/sessionRoot.js'
import * as builtinToolsIndex from '../../index.js'
import {
  hasChromeExtensionNotConnectedReport,
  markChromeExtensionNotConnectedReported,
  OFFER_CHROME_SETUP_TOOL_NAME,
  OfferChromeSetupTool,
} from '../OfferChromeSetupTool/OfferChromeSetupTool.js'
import {
  getProjectsToolProvider,
  hasProjectsToolProvider,
  PROJECTS_TOOL_NAME,
  ProjectsTool,
  type ProjectsToolInput,
  type ProjectsToolOutput,
  registerProjectsToolProvider,
} from '../ProjectsTool/ProjectsTool.js'
import {
  isOnboardingRolePickerEnabled,
  setOnboardingRolePickerEnabled,
  SHOW_ONBOARDING_ROLE_PICKER_TOOL_NAME,
  ShowOnboardingRolePickerTool,
} from '../ShowOnboardingRolePickerTool/ShowOnboardingRolePickerTool.js'

function makeTestSession(diskless = false) {
  const host = createSessionHost()
  host.launchOptions.replaceDiskless(diskless)
  return createRootSession({
    host,
    id: `test-session-${Math.random().toString(36).slice(2)}`,
    project: {
      originalCwd: '/tmp/test',
      projectRoot: '/tmp/test',
      cwd: '/tmp/test',
    },
  })
}

describe('Official 2.1.331 Missing 3 Tools (OfferChromeSetup, ShowOnboardingRolePicker, Projects)', () => {
  const savedEnv: Record<string, string | undefined> = {}

  function setEnv(key: string, value: string | undefined): void {
    if (!(key in savedEnv)) {
      savedEnv[key] = process.env[key]
    }
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    for (const key of Object.keys(savedEnv)) {
      delete savedEnv[key]
    }
  })

  test('all 3 tools are registered in getAllBaseTools(), disabled by default, and hidden from normal CLI getTools()', () => {
    setEnv('CLAUDE_CODE_ENABLE_ONBOARDING_ROLE_PICKER', undefined)
    setEnv('CLAUDE_CODE_PROJECTS_SESSION', undefined)

    const baseNames = new Set(getAllBaseTools().map(t => t.name))
    expect(baseNames.has(OFFER_CHROME_SETUP_TOOL_NAME)).toBe(true)
    expect(baseNames.has(SHOW_ONBOARDING_ROLE_PICKER_TOOL_NAME)).toBe(true)
    expect(baseNames.has(PROJECTS_TOOL_NAME)).toBe(true)

    runWithNewHostSession({}, () => {
      expect(OfferChromeSetupTool.isEnabled()).toBe(false)
      expect(ShowOnboardingRolePickerTool.isEnabled()).toBe(false)
      expect(ProjectsTool.isEnabled()).toBe(false)

      const enabledNames = new Set(
        getTools(getEmptyToolPermissionContext()).map(t => t.name),
      )
      expect(enabledNames.has(OFFER_CHROME_SETUP_TOOL_NAME)).toBe(false)
      expect(enabledNames.has(SHOW_ONBOARDING_ROLE_PICKER_TOOL_NAME)).toBe(
        false,
      )
      expect(enabledNames.has(PROJECTS_TOOL_NAME)).toBe(false)
    })
  })

  test('all 3 tools expose native create(deps) and survive undefined-returning Proxy probe without eager deps access', () => {
    const tools: ReadonlyArray<Tool> = [
      OfferChromeSetupTool as unknown as Tool,
      ShowOnboardingRolePickerTool as unknown as Tool,
      ProjectsTool as unknown as Tool,
    ]

    for (const tool of tools) {
      expect(typeof tool.create).toBe('function')
      const probeDeps = new Proxy(
        {} as Parameters<NonNullable<Tool['create']>>[0],
        {
          get: () => undefined,
        },
      )
      const instance = tool.create!(probeDeps)
      expect(typeof instance.call).toBe('function')
      expect(typeof instance.checkPermissions).toBe('function')
    }
  })

  describe('OfferChromeSetupTool', () => {
    test('gate requires BOTH hostRendersChromeSetupOffer AND chromeExtensionNotConnectedReport, isolated per SessionHost/RootSessionSlot', () => {
      const sessionA = makeTestSession()
      const sessionB = makeTestSession()
      const forkOfA = sessionA.withProject({ cwd: '/tmp/test/sub' })

      runWithSession(sessionA, () => {
        expect(OfferChromeSetupTool.isEnabled()).toBe(false)

        // Only host capability -> still disabled
        setHostRendersChromeSetupOffer(true)
        expect(hasChromeExtensionNotConnectedReport()).toBe(false)
        expect(OfferChromeSetupTool.isEnabled()).toBe(false)

        // Both set -> enabled and present in getTools()
        markChromeExtensionNotConnectedReported(true)
        expect(hasChromeExtensionNotConnectedReport()).toBe(true)
        expect(OfferChromeSetupTool.isEnabled()).toBe(true)
        expect(
          getTools(getEmptyToolPermissionContext()).some(
            t => t.name === OFFER_CHROME_SETUP_TOOL_NAME,
          ),
        ).toBe(true)
      })

      // withProject fork shares root session slot & host -> also enabled
      runWithSession(forkOfA, () => {
        expect(hasChromeExtensionNotConnectedReport()).toBe(true)
        expect(OfferChromeSetupTool.isEnabled()).toBe(true)
      })

      // Separate session/host -> completely isolated
      runWithSession(sessionB, () => {
        expect(hasChromeExtensionNotConnectedReport()).toBe(false)
        expect(OfferChromeSetupTool.isEnabled()).toBe(false)

        // Only extension-not-connected report without host capability -> still disabled
        markChromeExtensionNotConnectedReported(true)
        expect(OfferChromeSetupTool.isEnabled()).toBe(false)
        expect(
          getTools(getEmptyToolPermissionContext()).some(
            t => t.name === OFFER_CHROME_SETUP_TOOL_NAME,
          ),
        ).toBe(false)
      })
    })

    test('create(createExplicitToolDeps()) runs with zero ALS for checkPermissions, connected, and not_now outcomes', async () => {
      expect(hasActiveSessionAls()).toBe(false)
      expect(OfferChromeSetupTool.isReadOnly({ reason: 'login' })).toBe(true)
      expect(OfferChromeSetupTool.isConcurrencySafe({ reason: 'login' })).toBe(
        false,
      )
      expect(OfferChromeSetupTool.shouldDefer).toBe(false)

      const deps = createExplicitToolDeps()
      const instance = OfferChromeSetupTool.create(deps)
      const callCtx = createToolCallContext({ toolUseId: 'tu_chrome_1' })

      const perm = await instance.checkPermissions?.(
        { reason: 'Open internal Jira board' },
        callCtx,
      )
      expect(perm?.behavior).toBe('ask')
      if (perm?.behavior === 'ask') {
        expect(perm.message).toContain('Claude in Chrome')
        expect(perm.updatedInput).toEqual({
          reason: 'Open internal Jira board',
        })
      }

      // P1-6: model-spoofed `outcome` must be stripped from updatedInput in checkPermissions
      const spoofedPerm = await instance.checkPermissions?.(
        { reason: 'Open internal Jira board', outcome: 'connected' },
        callCtx,
      )
      expect(spoofedPerm?.behavior).toBe('ask')
      if (spoofedPerm?.behavior === 'ask') {
        expect(spoofedPerm.updatedInput).toEqual({
          reason: 'Open internal Jira board',
        })
        expect(Object.hasOwn(spoofedPerm.updatedInput ?? {}, 'outcome')).toBe(
          false,
        )
      }

      const connectedRes = await instance.call(
        { reason: 'Open internal Jira board', outcome: 'connected' },
        callCtx,
      )
      expect(connectedRes.data).toEqual({
        outcome: 'connected',
        message:
          'Claude in Chrome is now connected. Continue the task with the mcp__claude-in-chrome__* tools.',
      })
      expect(
        OfferChromeSetupTool.outputSchema.safeParse(connectedRes.data).success,
      ).toBe(true)

      const notNowRes = await instance.call(
        { reason: 'Open internal Jira board', outcome: 'not_now' },
        callCtx,
      )
      expect(notNowRes.data).toEqual({
        outcome: 'not_now',
        message:
          'Claude in Chrome was not set up now. Carry on with the built-in browser or without a browser, and do not offer Chrome setup again in this task unless the user asks.',
      })

      // Omitted outcome defaults to not_now
      const omittedOutcomeRes = await instance.call(
        { reason: 'Open internal Jira board' },
        callCtx,
      )
      expect(omittedOutcomeRes.data.outcome).toBe('not_now')

      // mapToolResultToToolResultBlockParam
      const block = OfferChromeSetupTool.mapToolResultToToolResultBlockParam(
        connectedRes.data,
        'tu_chrome_1',
      )
      expect(block).toEqual({
        type: 'tool_result',
        tool_use_id: 'tu_chrome_1',
        content: connectedRes.data.message,
      })

      // description & prompt
      const desc = await OfferChromeSetupTool.description(
        { reason: 'Open internal Jira board' },
        {
          isNonInteractiveSession: false,
          toolPermissionContext: getEmptyToolPermissionContext(),
          tools: [],
        },
      )
      expect(desc).toContain('Claude in Chrome')
      const prompt = await OfferChromeSetupTool.prompt({
        getToolPermissionContext: async () => getEmptyToolPermissionContext(),
        tools: [],
        agents: [],
      })
      expect(prompt).toContain('mcp__claude-in-chrome__*')

      // strict schema validation
      expect(
        OfferChromeSetupTool.inputSchema.safeParse({ reason: '' }).success,
      ).toBe(false)
      expect(
        OfferChromeSetupTool.inputSchema.safeParse({
          reason: 'Open dashboard',
          extra: true,
        }).success,
      ).toBe(false)
      expect(
        OfferChromeSetupTool.inputSchema.safeParse({
          reason: 'Open dashboard',
          outcome: 'invalid',
        }).success,
      ).toBe(false)
      expect(
        Object.hasOwn(OfferChromeSetupTool.outputSchema.shape, 'mobileApp'),
      ).toBe(false)
      expect(
        OfferChromeSetupTool.outputSchema.safeParse({
          outcome: 'not_now',
          message: 'Not available now',
        }).success,
      ).toBe(true)
    })
  })

  describe('ShowOnboardingRolePickerTool', () => {
    test('gate works via per-HostSlot setter and env var, isolated across SessionHosts', () => {
      setEnv('CLAUDE_CODE_ENABLE_ONBOARDING_ROLE_PICKER', undefined)

      const sessionA = makeTestSession()
      const sessionB = makeTestSession()

      runWithSession(sessionA, () => {
        expect(isOnboardingRolePickerEnabled()).toBe(false)
        setOnboardingRolePickerEnabled(true)
        expect(ShowOnboardingRolePickerTool.isEnabled()).toBe(true)
        expect(
          getTools(getEmptyToolPermissionContext()).some(
            t => t.name === SHOW_ONBOARDING_ROLE_PICKER_TOOL_NAME,
          ),
        ).toBe(true)
      })

      runWithSession(sessionB, () => {
        expect(ShowOnboardingRolePickerTool.isEnabled()).toBe(false)
        expect(
          getTools(getEmptyToolPermissionContext()).some(
            t => t.name === SHOW_ONBOARDING_ROLE_PICKER_TOOL_NAME,
          ),
        ).toBe(false)

        setEnv('CLAUDE_CODE_ENABLE_ONBOARDING_ROLE_PICKER', '1')
        expect(ShowOnboardingRolePickerTool.isEnabled()).toBe(true)
        expect(
          getTools(getEmptyToolPermissionContext()).some(
            t => t.name === SHOW_ONBOARDING_ROLE_PICKER_TOOL_NAME,
          ),
        ).toBe(true)
      })
    })

    test('create(createExplicitToolDeps()) runs with zero ALS for role, dismissed, and empty resolution paths', async () => {
      expect(hasActiveSessionAls()).toBe(false)
      expect(ShowOnboardingRolePickerTool.isReadOnly({})).toBe(true)
      expect(ShowOnboardingRolePickerTool.isConcurrencySafe({})).toBe(false)
      expect(ShowOnboardingRolePickerTool.shouldDefer).toBe(false)

      const deps = createExplicitToolDeps()
      const instance = ShowOnboardingRolePickerTool.create(deps)
      const callCtx = createToolCallContext({ toolUseId: 'tu_role_1' })

      const perm = await instance.checkPermissions?.({}, callCtx)
      expect(perm?.behavior).toBe('ask')
      if (perm?.behavior === 'ask') {
        expect(perm.updatedInput).toEqual({})
      }

      // P1-6: model-spoofed `role` and `dismissed` must be stripped in checkPermissions
      const spoofedPerm = await instance.checkPermissions?.(
        { role: 'Engineering', dismissed: true },
        callCtx,
      )
      expect(spoofedPerm?.behavior).toBe('ask')
      if (spoofedPerm?.behavior === 'ask') {
        expect(spoofedPerm.updatedInput).toEqual({})
        expect(Object.hasOwn(spoofedPerm.updatedInput ?? {}, 'role')).toBe(
          false,
        )
        expect(Object.hasOwn(spoofedPerm.updatedInput ?? {}, 'dismissed')).toBe(
          false,
        )
      }

      // Path 1: chip click or free-form typed role (trimmed)
      const roleRes = await instance.call({ role: '  Legal  ' }, callCtx)
      expect(roleRes.data).toEqual({ role: 'Legal' })
      expect(
        ShowOnboardingRolePickerTool.mapToolResultToToolResultBlockParam(
          roleRes.data,
          'tu_role_1',
        ),
      ).toEqual({
        type: 'tool_result',
        tool_use_id: 'tu_role_1',
        content: '{"role":"Legal"}',
      })

      // Path 2: X button dismissal
      const dismissedRes = await instance.call({ dismissed: true }, callCtx)
      expect(dismissedRes.data).toEqual({ dismissed: true })
      expect(
        ShowOnboardingRolePickerTool.mapToolResultToToolResultBlockParam(
          dismissedRes.data,
          'tu_role_2',
        ),
      ).toEqual({
        type: 'tool_result',
        tool_use_id: 'tu_role_2',
        content: '{"dismissed":true}',
      })

      // Path 3: approved without picking a role (or blank role string)
      const emptyRes = await instance.call({}, callCtx)
      expect(emptyRes.data).toEqual({})
      const blankRoleRes = await instance.call({ role: '   ' }, callCtx)
      expect(blankRoleRes.data).toEqual({})
      expect(
        ShowOnboardingRolePickerTool.mapToolResultToToolResultBlockParam(
          emptyRes.data,
          'tu_role_3',
        ),
      ).toEqual({
        type: 'tool_result',
        tool_use_id: 'tu_role_3',
        content: '{}',
      })

      // Schema validation
      expect(
        ShowOnboardingRolePickerTool.inputSchema.safeParse({}).success,
      ).toBe(true)
      expect(
        ShowOnboardingRolePickerTool.inputSchema.safeParse({
          unknownField: 123,
        }).success,
      ).toBe(false)
      expect(
        ShowOnboardingRolePickerTool.outputSchema.safeParse(roleRes.data)
          .success,
      ).toBe(true)
    })
  })

  describe('ProjectsTool', () => {
    test('gate works via per-HostSlot provider registration and env var, isolated across SessionHosts', () => {
      setEnv('CLAUDE_CODE_PROJECTS_SESSION', undefined)

      const sessionA = makeTestSession()
      const sessionB = makeTestSession()

      let disposeA: (() => void) | undefined
      runWithSession(sessionA, () => {
        expect(hasProjectsToolProvider()).toBe(false)
        expect(ProjectsTool.isEnabled()).toBe(false)

        disposeA = registerProjectsToolProvider(() => ({ hits: [], total: 0 }))
        expect(hasProjectsToolProvider()).toBe(true)
        expect(ProjectsTool.isEnabled()).toBe(true)
        expect(
          getTools(getEmptyToolPermissionContext()).some(
            t => t.name === PROJECTS_TOOL_NAME,
          ),
        ).toBe(true)
      })

      runWithSession(sessionB, () => {
        expect(hasProjectsToolProvider()).toBe(false)
        expect(getProjectsToolProvider()).toBeUndefined()
        expect(ProjectsTool.isEnabled()).toBe(false)

        setEnv('CLAUDE_CODE_PROJECTS_SESSION', 'true')
        expect(ProjectsTool.isEnabled()).toBe(true)
        expect(
          getTools(getEmptyToolPermissionContext()).some(
            t => t.name === PROJECTS_TOOL_NAME,
          ),
        ).toBe(true)
      })

      // Dispose cleans up only its own registration
      runWithSession(sessionA, () => {
        disposeA?.()
        expect(hasProjectsToolProvider()).toBe(false)
      })
    })

    test('create(createExplicitToolDeps()) runs list, search, read with zero ALS and never touches disk when diskless', async () => {
      expect(hasActiveSessionAls()).toBe(false)
      expect(ProjectsTool.isReadOnly({ action: 'search' })).toBe(true)
      expect(ProjectsTool.isConcurrencySafe({ action: 'search' })).toBe(true)
      expect(ProjectsTool.shouldDefer).toBe(false)

      const disklessSessionA = makeTestSession(true)
      const disklessSessionB = makeTestSession(true)

      const receivedCalls: Array<{
        input: ProjectsToolInput
        aborted: boolean
      }> = []

      const dispose = registerProjectsToolProvider(
        async (input, { signal }) => {
          receivedCalls.push({ input, aborted: signal.aborted })
          if (input.action === 'list') {
            return {
              hits: [
                { id: 'doc-1', title: 'Q4 Plan', project_id: 'proj-1' },
                { id: 'doc-2', title: 'Architecture', project_id: 'proj-1' },
                { id: 'doc-3', title: 'Runbook', project_id: 'proj-1' },
              ],
              total: 3,
            }
          }
          if (input.action === 'read') {
            return {
              hits: [
                {
                  id: input.doc_id ?? 'doc-1',
                  title: 'Q4 Plan',
                  text: 'Revenue targets and milestones.',
                  project_id: input.project_id ?? 'proj-1',
                  image_attached: true,
                  page: input.page ?? 1,
                },
              ],
              total: 1,
            }
          }
          return {
            hits: [
              {
                id: 'doc-2',
                title: 'Architecture',
                text: `Matched query: ${input.query ?? ''}`,
                project_id: input.project_id ?? 'proj-1',
              },
            ],
            total: 1,
          }
        },
        disklessSessionA.host,
      )

      try {
        const depsA = createExplicitToolDeps({ session: disklessSessionA })
        const instanceA = ProjectsTool.create(depsA)
        const callCtx = createToolCallContext({ toolUseId: 'tu_proj_1' })

        const perm = await instanceA.checkPermissions?.(
          { action: 'search', query: 'architecture' },
          callCtx,
        )
        expect(perm).toEqual({
          behavior: 'allow',
          updatedInput: { action: 'search', query: 'architecture' },
        })

        // list with limit=2 caps hits while preserving provider total=3
        const listRes = await instanceA.call(
          { action: 'list', project_id: 'proj-1', limit: 2 },
          callCtx,
        )
        expect(listRes.data.hits).toHaveLength(2)
        expect(listRes.data.total).toBe(3)

        // search
        const searchRes = await instanceA.call(
          { action: 'search', query: 'architecture', project_id: 'proj-1' },
          callCtx,
        )
        expect(searchRes.data).toEqual({
          hits: [
            {
              id: 'doc-2',
              title: 'Architecture',
              text: 'Matched query: architecture',
              project_id: 'proj-1',
            },
          ],
          total: 1,
        })

        // read with page & image_attached
        const readRes = await instanceA.call(
          { action: 'read', doc_id: 'doc-1', project_id: 'proj-1', page: 2 },
          callCtx,
        )
        expect(readRes.data).toEqual({
          hits: [
            {
              id: 'doc-1',
              title: 'Q4 Plan',
              text: 'Revenue targets and milestones.',
              project_id: 'proj-1',
              image_attached: true,
              page: 2,
            },
          ],
          total: 1,
        })
        expect(ProjectsTool.outputSchema.safeParse(readRes.data).success).toBe(
          true,
        )

        // mapToolResultToToolResultBlockParam
        const block = ProjectsTool.mapToolResultToToolResultBlockParam(
          readRes.data,
          'tu_proj_1',
        )
        expect(block.type).toBe('tool_result')
        expect(block.tool_use_id).toBe('tu_proj_1')
        expect(JSON.parse(String(block.content))).toEqual(readRes.data)

        // Unconfigured diskless host B fails loudly instead of silently returning empty hits (never leaks host A)
        const depsB = createExplicitToolDeps({ session: disklessSessionB })
        await expect(
          ProjectsTool.create(depsB).call(
            { action: 'search', query: 'secret' },
            callCtx,
          ),
        ).rejects.toThrow('no Projects provider is registered')
        expect(receivedCalls).toHaveLength(3)

        // Input schema defaults, action-specific requirements (P2-6), & bounds validation
        const parsedDefault = ProjectsTool.inputSchema.safeParse({
          query: 'roadmap',
        })
        expect(parsedDefault.success).toBe(true)
        if (parsedDefault.success) {
          expect(parsedDefault.data.action).toBe('search')
          expect(parsedDefault.data.query).toBe('roadmap')
        }
        // P2-6: search requires non-empty trimmed query (including default action)
        expect(ProjectsTool.inputSchema.safeParse({}).success).toBe(false)
        expect(
          ProjectsTool.inputSchema.safeParse({ action: 'search' }).success,
        ).toBe(false)
        expect(
          ProjectsTool.inputSchema.safeParse({ action: 'search', query: '' })
            .success,
        ).toBe(false)
        expect(
          ProjectsTool.inputSchema.safeParse({
            action: 'search',
            query: '   ',
          }).success,
        ).toBe(false)
        // P2-6: read requires non-empty trimmed doc_id
        expect(
          ProjectsTool.inputSchema.safeParse({ action: 'read' }).success,
        ).toBe(false)
        expect(
          ProjectsTool.inputSchema.safeParse({ action: 'read', doc_id: '' })
            .success,
        ).toBe(false)
        expect(
          ProjectsTool.inputSchema.safeParse({ action: 'read', doc_id: '   ' })
            .success,
        ).toBe(false)
        expect(
          ProjectsTool.inputSchema.safeParse({
            action: 'read',
            doc_id: 'doc-1',
          }).success,
        ).toBe(true)
        // list requires neither doc_id nor query
        expect(
          ProjectsTool.inputSchema.safeParse({ action: 'list' }).success,
        ).toBe(true)
        expect(
          ProjectsTool.inputSchema.safeParse({ action: 'list', limit: 0 })
            .success,
        ).toBe(false)
        expect(
          ProjectsTool.inputSchema.safeParse({ action: 'list', limit: 51 })
            .success,
        ).toBe(false)
        expect(
          ProjectsTool.inputSchema.safeParse({
            action: 'read',
            doc_id: 'doc-1',
            page: 0,
          }).success,
        ).toBe(false)
        expect(
          ProjectsTool.inputSchema.safeParse({
            action: 'list',
            unknownKey: true,
          }).success,
        ).toBe(false)
      } finally {
        dispose()
      }
    })
  })

  describe('1:1 official 2.1.331 tool registry alignment', () => {
    test('retired non-2.1.331 tools are excluded from getAllBaseTools()', () => {
      const names = new Set(getAllBaseTools().map(t => t.name))
      for (const retired of [
        'LocalMemoryRecall',
        'CtxInspect',
        'VerifyPlanExecution',
        'TerminalCapture',
      ]) {
        expect(names.has(retired)).toBe(false)
      }
    })

    test('R4-P1-7: OfferChromeSetup and ShowOnboardingRolePicker are disallowed for subagents/forks', () => {
      expect(ALL_AGENT_DISALLOWED_TOOLS.has(OFFER_CHROME_SETUP_TOOL_NAME)).toBe(
        true,
      )
      expect(
        ALL_AGENT_DISALLOWED_TOOLS.has(SHOW_ONBOARDING_ROLE_PICKER_TOOL_NAME),
      ).toBe(true)

      const filtered = filterParentToolsForFork([
        OfferChromeSetupTool as unknown as Tool,
        ShowOnboardingRolePickerTool as unknown as Tool,
        ProjectsTool as unknown as Tool,
      ])
      expect(filtered.map(t => t.name)).toEqual([PROJECTS_TOOL_NAME])
    })

    test('R4-P1-8: builtin-tools barrel re-exports host wiring setters and Chrome disconnect reports per-session', () => {
      expect(
        typeof builtinToolsIndex.markChromeExtensionNotConnectedReported,
      ).toBe('function')
      expect(typeof builtinToolsIndex.setHostRendersChromeSetupOffer).toBe(
        'function',
      )
      expect(typeof builtinToolsIndex.setOnboardingRolePickerEnabled).toBe(
        'function',
      )
      expect(typeof builtinToolsIndex.registerProjectsToolProvider).toBe(
        'function',
      )

      const sessionA = makeTestSession()
      const sessionB = makeTestSession()

      runWithSession(sessionA, () => {
        setHostRendersChromeSetupOffer(true)
        expect(OfferChromeSetupTool.isEnabled()).toBe(false)
        const ctx = createChromeContext({})
        ctx.onToolCallDisconnected()
        expect(hasChromeExtensionNotConnectedReport()).toBe(true)
        expect(OfferChromeSetupTool.isEnabled()).toBe(true)
      })

      runWithSession(sessionB, () => {
        expect(hasChromeExtensionNotConnectedReport()).toBe(false)
        expect(OfferChromeSetupTool.isEnabled()).toBe(false)
      })
    })

    test('R4-P2-6: ProjectsTool guards null/undefined provider results and stale retired tool comments are cleaned up', async () => {
      const session = makeTestSession(true)
      const dispose = registerProjectsToolProvider(
        () => undefined as unknown as ProjectsToolOutput,
        session.host,
      )
      try {
        const deps = createExplicitToolDeps({ session })
        const callCtx = createToolCallContext({ toolUseId: 'tu_proj_null' })
        const res = await ProjectsTool.create(deps).call(
          { action: 'list' },
          callCtx,
        )
        expect(res.data).toEqual({ hits: [], total: 0 })
      } finally {
        dispose()
      }

      const repoRoot = resolve(import.meta.dir, '../../../../..')
      for (const relPath of [
        'packages/builtin-tools/src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts',
        'src/schemas/hooks.ts',
        'src/services/SessionMemory/multiStore.ts',
        'src/types/logs.ts',
        'src/utils/localValidate.ts',
        'docs/HANDOVER.md',
        'docs/features/all-features-guide.md',
        'docs/design/tool-search-design-guide.md',
        'docs/internals/ant-only-world.mdx',
      ]) {
        const content = readFileSync(resolve(repoRoot, relPath), 'utf8')
        expect(content).not.toMatch(
          /LocalMemoryRecallTool|CtxInspectTool|VerifyPlanExecutionTool|TerminalCaptureTool|ctx_inspect/,
        )
      }
    })
  })
})
