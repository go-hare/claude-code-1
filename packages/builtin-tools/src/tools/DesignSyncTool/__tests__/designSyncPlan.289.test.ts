import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { realpath } from 'fs/promises'

import { authMock } from '../../../../../../tests/mocks/auth'

mock.module('src/utils/auth.js', authMock)

const NETWORK_BLOCK = 'CLAUDE_CODE_DESIGN_SYNC_TEST_BLOCK'
const previousBlock = process.env[NETWORK_BLOCK]

beforeAll(() => {
  process.env[NETWORK_BLOCK] = '1'
})

afterAll(() => {
  if (previousBlock === undefined) delete process.env[NETWORK_BLOCK]
  else process.env[NETWORK_BLOCK] = previousBlock
})

const { DesignSyncTool } = await import('../DesignSyncTool.js')
const { designSessionState, readDesignPlan } = await import(
  'src/services/designProjectGrant.js'
)
const { ToolStateSlots } = await import('src/utils/toolState.js')
const { getCwd } = await import('src/utils/cwd.js')

const PLAN_MISMATCH =
  'Plan token is missing or does not match this project. Call finalize_plan first.'

const OUTSIDE =
  'Cannot write paths outside the finalized plan: readme.md. Re-run finalize_plan with the full set.'

function credentials() {
  return {
    designOauth: {
      accessToken: 'design-token-secret',
      refreshToken: 'r',
      expiresAt: Date.now() + 60_000,
      scopes: ['user:design:read', 'user:design:write'],
      clientId: 'id',
    },
  }
}

function ctx(toolState: InstanceType<typeof ToolStateSlots>) {
  return {
    abortController: new AbortController(),
    toolState,
    options: { isNonInteractiveSession: true },
    credentials: credentials(),
    getAppState: () => ({
      toolPermissionContext: { mode: 'default' },
    }),
  } as never
}

const finalizeInput = {
  method: 'finalize_plan' as const,
  projectId: 'proj-1',
  writes: ['components/button.html', 'tokens/color.json'],
  deletes: ['legacy/old.html'],
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(item => typeof item === 'string')
}

function finalizedPlan(data: object): {
  planId: string
  writes: string[]
  deletes: string[]
} {
  const planId = Reflect.get(data, 'planId')
  if (typeof planId !== 'string') {
    throw new Error('finalize_plan did not return a planId')
  }
  return {
    planId,
    writes: stringList(Reflect.get(data, 'writes')),
    deletes: stringList(Reflect.get(data, 'deletes')),
  }
}

describe('gold 2.1.289 DesignSync plan registration', () => {
  test('essential traffic disables the tool', () => {
    const previous = process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    try {
      expect(DesignSyncTool.isEnabled()).toBe(false)
    } finally {
      if (previous === undefined) {
        delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
      } else {
        process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = previous
      }
    }
  })

  test('wire name, search hint, and Design: prefix', () => {
    expect(DesignSyncTool.name).toBe('DesignSync')
    expect(DesignSyncTool.searchHint).toBe(
      'sync local design system components to a claude.ai/design project',
    )
    expect(DesignSyncTool.shouldDefer).toBe(true)
    expect(DesignSyncTool.backgrounding).toBe('never')
    expect(DesignSyncTool.userFacingName({ method: 'list_projects' })).toBe(
      'Design: List design-system projects',
    )
  })

  test('finalize_plan stores a plan on this toolState and returns its id', async () => {
    const slots = new ToolStateSlots()
    const result = await DesignSyncTool.call(finalizeInput, ctx(slots))
    const plan = finalizedPlan(result.data)
    expect(plan.planId).toMatch(/^plan_[a-z0-9]{1,16}_[a-f0-9]{12}$/)
    expect(result.data.method).toBe('finalize_plan')
    expect(plan.writes).toEqual(['components/button.html', 'tokens/color.json'])
    expect(plan.deletes).toEqual(['legacy/old.html'])
    const stored = readDesignPlan(
      designSessionState({ toolState: slots }),
      plan.planId,
    )
    expect(stored?.projectId).toBe('proj-1')
    expect(stored?.writes).toEqual([
      'components/button.html',
      'tokens/color.json',
    ])
    expect(stored?.deletes).toEqual(['legacy/old.html'])
    expect(stored?.localDir).toBe(await realpath(getCwd()))
  })

  test('write_files with a missing or mismatched plan throws the gold sentence', async () => {
    const slots = new ToolStateSlots()
    const context = ctx(slots)
    const finalized = finalizedPlan(
      (await DesignSyncTool.call(finalizeInput, context)).data,
    )
    await expect(
      DesignSyncTool.call(
        {
          method: 'write_files',
          projectId: 'proj-1',
          planId: 'missing-plan',
          files: [{ path: 'components/button.html', data: '<p>ok</p>' }],
        },
        context,
      ),
    ).rejects.toThrow(PLAN_MISMATCH)
    await expect(
      DesignSyncTool.call(
        {
          method: 'write_files',
          projectId: 'other-project',
          planId: finalized.planId,
          files: [{ path: 'components/button.html', data: '<p>ok</p>' }],
        },
        context,
      ),
    ).rejects.toThrow(PLAN_MISMATCH)
  })

  test('write_files outside the plan throws the gold sentence', async () => {
    const slots = new ToolStateSlots()
    const context = ctx(slots)
    const finalized = finalizedPlan(
      (await DesignSyncTool.call(finalizeInput, context)).data,
    )
    await expect(
      DesignSyncTool.call(
        {
          method: 'write_files',
          projectId: 'proj-1',
          planId: finalized.planId,
          files: [{ path: 'readme.md', data: 'nope' }],
        },
        context,
      ),
    ).rejects.toThrow(OUTSIDE)
  })

  test('a second toolState does not see the plan', async () => {
    const slots = new ToolStateSlots()
    const otherSlots = new ToolStateSlots()
    const planId = finalizedPlan(
      (await DesignSyncTool.call(finalizeInput, ctx(slots))).data,
    ).planId
    expect(
      readDesignPlan(designSessionState({ toolState: otherSlots }), planId),
    ).toBeNull()
    expect(
      readDesignPlan(designSessionState({ toolState: slots }), planId)
        ?.projectId,
    ).toBe('proj-1')
    await expect(
      DesignSyncTool.call(
        {
          method: 'write_files',
          projectId: 'proj-1',
          planId,
          files: [{ path: 'components/button.html', data: '<p>ok</p>' }],
        },
        ctx(otherSlots),
      ),
    ).rejects.toThrow(PLAN_MISMATCH)
  })
})
