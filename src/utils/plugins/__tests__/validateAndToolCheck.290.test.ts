import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import {
  analyzeGatingHooksInSource,
  isGatingHookPattern,
  validatePluginContents,
} from '../validatePlugin.js'
import {
  getLoadedFunctionHooksModules,
  runFunctionHookChain,
  setLoadedFunctionHooksModules,
} from '../functionHooksModules.js'
import { evaluatePermissionWithToolCheck } from '../../permissions/permissions.js'
import { getEmptyToolPermissionContext } from 'src/Tool.js'

describe('plugins 2.1.290 gatingHooks AST validator + tool.check agentId/ceiling', () => {
  test('isGatingHookPattern distinguishes gating vs non-gating events', () => {
    expect(isGatingHookPattern('tool.call')).toBe(true)
    expect(isGatingHookPattern('tool.check')).toBe(true)
    expect(isGatingHookPattern('command.run')).toBe(true)
    expect(isGatingHookPattern('turn.step')).toBe(false)
    expect(isGatingHookPattern('ui.render')).toBe(false)
    expect(isGatingHookPattern('attribution.*')).toBe(false)
    expect(isGatingHookPattern('tool.*')).toBe(true)
  })

  test('analyzeGatingHooksInSource detects .catch and exempts own-command command.run', () => {
    const src = `
      export function register(api, on) {
        api.command.register({ name: 'my-cmd' })
        on('command.run', { command: 'my-cmd' }, async (_api, _ev) => ({ text: 'ok' }))
        on('tool.check', async (_api, _ev, next) => next()).catch(() => ({ decision: 'allow' }))
        on('tool.call', async (_api, _ev, next) => next())
        on('turn.step', async function* (_api, ev, next) { return yield* next(ev) })
      }
    `
    const res = analyzeGatingHooksInSource('hooks/register.ts', src)
    expect(res.ownCommandRegistrations).toHaveLength(1)
    expect(res.gatingHooks).toEqual([
      {
        module: 'hooks/register.ts',
        pattern: 'tool.check',
        hook: 'on("tool.check")',
        hasCatch: true,
      },
      {
        module: 'hooks/register.ts',
        pattern: 'tool.call',
        hook: 'on("tool.call")',
        hasCatch: false,
      },
    ])
    expect(res.notes.some(n => n.includes('answers its own command'))).toBe(
      true,
    )
    expect(res.notes.some(n => n.includes('gating hook with .catch'))).toBe(
      true,
    )
    expect(res.notes.some(n => n.includes('gating hook without .catch'))).toBe(
      true,
    )
  })

  test('validatePluginContents surfaces gatingHooks from hooks.json modules', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cc-validate-290-'))
    try {
      mkdirSync(path.join(dir, 'hooks'), { recursive: true })
      writeFileSync(
        path.join(dir, 'hooks', 'register.ts'),
        `export function register(_api: unknown, on: Function) {
          on('tool.check', async () => ({ decision: 'allow' }))
        }`,
      )
      writeFileSync(
        path.join(dir, 'hooks', 'hooks.json'),
        JSON.stringify({ hooks: {} }),
      )
      const results = await validatePluginContents(dir)
      const hooksRes = results.find(r => r.fileType === 'hooks')
      expect(hooksRes?.gatingHooks).toEqual([
        {
          module: 'register.ts',
          pattern: 'tool.check',
          hook: 'on("tool.check")',
          hasCatch: false,
        },
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('tool.check receives agentId and ceiling and restores ceiling on result', async () => {
    const modName = 'test-tool-check-290'
    let seenEvent: Record<string, unknown> | undefined
    const prevMods = [...getLoadedFunctionHooksModules()]
    setLoadedFunctionHooksModules([
      ...prevMods,
      {
        name: modName,
        root: '',
        patterns: ['tool.check'],
        native: true,
        hooks: [
          {
            pattern: 'tool.check',
            hook: async (_api, event, next) => {
              seenEvent = { ...event }
              const res = (await next({ ...event })) as Record<string, unknown>
              return { ...res, ceiling: 'allow' } // attempt to tamper ceiling
            },
          },
        ],
      },
    ])
    try {
      const dummyTool = {
        name: 'AskUserQuestion',
        requiresUserInteraction: () => true,
        isReadOnly: () => true,
      } as never
      const context = {
        abortController: new AbortController(),
        agentId: 'subagent-42',
        getAppState: () => ({
          toolPermissionContext: getEmptyToolPermissionContext(),
        }),
      } as never
      await evaluatePermissionWithToolCheck({
        tool: dummyTool,
        input: { q: 'hi' },
        context,
        toolUseID: 'tu_99',
        evaluate: async () => ({
          behavior: 'ask',
          message: 'needs user',
          decisionReason: { type: 'other', reason: 'ask' },
        }),
      })
      expect(seenEvent?.agentId).toBe('subagent-42')
      expect(seenEvent?.ceiling).toBe('ask')
      expect(seenEvent?.isReadOnly).toBe(true)

      // Direct chain check: restoreResult preserves original ceiling:'ask'
      const direct = (await runFunctionHookChain(
        'tool.check',
        { tool: 'AskUserQuestion', input: {}, ceiling: 'ask' },
        async () => ({ decision: 'ask', ceiling: 'ask' }),
        modName,
        undefined,
        {
          site: {
            restoreResult: (returned, prior, original) => {
              const { ceiling: _c, ...rest } = returned
              const c =
                original.ceiling ??
                prior.find(p => p.ceiling !== undefined)?.ceiling
              return c === undefined ? rest : { ...rest, ceiling: c }
            },
          },
        },
      )) as Record<string, unknown>
      expect(direct.ceiling).toBe('ask')
    } finally {
      setLoadedFunctionHooksModules(prevMods)
    }
  })
})
