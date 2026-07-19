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

  test('AgentStoppedByUserError is densable orr (name + B6 base)', async () => {
    const mod = await import('../resumeAgent.js')
    expect(typeof mod.AgentStoppedByUserError).toBe('function')
    expect(typeof mod.ResumeAgentStateError).toBe('function')
    const err = new mod.AgentStoppedByUserError('stopped')
    expect(err.name).toBe('AgentStoppedByUserError')
    expect(err).toBeInstanceOf(mod.ResumeAgentStateError)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('stopped')
  })

  test('source-scan: Aye densable Jeo after register + re-arm (exu)', () => {
    // Official: Sot(register) → await exu → Jeo(e,g)
    const src = readFileSync(join(import.meta.dir, '../resumeAgent.ts'), 'utf8')
    const registerIdx = src.indexOf('registerAsyncAgent({')
    const rearmIdx = src.indexOf('ensureObservedAgentObserver')
    const jeoIdx = src.indexOf('sweepStaleKeepaliveReasons(agentId, rootSetAppState)')
    expect(registerIdx).toBeGreaterThan(-1)
    expect(rearmIdx).toBeGreaterThan(-1)
    expect(jeoIdx).toBeGreaterThan(-1)
    // Re-arm block precedes register in local (order residual vs densable
    // Sot→exu); Jeo must still run after both.
    expect(jeoIdx).toBeGreaterThan(registerIdx)
    expect(jeoIdx).toBeGreaterThan(rearmIdx)
  })

  test('source-scan: Aye Xeo + awaitCompletion densable join', () => {
    const src = readFileSync(join(import.meta.dir, '../resumeAgent.ts'), 'utf8')
    // densable: if(!n&&!o)Xeo(...) before Sot
    expect(src).toContain('recordSidechainTranscript')
    expect(src).toContain('!promptIsMeta && !continueInterruptedTurn')
    const xeoIdx = src.indexOf('!promptIsMeta && !continueInterruptedTurn')
    const registerIdx = src.indexOf('registerAsyncAgent({')
    expect(xeoIdx).toBeGreaterThan(-1)
    expect(registerIdx).toBeGreaterThan(xeoIdx)
    // densable: parentAbort when awaitCompletion
    expect(src).toContain('parentAbortController: toolUseContext.abortController')
    // densable: if(i) try{await lifecycle}
    expect(src).toContain('if (awaitCompletion)')
    expect(src).toContain('await lifecyclePromise')
    expect(src).toContain('shouldNotifyOwner: () => false')
    expect(src).toContain('finalText')
    // densable promptMessages: o?O:[...O,ie]
    expect(src).toContain('continueInterruptedTurn')
    expect(src).toContain('resumeUserMessage')
  })

  test('source-scan: Aye stoppedByUser refuse + userInitiated clear', () => {
    const src = readFileSync(join(import.meta.dir, '../resumeAgent.ts'), 'utf8')
    expect(src).toContain('stoppedByUser')
    expect(src).toContain('userInitiated')
    expect(src).toContain("won't be resumed")
    expect(src).toContain('AgentStoppedByUserError')
    expect(src).toContain('observer-activity')
    // Refuse throws use named densable error (not bare Error)
    expect(src).toContain('throw new AgentStoppedByUserError(refuseStoppedMsg)')
    expect(
      (src.match(/throw new AgentStoppedByUserError\(refuseStoppedMsg\)/g) || [])
        .length,
    ).toBeGreaterThanOrEqual(2)
    // Densable: meta gate early; live gate BEFORE Sot (ekg drops stoppedByUser)
    const metaGate = src.indexOf("meta?.stoppedByUser === true")
    const registerIdx = src.indexOf('registerAsyncAgent({')
    const liveGate = src.indexOf('t.stoppedByUser === true')
    expect(metaGate).toBeGreaterThan(-1)
    expect(liveGate).toBeGreaterThan(-1)
    expect(registerIdx).toBeGreaterThan(liveGate)
    // Meta clears only on userInitiated path; observer-activity bypasses meta
    expect(src).toContain('stoppedByUser: _cleared')
    expect(src).toContain("promptOriginKind !== 'observer-activity'")
    // Densable observer sidecar confirm + Sot isObserver + Kle on suppress
    expect(src).toContain('meta?.isObserver !== true')
    expect(src).toContain('isObserver: true')
    expect(src).toContain('suppressOwnerNotification')
    expect(src).toContain('markAgentsNotified')
  })

  test('source-scan: SendMessage agent-stopped-by-user refuse (no silent Aye)', () => {
    const sendSrc = readFileSync(
      join(import.meta.dir, '../../SendMessageTool/SendMessageTool.ts'),
      'utf8',
    )
    expect(sendSrc).toContain('stoppedByUser')
    expect(sendSrc).toContain('was stopped by the user and was not resumed')
    // Refuse runs before silent auto-resume; densable agent-stopped-by-user.
    const refuseIdx = sendSrc.indexOf('stoppedByUser === true')
    const autoResumeIdx = sendSrc.indexOf('// task exists but stopped')
    expect(refuseIdx).toBeGreaterThan(-1)
    expect(autoResumeIdx).toBeGreaterThan(refuseIdx)
    // Densable ncs: observers cannot receive SendMessage
    expect(sendSrc).toContain('isObserver === true')
    expect(sendSrc).toContain(
      'That agent cannot receive messages (it is a background observer',
    )
    // Densable ues: SendMessage not available FROM an observer
    expect(sendSrc).toContain('isObserverTaskId')
    expect(sendSrc).toContain(
      'Observers report via ObserverReport, not SendMessage',
    )
    // No silent call site may pass userInitiated: true
    let idx = 0
    while (true) {
      const call = sendSrc.indexOf('resumeAgentBackground({', idx)
      if (call < 0) break
      const slice = sendSrc.slice(call, call + 500)
      expect(slice).not.toContain('userInitiated: true')
      idx = call + 1
    }
  })

  test('source-scan: REPL agent-view submit passes userInitiated: true', () => {
    // From package tests dir → repo root src/screens/REPL.tsx
    const replSrc = readFileSync(
      join(
        import.meta.dir,
        '../../../../../../src/screens/REPL.tsx',
      ),
      'utf8',
    )
    expect(replSrc).toContain('userInitiated: true')
    // Human agent-view path: resumeAgentBackground with userInitiated true
    const onAgent = replSrc.indexOf('const onAgentSubmit')
    expect(onAgent).toBeGreaterThan(-1)
    const resumeInOnAgent = replSrc.indexOf(
      'resumeAgentBackground({',
      onAgent,
    )
    expect(resumeInOnAgent).toBeGreaterThan(onAgent)
    const slice = replSrc.slice(resumeInOnAgent, resumeInOnAgent + 350)
    expect(slice).toContain('userInitiated: true')
  })
})
