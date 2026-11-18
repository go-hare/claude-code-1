import { afterEach, describe, expect, test } from 'bun:test'
import { setLoadedFunctionHooksModules } from '../../../utils/plugins/functionHooksModules.js'
import { saveThemeWithConfigSetHook } from '../theme.js'

function registerLoadedFunctionHooksModule(
  mod: Parameters<typeof setLoadedFunctionHooksModules>[0][number],
) {
  setLoadedFunctionHooksModules([mod])
}

describe('Official 2.1.292 #243 /theme config.set hook gate', () => {
  afterEach(() => {
    setLoadedFunctionHooksModules([])
  })

  test('allows saving theme when no config.set hook denies', async () => {
    setLoadedFunctionHooksModules([])
    let persisted: string | undefined
    const res = await saveThemeWithConfigSetHook('dark', setting => {
      persisted = setting
    })
    expect(res).toEqual({ kind: 'saved', saved: 'dark' })
    expect(persisted).toBe('dark')
  })

  test('refuses saving theme before persistence when config.set hook returns deny', async () => {
    setLoadedFunctionHooksModules([])
    registerLoadedFunctionHooksModule({
      name: 'deny-theme',
      patterns: ['config.set'],
      hooks: [
        {
          pattern: 'config.set',
          hook: async (_api, e, next) => {
            if (e.key === 'theme') {
              return { deny: 'locked by policy' }
            }
            return next(e)
          },
        },
      ],
    })

    let persisted: string | undefined
    const res = await saveThemeWithConfigSetHook('light', setting => {
      persisted = setting
    })
    expect(res).toEqual({ kind: 'refused', reason: 'locked by policy' })
    expect(persisted).toBeUndefined()
  })

  test('persists hook-modified theme value when config.set hook transforms it', async () => {
    setLoadedFunctionHooksModules([])
    registerLoadedFunctionHooksModule({
      name: 'override-theme',
      patterns: ['config.set'],
      hooks: [
        {
          pattern: 'config.set',
          hook: async (_api, e, next) =>
            next({ ...e, value: 'dark-daltonized' }),
        },
      ],
    })

    let persisted: string | undefined
    const res = await saveThemeWithConfigSetHook('dark', setting => {
      persisted = setting
    })
    expect(res).toEqual({ kind: 'saved', saved: 'dark-daltonized' })
    expect(persisted).toBe('dark-daltonized')
  })
})
