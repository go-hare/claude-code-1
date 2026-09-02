/**
 * densable shouldStopBeforeNextApiCall → background_requested (239).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(import.meta.dir, '../..')

describe('shouldStopBeforeNextApiCall → background_requested (239)', () => {
  test('ToolUseContext declares shouldStopBeforeNextApiCall', () => {
    const tool = readFileSync(join(root, 'Tool.ts'), 'utf8')
    expect(tool).toContain('shouldStopBeforeNextApiCall?: () => boolean')
  })

  test('query returns background_requested when hook fires on main', () => {
    const query = readFileSync(join(root, 'query.ts'), 'utf8')
    expect(query).toContain("return { reason: 'background_requested' }")
    expect(query).toContain('shouldStopBeforeNextApiCall?.()')
    expect(query).toContain('!toolUseContext.agentId')
  })

  test('REPL wires Ki hook + onCancel clear + post-query proceed', () => {
    const repl = readFileSync(join(root, 'screens/REPL.tsx'), 'utf8')
    expect(repl).toContain(
      'shouldStopBeforeNextApiCall: () => leftArrowDeferRef.current !== null',
    )
    expect(repl).toContain('densable onCancel: clearCapTimer')
    expect(repl).toContain(
      'densable TurnController finally: clearCapTimer on unmount',
    )
    expect(repl).toContain('densable _runImpl post-query')
    expect(repl).toContain('countLeftArrowBlockingQueuedCommands')
    expect(repl).toContain('await K9(W.getSnapshot()')
    expect(repl).toContain('await recordTranscript')
    expect(repl).toContain('const $e = await arm.proceed()')
    expect(repl).toContain("createSystemMessage($e, 'warning')")
    expect(repl).toContain('leftArrowToAgentsFired.current = true')
    expect(repl).toContain('markIdleForkMidTurn()')
    expect(repl).toContain('if (jpt.current || _r.current) return')
    expect(repl).toContain('HUo: jpt || Ki !== null || _r')
    expect(repl).toContain('proceed: () => Promise<string>')
    expect(repl).toContain('rewriteLeftArrowViaForAbortController(fe.via, ig)')
    expect(repl).toContain('nh=dtn(...) before Swh/LAc')
    // Order lock: iHt four gates must appear before Ki / dtn / LAc.
    const ihtIdx = repl.indexOf('densable iHt four gates before Ki')
    const kiIdx = repl.indexOf('if Ki.current → second-press while defer-armed')
    const dtnIdx = repl.indexOf('nh=dtn(...) before Swh/LAc')
    const lacIdx = repl.indexOf('if Swh → Ot(Tt) LAc confirm')
    expect(ihtIdx).toBeGreaterThan(-1)
    expect(kiIdx).toBeGreaterThan(ihtIdx)
    expect(dtnIdx).toBeGreaterThan(kiIdx)
    expect(lacIdx).toBeGreaterThan(dtnIdx)
    expect(repl).toContain('evaluateLeftArrowIhtGates')

    // densable post-query refuse → Ss / createSystemMessage (not yi toast)
    expect(repl).toContain('densable post-query refuse')
    expect(repl).toContain('createSystemMessage(`Backgrounding cancelled')

    // Mu fields must survive REPL → launcher → aAf telemetry
    const launcher = readFileSync(join(root, 'replLauncher.tsx'), 'utf8')
    expect(launcher).toContain(
      'confirmedInterstitial: payload?.confirmedInterstitial',
    )
    expect(launcher).toContain('deferWaitMs: payload?.deferWaitMs')
    expect(launcher).toContain('deferCapFired: payload?.deferCapFired')
    expect(launcher).toContain('alreadyOpened: payload?.alreadyOpened')
    const main = readFileSync(join(root, 'main.tsx'), 'utf8')
    expect(main).toContain('replResult.alreadyOpened')
    expect(main).toContain('clearBridgeSessionMetaAfterQpeHandoff')
    expect(repl).toContain('isLeftArrowDaemonDetachOnly()')
    expect(repl).toContain('alreadyOpened: {')
    expect(repl).toContain('short: sessionId.slice(0, 8)')
    const qpeIdx = repl.indexOf('densable qpe: jpt.current=!0; return vHy')
    const daemonIdx = repl.indexOf('isLeftArrowDaemonDetachOnly()')
    const vHyIdx = repl.indexOf('openAgentsViaLeftArrow(snap')
    expect(qpeIdx).toBeGreaterThan(-1)
    expect(daemonIdx).toBeGreaterThan(qpeIdx)
    expect(vHyIdx).toBeGreaterThan(daemonIdx)
    const agents = readFileSync(join(root, 'cli/bg/leftArrowAgents.ts'), 'utf8')
    expect(agents).toContain("logEvent('tengu_open_agents_via_left'")
    expect(agents).toContain('was_empty:')
    expect(agents).toContain('adopted_shells:')
    expect(agents).toContain('prefill_truncated:')
    expect(repl).toContain('inflightCount: handoffInFlight.count')
    expect(repl).toContain('frameLive: checkpoint.frameLive')
    expect(repl).toContain('liveMonitorSlugs: [...monitorsAtPress]')
    expect(agents).toContain('adopted_frame_live: adoptedFrameLive')
    expect(agents).toContain('countUndisclosedFrameLive')
  })
})
