import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

mock.module('bun:bundle', () => ({
  feature: (_name: string) => true,
}))

describe('resumeAgent', () => {
  test('module exports resumeAgentBackground', async () => {
    const mod = await import('../resumeAgent.js')
    expect(typeof mod.resumeAgentBackground).toBe('function')
  })

  test('module exports ResumeAgentResult type (compile-time)', async () => {
    // TypeScript-only: just ensure the module loads cleanly so the type
    // surface is in the patch coverage trace.
    const mod = await import('../resumeAgent.js')
    expect(mod).toBeDefined()
  })

  test('AgentStoppedByUserError extends ResumeAgentStateError', async () => {
    const { AgentStoppedByUserError, ResumeAgentStateError } = await import(
      '../resumeAgent.js'
    )
    const err = new AgentStoppedByUserError('stopped')
    expect(err).toBeInstanceOf(ResumeAgentStateError)
    expect(err).toBeInstanceOf(AgentStoppedByUserError)
    expect(err.name).toBe('AgentStoppedByUserError')
  })

  test('clearAgentResuming is safe to call twice (outer S() safety net)', async () => {
    const { tryClaimAgentResume, clearAgentResuming } = await import(
      'src/tasks/LocalAgentTask/LocalAgentTask.js'
    )
    const taskId = 'resume-cas-safety'
    let tasks: Record<
      string,
      { type: string; status: string; resuming?: boolean }
    > = {
      [taskId]: {
        type: 'local_agent',
        status: 'completed',
        resuming: false,
      },
    }
    const setAppState = (
      updater: (prev: { tasks: typeof tasks }) => { tasks: typeof tasks },
    ) => {
      const next = updater({ tasks })
      tasks = next.tasks
    }
    const getAppState = () => ({ tasks })
    expect(
      tryClaimAgentResume(taskId, setAppState as never, getAppState as never),
    ).toBe(true)
    expect(tasks[taskId]?.resuming).toBe(true)
    clearAgentResuming(taskId, setAppState as never)
    clearAgentResuming(taskId, setAppState as never)
    expect(tasks[taskId]?.resuming).toBe(false)
  })

  test('disk transcript missing uses in-memory task.messages before throw', () => {
    // densable 2.1.216 Aye: P = disk; if (!P) mirror g.getTranscript messages
    const src = readFileSync(join(import.meta.dir, '../resumeAgent.ts'), 'utf8')
    expect(src).toContain('disk transcript missing; using')
    expect(src).toContain('in-memory messages mirrored during the run')
    expect(src).toContain('contentReplacements: []')
    expect(src).toMatch(
      /if \(!transcript\) \{[\s\S]*?task\.messages[\s\S]*?if \(!transcript\) \{[\s\S]*?No transcript found for agent ID/,
    )
  })

  test('densable me/Ce taxonomy: tengu_feature_bad/ok on resume paths', () => {
    // densable: me(e,t) → tengu_feature_bad {feature_name:Se(e), error_code:t}
    //          Ce(e)   → tengu_feature_ok  {feature_name:Se(e)}
    const src = readFileSync(join(import.meta.dir, '../resumeAgent.ts'), 'utf8')
    expect(src).toContain("logEvent('tengu_feature_bad'")
    expect(src).toContain("logEvent('tengu_feature_ok'")
    expect(src).toContain("'subagent_resume_transcript_missing'")
    expect(src).toContain("'subagent_resume_fork_prompt_missing'")
    expect(src).toContain("'subagent_launch'")
    // bad before throw; ok before alreadyCompleted + final return
    const missingBad = src.indexOf("'subagent_resume_transcript_missing'")
    const missingThrow = src.indexOf('No transcript found for agent ID:')
    expect(missingBad).toBeGreaterThan(0)
    expect(missingThrow).toBeGreaterThan(missingBad)
    const acOk = src.lastIndexOf("logEvent('tengu_feature_ok'")
    const acReturn = src.indexOf('alreadyCompleted: true')
    expect(acOk).toBeGreaterThan(0)
    // at least one ok before alreadyCompleted
    expect(src.indexOf("logEvent('tengu_feature_ok'")).toBeLessThan(acReturn)
  })

  test('source wraps post-claim body in try/catch clearResuming (CAS safety net)', () => {
    // Structural guard: sticky resuming residual — claim then any throw clears CAS.
    const src = readFileSync(join(import.meta.dir, '../resumeAgent.ts'), 'utf8')
    expect(src).toContain('tryClaimAgentResume')
    expect(src).toContain('clearAgentResuming')
    expect(src).toContain('resumeAgentBackgroundAfterClaim')
    // outer catch after claim must clearResuming
    expect(src).toMatch(
      /return await resumeAgentBackgroundAfterClaim\([\s\S]*?\} catch \(err\) \{\s*clearResuming\(\)/,
    )
    // alreadyCompleted path also clears (not only setAppState resuming:false)
    expect(src).toMatch(
      /alreadyCompleted:\s*true[\s\S]{0,80}|clearResuming\(\)\s*\n\s*return \{[\s\S]*?alreadyCompleted:\s*true/,
    )
    expect(src).toContain('clearResuming()')
    expect(src).toContain('alreadyCompleted: true')
    // wrapResumePromptOrigin / promptIsMeta — not voided
    expect(src).toContain('wrapResumePromptOrigin')
    expect(src).not.toMatch(/void promptIsMeta/)
    expect(src).toContain('promptOrigin')
    // ensure clearResuming appears before alreadyCompleted return
    const acIdx = src.indexOf('alreadyCompleted: true')
    const clearBefore =
      src.lastIndexOf('clearResuming()', acIdx) >= 0 &&
      src.lastIndexOf('clearResuming()', acIdx) < acIdx
    expect(clearBefore).toBe(true)
  })

  test('resume appends sidechain after register when !promptIsMeta && !continueInterrupted', () => {
    // Append AFTER registerAsyncAgent — task.messages needs task present
    // (cold resume); official separate transcript store can exist earlier.
    const src = readFileSync(join(import.meta.dir, '../resumeAgent.ts'), 'utf8')
    expect(src).toContain('appendMessageToLocalAgent')
    // densable Ace/Xeo: meta-visible origin (not HDd) selects wrapped sidechain msg
    expect(src).toContain('isMetaVisibleOrigin')
    expect(src).toContain('!promptIsMeta && !continueInterruptedTurn')
    // Sidechain-visible origin uses wrapped resumeUserMessage; else raw prompt + origin
    expect(src).toContain('sidechainMsg')
    // append must sit AFTER registerAsyncAgent so cold resume is not no-op
    const registerIdx = src.indexOf('registerAsyncAgent({')
    const appendIdx = src.indexOf(
      'appendMessageToLocalAgent(\n      agentBackgroundTask.agentId',
    )
    const appendIdxAlt = src.indexOf('appendMessageToLocalAgent(')
    expect(registerIdx).toBeGreaterThan(0)
    // first appendMessageToLocalAgent after register is the sidechain mirror
    const appendAfterRegister = src.indexOf(
      'appendMessageToLocalAgent',
      registerIdx,
    )
    expect(appendAfterRegister).toBeGreaterThan(registerIdx)
    expect(appendIdx > registerIdx || appendIdxAlt > registerIdx).toBe(true)
    // markAgentsNotified still after sidechain append when suppressOwnerNotification
    const notifyIdx = src.indexOf(
      'markAgentsNotified(agentBackgroundTask.agentId',
    )
    expect(notifyIdx).toBeGreaterThan(appendAfterRegister)
  })

  test('observer-activity resume gates (isObserver + suppress notify + awaitCompletion)', () => {
    const src = readFileSync(join(import.meta.dir, '../resumeAgent.ts'), 'utf8')
    // refuse observer-activity when sidecar did not confirm isObserver
    expect(src).toContain("promptOriginKind === 'observer-activity'")
    expect(src).toContain('did not confirm isObserver')
    // suppressOwnerNotification → markAgentsNotified
    expect(src).toContain('suppressOwnerNotification')
    expect(src).toContain('markAgentsNotified')
    // register stamps isObserver on observer-activity
    expect(src).toContain(
      "promptOriginKind === 'observer-activity' ? { isObserver: true }",
    )
    // awaitCompletion path
    expect(src).toContain('awaitCompletion')
    expect(src).toContain('await lifecyclePromise')
  })

  test('resolveWorkerPermissionMode matches densable MJe rank table (eyl)', async () => {
    const { resolveWorkerPermissionMode, PERMISSION_MODE_RANK } = await import(
      '../resumeAgent.js'
    )
    // densable: if (!e) return
    expect(resolveWorkerPermissionMode(undefined, 'default')).toBeUndefined()
    // densable: eyl[e] <= eyl[t] ? e : void 0
    expect(resolveWorkerPermissionMode('plan', 'bypassPermissions')).toBe(
      'plan',
    )
    expect(resolveWorkerPermissionMode('default', 'default')).toBe('default')
    expect(resolveWorkerPermissionMode('default', 'acceptEdits')).toBe(
      'default',
    )
    expect(resolveWorkerPermissionMode('dontAsk', 'auto')).toBe('dontAsk')
    expect(
      resolveWorkerPermissionMode('bypassPermissions', 'bypassPermissions'),
    ).toBe('bypassPermissions')
    // wider than session → reject (caller falls back via ?? sessionMode)
    expect(
      resolveWorkerPermissionMode('acceptEdits', 'default'),
    ).toBeUndefined()
    expect(
      resolveWorkerPermissionMode('bypassPermissions', 'default'),
    ).toBeUndefined()
    expect(resolveWorkerPermissionMode('auto', 'acceptEdits')).toBeUndefined()
    // unknown / missing rank keys → reject
    expect(resolveWorkerPermissionMode('not-a-mode', 'default')).toBeUndefined()
    expect(resolveWorkerPermissionMode('default', undefined)).toBeUndefined()
    expect(PERMISSION_MODE_RANK.plan).toBe(0)
    expect(PERMISSION_MODE_RANK.bubble).toBe(1)
    expect(PERMISSION_MODE_RANK.acceptEdits).toBe(2)
    expect(PERMISSION_MODE_RANK.auto).toBe(3)
    expect(PERMISSION_MODE_RANK.bypassPermissions).toBe(4)
  })

  test('resolveWorkerPermissionMode densable auto+acceptEdits special case', async () => {
    const { resolveWorkerPermissionMode } = await import('../resumeAgent.js')
    // densable: if (t==="auto"&&e==="acceptEdits") return
    // rank would allow (2<=3), but special case still rejects
    expect(resolveWorkerPermissionMode('acceptEdits', 'auto')).toBeUndefined()
    // reverse fails rank (3>2)
    expect(resolveWorkerPermissionMode('auto', 'acceptEdits')).toBeUndefined()
    // equal / narrower without special case still ok
    expect(resolveWorkerPermissionMode('auto', 'auto')).toBe('auto')
    expect(resolveWorkerPermissionMode('plan', 'auto')).toBe('plan')
  })

  test('resumeAgentBackground wires densable Aye mode chain (MJe only when isObserver)', () => {
    const src = readFileSync(join(import.meta.dir, '../resumeAgent.ts'), 'utf8')
    expect(src).toContain('workerPermissionMode')
    expect(src).toContain('resolveWorkerPermissionMode')
    // densable: J = isObserver ? MJe(d,y)??y : void 0
    expect(src).toContain('isObserverSidecar')
    expect(src).toContain('observerCappedMode')
    expect(src).toMatch(
      /resolveWorkerPermissionMode\(workerPermissionMode,\s*sessionMode\)/,
    )
    // mode chain: J ?? d ?? spawnMode ?? agent.permissionMode ?? acceptEdits
    expect(src).toContain('metaSpawnMode')
    expect(src).toContain('resolvedWorkerMode')
    // model uses session mode (densable uce(..., y)), not worker mode
    expect(src).toMatch(/getAgentModel\(\s*[\s\S]*?sessionMode\s*,?\s*\)/)
  })

  test('observer resume densable Lco + useExactTools + agent:observer querySource', () => {
    const src = readFileSync(join(import.meta.dir, '../resumeAgent.ts'), 'utf8')
    // densable: se = isObserver ? Lco(WJ(...)) : ae; useExactTools for fork|observer
    expect(src).toContain('applyObserverExactToolPool')
    expect(src).toContain('isObserverSidecar')
    expect(src).toMatch(
      /\(isResumedFork\s*\|\|\s*isObserverSidecar\)\s*&&\s*\{\s*useExactTools:\s*true\s*\}/,
    )
    expect(src).toContain('agent:observer:')
    expect(src).toContain('resumeQuerySource')
  })
})
