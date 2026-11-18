import { describe, expect, spyOn, test } from 'bun:test'
import * as sideQuestionMod from '../../../utils/sideQuestion.js'
import * as promptsMod from '../../../constants/prompts.js'
import * as contextMod from '../../../context.js'
import { getInFlightBtw, runNonInteractiveBtw } from '../btw.js'
import type { ProcessUserInputContext } from '../../../utils/processUserInput/processUserInput.js'

function makeContext(
  abortController = new AbortController(),
): ProcessUserInputContext {
  return {
    messages: [],
    abortController,
    options: {
      tools: [],
      mainLoopModel: 'claude-sonnet-4-6',
      mcpClients: [],
    },
  } as unknown as ProcessUserInputContext
}

describe('2.1.299 #669 non-interactive /btw dedup & session-end abort', () => {
  test('deduplicates identical mid-run non-interactive requests', async () => {
    let calls = 0
    let resolveRun!: (v: sideQuestionMod.SideQuestionResult) => void

    const promptSpy = spyOn(promptsMod, 'getSystemPrompt').mockResolvedValue([
      'sys',
    ] as never)
    const userCtxSpy = spyOn(contextMod, 'getUserContext').mockResolvedValue(
      {} as never,
    )
    const sysCtxSpy = spyOn(contextMod, 'getSystemContext').mockResolvedValue(
      {} as never,
    )
    const runSpy = spyOn(sideQuestionMod, 'runSideQuestion').mockImplementation(
      () =>
        new Promise(resolve => {
          calls++
          resolveRun = resolve
        }) as ReturnType<typeof sideQuestionMod.runSideQuestion>,
    )

    try {
      const ctx = makeContext()
      const p1 = runNonInteractiveBtw('same question', ctx)
      // Yield macrotask so buildCacheSafeParams settles and p1 reaches runSideQuestion
      await new Promise(r => setTimeout(r, 0))
      expect(getInFlightBtw()?.question).toBe('same question')

      const p2 = runNonInteractiveBtw('same question', ctx)
      resolveRun({
        response: 'answer',
        synthetic: false,
      } as sideQuestionMod.SideQuestionResult)

      const [r1, r2] = await Promise.all([p1, p2])
      expect(calls).toBe(1)
      expect(r1).toEqual({ response: 'answer', synthetic: false })
      expect(r2).toEqual({ response: 'answer', synthetic: false })
      expect(getInFlightBtw()).toBeNull()
    } finally {
      promptSpy.mockRestore()
      userCtxSpy.mockRestore()
      sysCtxSpy.mockRestore()
      runSpy.mockRestore()
    }
  })

  test('aborts in-flight non-interactive /btw when session abortController aborts', async () => {
    const promptSpy = spyOn(promptsMod, 'getSystemPrompt').mockResolvedValue([
      'sys',
    ] as never)
    const userCtxSpy = spyOn(contextMod, 'getUserContext').mockResolvedValue(
      {} as never,
    )
    const sysCtxSpy = spyOn(contextMod, 'getSystemContext').mockResolvedValue(
      {} as never,
    )
    let seenSignal: AbortSignal | undefined
    const runSpy = spyOn(sideQuestionMod, 'runSideQuestion').mockImplementation(
      ({ parentController }) => {
        seenSignal = parentController?.signal
        return new Promise(resolve => {
          parentController?.signal.addEventListener('abort', () => {
            resolve({ response: undefined, aborted: true } as never)
          })
        })
      },
    )

    try {
      const sessionAc = new AbortController()
      const ctx = makeContext(sessionAc)
      const p = runNonInteractiveBtw('abort me', ctx)
      await new Promise(r => setTimeout(r, 0))

      expect(seenSignal?.aborted).toBe(false)
      sessionAc.abort()
      const res = await p
      expect(seenSignal?.aborted).toBe(true)
      expect(res).toBeNull()
      expect(getInFlightBtw()).toBeNull()
    } finally {
      promptSpy.mockRestore()
      userCtxSpy.mockRestore()
      sysCtxSpy.mockRestore()
      runSpy.mockRestore()
    }
  })
})
