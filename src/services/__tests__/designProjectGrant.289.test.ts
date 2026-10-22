import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'

import { authMock } from '../../../tests/mocks/auth'
import { setupAxiosMock } from '../../../tests/mocks/axios'

mock.module('src/utils/auth.js', authMock)

const axiosHandle = setupAxiosMock()

type GrantBody = { grants: unknown } | 'throw'

let grantStatus = 200
let grantBody: GrantBody = { grants: [] }
let getCalls = 0
let holdGets = false
let releaseGets: (() => void) | undefined
let held: Promise<void> | null = null
let postResult: { status: number; data: unknown } = {
  status: 200,
  data: {},
}

axiosHandle.stubs.get = async () => {
  getCalls += 1
  if (holdGets) {
    held ??= new Promise<void>(resolve => {
      releaseGets = resolve
    })
    await held
  }
  if (grantBody === 'throw') throw new Error('grants down')
  return { status: grantStatus, data: grantBody }
}
axiosHandle.stubs.post = async () => postResult

beforeAll(() => {
  axiosHandle.useStubs = true
})

afterAll(() => {
  axiosHandle.useStubs = false
})

const {
  createDesignProjectGrantWatcher,
  designSessionState,
  forgetDesignStateForClearedConsent,
  readDesignPlan,
  recordFinalizedDesignPlan,
  registerDesignPlan,
  rememberDesignProjectGrant,
  resetDesignProjectGrantForTests,
  seedDesignGrantProbe,
  noteDesignProjectMembershipChange,
  writeDesignConsentBit,
} = await import('../designProjectGrant.js')
const { ToolStateSlots } = await import('../../utils/toolState.js')
const { applyConnectorDesignMembership, connectorDesignTokenlessWriteDeny } =
  await import('../mcp/connectorDesign.js')

let sessionSlots: InstanceType<typeof ToolStateSlots> | undefined

function session() {
  sessionSlots ??= new ToolStateSlots()
  return designSessionState({ toolState: sessionSlots })
}
const { deleteDesignConsent, postDesignConsent, seedDesignConsentCache } =
  await import('../designConsent.js')
const { callDesignConsent } = await import(
  '../../commands/design-consent/call.js'
)
const { ClaudeDesignTool } = await import(
  '../../../packages/builtin-tools/src/tools/ClaudeDesignTool/ClaudeDesignTool.js'
)

function mainContext() {
  sessionSlots ??= new ToolStateSlots()
  return {
    agentContext: { agentType: 'main' },
    toolState: sessionSlots,
    getAppState: () => ({
      toolPermissionContext: { mode: 'default' },
      sessionHooks: new Map(),
    }),
    abortController: new AbortController(),
    options: { isNonInteractiveSession: false },
  } as never
}

const writeInput = {
  operation: 'write_files',
  arguments: {
    project_id: 'p1',
    files: [{ path: 'a.html', data: 'x' }],
  },
}

describe('gold 2.1.289 design project grant', () => {
  afterEach(() => {
    sessionSlots = undefined
    seedDesignConsentCache(null)
    resetDesignProjectGrantForTests()
    grantStatus = 200
    grantBody = { grants: [] }
    getCalls = 0
    holdGets = false
    releaseGets = undefined
    held = null
    postResult = { status: 200, data: {} }
  })

  test('seedDesignGrantProbe skips the grants GET', async () => {
    seedDesignConsentCache(true)
    seedDesignGrantProbe(['p1'])
    const decision = await ClaudeDesignTool.checkPermissions!(
      writeInput,
      mainContext(),
    )
    expect(decision.behavior).toBe('allow')
    expect(getCalls).toBe(0)
  })

  test('probeGrants shares one in-flight GET', async () => {
    seedDesignConsentCache(true)
    holdGets = true
    grantBody = {
      grants: [{ project_id: 'p1', created_at: '2020-01-01T00:00:00.000Z' }],
    }
    const first = ClaudeDesignTool.checkPermissions!(writeInput, mainContext())
    const second = ClaudeDesignTool.checkPermissions!(writeInput, mainContext())
    for (let i = 0; i < 20 && getCalls === 0; i++) await Promise.resolve()
    expect(getCalls).toBe(1)
    releaseGets?.()
    const [left, right] = await Promise.all([first, second])
    expect(left.behavior).toBe('allow')
    expect(right.behavior).toBe('allow')
    expect(getCalls).toBe(1)
  })

  test('nwo remembers a grant newer than a baseline with no created_at', async () => {
    seedDesignConsentCache(true)
    const watcher = createDesignProjectGrantWatcher(session(), 'p1')
    grantBody = { grants: [] }
    expect(await watcher.poll()).toBe(false)
    grantBody = {
      grants: [{ project_id: 'p1', created_at: '2020-01-02T00:00:00.000Z' }],
    }
    expect(await watcher.poll()).toBe(true)
    seedDesignGrantProbe('unavailable')
    const remembered = await ClaudeDesignTool.checkPermissions!(
      writeInput,
      mainContext(),
    )
    expect(remembered.behavior).toBe('allow')
  })

  test('a grant remembered on one toolState is invisible to another', async () => {
    seedDesignConsentCache(true)
    const watcher = createDesignProjectGrantWatcher(session(), 'p1')
    grantBody = { grants: [] }
    expect(await watcher.poll()).toBe(false)
    grantBody = {
      grants: [{ project_id: 'p1', created_at: '2020-01-02T00:00:00.000Z' }],
    }
    expect(await watcher.poll()).toBe(true)
    seedDesignGrantProbe('unavailable')
    const other = new ToolStateSlots()
    const decision = await ClaudeDesignTool.checkPermissions!(writeInput, {
      ...(mainContext() as object),
      toolState: other,
    } as never)
    expect(decision.behavior).toBe('deny')
  })

  test('nwo failed polls do not move the baseline', async () => {
    const watcher = createDesignProjectGrantWatcher(session(), 'p1')
    grantBody = {
      grants: [{ project_id: 'p1', created_at: 'not-a-date' }],
    }
    expect(await watcher.poll()).toBe(false)
    grantBody = {
      grants: [{ project_id: 'p1', created_at: '2020-01-01T00:00:00.000Z' }],
    }
    expect(await watcher.poll()).toBe(false)
    grantStatus = 404
    expect(await watcher.poll()).toBe(false)
    grantStatus = 200
    grantBody = 'throw'
    expect(await watcher.poll()).toBe(false)
    grantBody = { grants: { nope: true } }
    expect(await watcher.poll()).toBe(false)
    grantBody = {
      grants: [{ project_id: 'p1', created_at: '2020-01-01T00:00:00.000Z' }],
    }
    expect(await watcher.poll()).toBe(false)
    grantBody = {
      grants: [{ project_id: 'p1', created_at: '2020-01-02T00:00:00.000Z' }],
    }
    expect(await watcher.poll()).toBe(true)
  })

  test('nwo does not remember a project that needs recard', async () => {
    const watcher = createDesignProjectGrantWatcher(session(), 'p1')
    grantBody = {
      grants: [{ project_id: 'p1', created_at: '2020-01-01T00:00:00.000Z' }],
    }
    expect(await watcher.poll()).toBe(false)
    forgetDesignStateForClearedConsent(session())
    grantBody = {
      grants: [{ project_id: 'p1', created_at: '2020-01-02T00:00:00.000Z' }],
    }
    expect(await watcher.poll()).toBe(false)
    seedDesignConsentCache(true)
    seedDesignGrantProbe('unavailable')
    const decision = await ClaudeDesignTool.checkPermissions!(
      writeInput,
      mainContext(),
    )
    expect(decision.behavior).toBe('deny')
  })

  test('update_sharing drops the plan, the grant, and marks recard', async () => {
    recordFinalizedDesignPlan(session(), 'old_tok', {
      projectId: 'p1',
      writes: ['a.html'],
      deletes: [],
    })
    rememberDesignProjectGrant(session(), 'p1')
    const droppedPlan = registerDesignPlan(session(), {
      projectId: 'p1',
      writes: ['a.html'],
      deletes: [],
    })
    const keptPlan = registerDesignPlan(session(), {
      projectId: 'p2',
      writes: ['a.html'],
      deletes: [],
    })
    recordFinalizedDesignPlan(session(), 'keep_tok', {
      projectId: 'p2',
      writes: ['a.html'],
      deletes: [],
    })
    grantBody = {
      grants: [{ project_id: 'p1', created_at: '2020-01-01T00:00:00.000Z' }],
    }
    const watcher = createDesignProjectGrantWatcher(session(), 'p1')
    expect(await watcher.poll()).toBe(false)
    postResult = { status: 200, data: { result: { isError: false } } }
    await ClaudeDesignTool.call(
      {
        operation: 'update_sharing',
        arguments: { project_id: 'p1', scope: 'invited' },
      },
      mainContext(),
    )
    await ClaudeDesignTool.call(
      {
        operation: 'remove_member',
        arguments: { project_id: 'p2', account_uuid: 'user-1' },
      },
      mainContext(),
    )
    grantBody = {
      grants: [{ project_id: 'p1', created_at: '2020-01-02T00:00:00.000Z' }],
    }
    expect(await watcher.poll()).toBe(false)
    expect(readDesignPlan(session(), droppedPlan)).toBeNull()
    expect(readDesignPlan(session(), keptPlan)?.projectId).toBe('p2')
    seedDesignConsentCache(true)
    seedDesignGrantProbe('unavailable')
    const dropped = await ClaudeDesignTool.checkPermissions!(
      {
        operation: 'write_files',
        arguments: {
          project_id: 'p1',
          plan_token: 'old_tok',
          files: [{ path: 'a.html', data: 'x' }],
        },
      },
      mainContext(),
    )
    expect(dropped.behavior).toBe('ask')
    const grant = await ClaudeDesignTool.checkPermissions!(
      writeInput,
      mainContext(),
    )
    expect(grant.behavior).toBe('deny')
    const kept = await ClaudeDesignTool.checkPermissions!(
      {
        operation: 'write_files',
        arguments: {
          project_id: 'p2',
          plan_token: 'keep_tok',
          files: [{ path: 'a.html', data: 'x' }],
        },
      },
      mainContext(),
    )
    expect(kept.behavior).toBe('allow')
  })

  test('finalize_plan success records the approved plan', async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    postResult = {
      status: 200,
      data: {
        result: {
          isError: false,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                plan_token: 'plan_tok',
                expires_at: expiresAt,
              }),
            },
          ],
        },
      },
    }
    const result = await ClaudeDesignTool.call(
      {
        operation: 'finalize_plan',
        arguments: {
          project_id: 'p1',
          writes: ['a.html'],
          deletes: ['old.html'],
        },
        __finalizePlanAskShown: true,
        __consentAskCanReachUser: true,
      } as never,
      mainContext(),
    )
    expect(result.data.isError).toBe(false)
    seedDesignConsentCache(true)
    seedDesignGrantProbe([])
    const allowed = await ClaudeDesignTool.checkPermissions!(
      {
        operation: 'write_files',
        arguments: {
          project_id: 'p1',
          plan_token: 'plan_tok',
          files: [{ path: 'a.html', data: 'x' }],
        },
      },
      mainContext(),
    )
    expect(allowed.behavior).toBe('allow')
    expect(getCalls).toBe(0)
  })

  test('finalize_plan clears prior plans before a failed RPC', async () => {
    recordFinalizedDesignPlan(session(), 'old_tok', {
      projectId: 'p1',
      writes: ['a.html'],
      deletes: [],
    })
    postResult = { status: 500, data: { error: 'nope' } }
    const result = await ClaudeDesignTool.call(
      {
        operation: 'finalize_plan',
        arguments: { project_id: 'p1', writes: ['b.html'] },
        __consentAskCanReachUser: true,
      } as never,
      mainContext(),
    )
    expect(result.data.isError).toBe(true)
    seedDesignConsentCache(true)
    seedDesignGrantProbe([])
    const decision = await ClaudeDesignTool.checkPermissions!(
      {
        operation: 'write_files',
        arguments: {
          project_id: 'p1',
          plan_token: 'old_tok',
          files: [{ path: 'a.html', data: 'x' }],
        },
      },
      mainContext(),
    )
    expect(decision.behavior).toBe('ask')
  })

  test('ene(false) clears plans, grants, and planStore on that state only', () => {
    const state = session()
    recordFinalizedDesignPlan(state, 'tok', {
      projectId: 'p1',
      writes: ['a.html'],
      deletes: [],
    })
    rememberDesignProjectGrant(state, 'p1')
    const planId = registerDesignPlan(state, {
      projectId: 'p1',
      writes: ['a.html'],
      deletes: ['old.html'],
    })
    const other = designSessionState({ toolState: new ToolStateSlots() })
    recordFinalizedDesignPlan(other, 'other_tok', {
      projectId: 'p2',
      writes: ['b.html'],
      deletes: [],
    })
    rememberDesignProjectGrant(other, 'p2')
    const otherPlan = registerDesignPlan(other, {
      projectId: 'p2',
      writes: ['b.html'],
      deletes: [],
    })

    writeDesignConsentBit(state, 'agent_design_projects', false)

    expect(state.approvedPlans.size).toBe(0)
    expect(state.verifiedProjectGrants.size).toBe(0)
    expect(state.planStore.size).toBe(0)
    expect(state.recardAllProjects).toBe(true)
    expect(state.consentCache?.agent_design_projects).toBe(false)
    expect(readDesignPlan(state, planId)).toBeNull()
    expect(other.approvedPlans.size).toBe(1)
    expect(other.verifiedProjectGrants.has('p2')).toBe(true)
    expect(readDesignPlan(other, otherPlan)?.projectId).toBe('p2')
    expect(other.consentCache).toBeNull()
  })

  test('consent POST records the bit and DELETE clears that state', async () => {
    const state = session()
    registerDesignPlan(state, {
      projectId: 'p1',
      writes: ['a.html'],
      deletes: [],
    })
    rememberDesignProjectGrant(state, 'p1')
    axiosHandle.stubs.delete = async () => ({ status: 200, data: {} })
    await postDesignConsent(state)
    expect(state.consentCache?.agent_design_projects).toBe(true)
    expect(state.planStore.size).toBe(1)
    expect(state.verifiedProjectGrants.has('p1')).toBe(true)
    await deleteDesignConsent(state)
    expect(state.consentCache?.agent_design_projects).toBe(false)
    expect(state.planStore.size).toBe(0)
    expect(state.verifiedProjectGrants.size).toBe(0)
    expect(state.approvedPlans.size).toBe(0)
  })

  test('FZt revoke clears the session toolState it is given', async () => {
    const state = session()
    registerDesignPlan(state, {
      projectId: 'p1',
      writes: ['a.html'],
      deletes: [],
    })
    rememberDesignProjectGrant(state, 'p1')
    axiosHandle.stubs.delete = async () => ({ status: 200, data: {} })
    const result = await callDesignConsent('revoke', {
      toolState: sessionSlots,
      credentials: { claudeAiOauth: { accessToken: 'design-token' } },
    } as never)
    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.value).toBe(
        'Design agent access revoked for your Claude Design projects.',
      )
    }
    expect(state.planStore.size).toBe(0)
    expect(state.verifiedProjectGrants.size).toBe(0)
    expect(state.approvedPlans.size).toBe(0)
  })

  test('needs_consent not_shown clears that tool state only', async () => {
    const state = session()
    registerDesignPlan(state, {
      projectId: 'p1',
      writes: ['a.html'],
      deletes: [],
    })
    rememberDesignProjectGrant(state, 'p1')
    const other = designSessionState({ toolState: new ToolStateSlots() })
    const otherPlan = registerDesignPlan(other, {
      projectId: 'p2',
      writes: ['b.html'],
      deletes: [],
    })
    postResult = {
      status: 403,
      data: { error: 'needs_consent', consent: 'agent_design_projects' },
    }
    const result = await ClaudeDesignTool.call(
      {
        operation: 'read_file',
        arguments: { project_id: 'p1', path: 'a.html' },
      },
      mainContext(),
    )
    expect(result.data.isError).toBe(true)
    expect(state.planStore.size).toBe(0)
    expect(state.verifiedProjectGrants.size).toBe(0)
    expect(state.consentCache?.agent_design_projects).toBe(false)
    expect(readDesignPlan(other, otherPlan)?.projectId).toBe('p2')
    expect(other.consentCache).toBeNull()
  })

  test('connector membership clear uses a fake toolState', () => {
    const slots = new ToolStateSlots()
    const state = designSessionState({ toolState: slots })
    recordFinalizedDesignPlan(state, 'old_tok', {
      projectId: 'p1',
      writes: ['a.html'],
      deletes: [],
    })
    rememberDesignProjectGrant(state, 'p1')
    const droppedPlan = registerDesignPlan(state, {
      projectId: 'p1',
      writes: ['a.html'],
      deletes: [],
    })
    const keptPlan = registerDesignPlan(state, {
      projectId: 'p2',
      writes: ['b.html'],
      deletes: [],
    })
    recordFinalizedDesignPlan(state, 'keep_tok', {
      projectId: 'p2',
      writes: ['b.html'],
      deletes: [],
    })
    rememberDesignProjectGrant(state, 'p2')

    applyConnectorDesignMembership(
      false,
      'add_member',
      { project_id: 'p1' },
      (operation, projectId) => {
        noteDesignProjectMembershipChange(state, operation, projectId)
      },
    )
    expect(state.verifiedProjectGrants.has('p1')).toBe(true)
    expect(readDesignPlan(state, droppedPlan)?.projectId).toBe('p1')

    applyConnectorDesignMembership(
      true,
      'write_files',
      { project_id: 'p1' },
      (operation, projectId) => {
        noteDesignProjectMembershipChange(state, operation, projectId)
      },
    )
    expect(state.verifiedProjectGrants.has('p1')).toBe(true)

    applyConnectorDesignMembership(
      true,
      'add_member',
      { project_id: '' },
      (operation, projectId) => {
        noteDesignProjectMembershipChange(state, operation, projectId)
      },
    )
    expect(state.verifiedProjectGrants.has('p1')).toBe(true)

    applyConnectorDesignMembership(
      true,
      'add_member',
      { project_id: 'p1' },
      (operation, projectId) => {
        noteDesignProjectMembershipChange(
          designSessionState({ toolState: slots }),
          operation,
          projectId,
        )
      },
    )
    expect(state.verifiedProjectGrants.has('p1')).toBe(false)
    expect(state.approvedPlans.has('old_tok')).toBe(false)
    expect(readDesignPlan(state, droppedPlan)).toBeNull()
    expect(state.recardProjects.has('p1')).toBe(true)
    expect(state.verifiedProjectGrants.has('p2')).toBe(true)
    expect(state.approvedPlans.has('keep_tok')).toBe(true)
    expect(readDesignPlan(state, keptPlan)?.projectId).toBe('p2')

    const denied = connectorDesignTokenlessWriteDeny(true, 'copy_files', {
      project_id: 'p2',
    })
    expect(denied?.behavior).toBe('deny')
    expect(state.verifiedProjectGrants.has('p2')).toBe(true)
  })
})
