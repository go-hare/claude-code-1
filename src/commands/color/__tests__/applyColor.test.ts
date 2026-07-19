import { beforeEach, describe, expect, mock, test } from 'bun:test'

const state = {
  isTeammate: false,
  saved: [] as Array<{ color: string }>,
  appColor: undefined as string | undefined,
}

const realTeammate = require('src/utils/teammate.ts') as Record<string, unknown>
mock.module('src/utils/teammate.js', () => ({
  ...realTeammate,
  isTeammate: () => state.isTeammate,
}))

const realBootstrap = require('src/bootstrap/state.ts') as Record<
  string,
  unknown
>
mock.module('src/bootstrap/state.js', () => ({
  ...realBootstrap,
  getSessionId: () => '00000000-0000-0000-0000-000000000001',
}))

const realSession = require('src/utils/sessionStorage.ts') as Record<
  string,
  unknown
>
mock.module('src/utils/sessionStorage.js', () => ({
  ...realSession,
  getTranscriptPath: () => '/tmp/transcript.jsonl',
  saveAgentColor: async (_id: string, color: string) => {
    state.saved.push({ color })
  },
}))

const { applyColor, colorArgumentHint } = await import('../applyColor.js')

beforeEach(() => {
  state.isTeammate = false
  state.saved = []
  state.appColor = undefined
})

describe('applyColor (densable Xfo)', () => {
  const ctx = {
    setAppState: (
      fn: (p: {
        standaloneAgentContext?: { name?: string; color?: string }
      }) => {
        standaloneAgentContext?: { name?: string; color?: string }
      },
    ) => {
      const next = fn({
        standaloneAgentContext: { name: '', color: undefined },
      })
      state.appColor = next.standaloneAgentContext?.color
    },
  }

  test('sets a valid color', async () => {
    const msg = await applyColor('red', ctx as never)
    expect(msg).toBe('Session color set to: red')
    expect(state.saved.at(-1)?.color).toBe('red')
    expect(state.appColor).toBe('red')
  })

  test('resets on default', async () => {
    const msg = await applyColor('default', ctx as never)
    expect(msg).toBe('Session color reset to default')
    expect(state.saved.at(-1)?.color).toBe('default')
    expect(state.appColor).toBeUndefined()
  })

  test('rejects invalid', async () => {
    const msg = await applyColor('neon', ctx as never)
    expect(msg).toContain('Invalid color')
    expect(state.saved).toEqual([])
  })

  test('teammate blocked', async () => {
    state.isTeammate = true
    const msg = await applyColor('red', ctx as never)
    expect(msg).toContain('teammate')
  })

  test('argument hint lists colors', () => {
    expect(colorArgumentHint()).toContain('red')
    expect(colorArgumentHint()).toContain('default')
  })
})
