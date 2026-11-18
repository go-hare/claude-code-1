import { afterEach, describe, expect, test } from 'bun:test'
import { setLoadedFunctionHooksModules } from '../../utils/plugins/functionHooksModules.js'
import { saveModelWithConfigSetHook } from '../model/model.js'
import { saveFastModeWithConfigSetHook } from '../fast/index.js'
import { saveOutputStyleWithConfigSetHook } from '../output-style/index.js'
import { saveAutoUpdatesChannelWithConfigSetHook } from '../../components/Settings/Config.js'

function installConfigSetHook(
  handler: (
    input: Record<string, unknown>,
    next: (input: Record<string, unknown>) => Promise<unknown>,
  ) => Promise<unknown>,
): void {
  setLoadedFunctionHooksModules([
    {
      name: 'test-plugin',
      patterns: ['config.set'],
      hooks: [
        {
          pattern: 'config.set',
          hook: async (_api, e, next) =>
            handler(
              e as Record<string, unknown>,
              next as (input: Record<string, unknown>) => Promise<unknown>,
            ),
        },
      ],
    },
  ])
}

describe('Official 2.1.295 #407 & #441 config.set hooks for /model, /fast, /output-style, /config', () => {
  afterEach(() => {
    setLoadedFunctionHooksModules([])
  })

  test('#407 saveModelWithConfigSetHook refuses before persistence on deny', async () => {
    installConfigSetHook(async () => ({ deny: 'model locked by policy' }))
    let persisted = false
    const res = await saveModelWithConfigSetHook(
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      () => {
        persisted = true
      },
    )
    expect(persisted).toBe(false)
    expect(res).toEqual({ kind: 'refused', reason: 'model locked by policy' })
  })

  test('#407 saveFastModeWithConfigSetHook persists when allowed and honors modified value', async () => {
    installConfigSetHook(async (e, next) => next({ ...e, value: false }))
    let saved: boolean | undefined
    const res = await saveFastModeWithConfigSetHook(true, false, v => {
      saved = v
    })
    expect(saved).toBe(false)
    expect(res).toEqual({ kind: 'saved', saved: false })
  })

  test('#407 saveOutputStyleWithConfigSetHook refuses before persistence on deny', async () => {
    installConfigSetHook(async () => ({ deny: 'style locked' }))
    let persisted = false
    const res = await saveOutputStyleWithConfigSetHook(
      'explanatory',
      'default',
      () => {
        persisted = true
      },
    )
    expect(persisted).toBe(false)
    expect(res).toEqual({ kind: 'refused', reason: 'style locked' })
  })

  test('#441 saveAutoUpdatesChannelWithConfigSetHook refuses before persistence on deny', async () => {
    installConfigSetHook(async () => ({ deny: 'channel pinned to stable' }))
    let persisted = false
    const res = await saveAutoUpdatesChannelWithConfigSetHook(
      'latest',
      'stable',
      () => {
        persisted = true
      },
    )
    expect(persisted).toBe(false)
    expect(res).toEqual({ kind: 'refused', reason: 'channel pinned to stable' })
  })

  test('#441 saveAutoUpdatesChannelWithConfigSetHook persists when allowed', async () => {
    let saved: string | undefined
    const res = await saveAutoUpdatesChannelWithConfigSetHook(
      'stable',
      'latest',
      ch => {
        saved = ch
      },
    )
    expect(saved).toBe('stable')
    expect(res).toEqual({ kind: 'saved', saved: 'stable' })
  })
})
