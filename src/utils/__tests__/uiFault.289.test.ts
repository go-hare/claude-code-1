/**
 * densable 2.1.289 — Client fail → owning plugin `ui.fault` (terminal).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CLIENT_FAULT_EMPTY_REASON,
  scrubClientFaultReason,
  setClientFaultReporter,
} from '../plugins/functionHooksClient.js'

const CLIENT = join(import.meta.dir, '../plugins/functionHooksClient.ts')
const MODULES = join(import.meta.dir, '../plugins/functionHooksModules.ts')

afterEach(() => {
  setClientFaultReporter(undefined)
})

describe('densable 2.1.289 ui.fault Client isolation', () => {
  test('scrubClientFaultReason strips plugin/module prefixes and empties', () => {
    expect(
      scrubClientFaultReason('demo', './board', 'demo: Client ./board: boom'),
    ).toBe('boom')
    expect(scrubClientFaultReason('demo', './board', '')).toBe(
      CLIENT_FAULT_EMPTY_REASON,
    )
    expect(
      scrubClientFaultReason('demo', './board', 'demo: Client ./board:   '),
    ).toBe(CLIENT_FAULT_EMPTY_REASON)
  })

  test('scrubClientFaultReason caps at 200 and replaces line separators', () => {
    const long = 'x'.repeat(250)
    const out = scrubClientFaultReason('p', 'm', long)
    expect(out.length).toBeLessThanOrEqual(200)
    expect(out.endsWith('…')).toBe(true)
    expect(scrubClientFaultReason('p', 'm', `line break`)).toBe('line break')
  })

  test('client failRecord reports phase-tagged ui.fault; modules wire reporter', () => {
    const client = readFileSync(CLIENT, 'utf8')
    const modules = readFileSync(MODULES, 'utf8')
    expect(client).toContain('setClientFaultReporter')
    expect(client).toContain("failRecord(record, errorMessage(err), 'render')")
    expect(client).toContain("failRecord(record, errorMessage(err), 'load')")
    expect(client).toContain("failRecord(record, errorMessage(err), 'run')")
    expect(client).toContain('clientFaultReporter?.(')
    expect(modules).toContain("'ui.fault'")
    expect(modules).toContain('export async function dispatchClientFault')
    expect(modules).toContain('setClientFaultReporter(')
    expect(modules).toContain('taken as heard')
    expect(modules).toContain('only !== undefined && mod.name !== only')
    expect(modules).toContain('the fault could not be said:')
    expect(modules).toContain('the chain threw (')
    expect(modules).toContain('); no reply')
    expect(modules).toContain('dispatched, settled in')
    expect(modules).toContain(
      'ui.fault ${report.plugin}/${report.element} (${report.module}) in ${report.component} from ${report.surface}, ${report.phase}: dispatched, settled in',
    )
    expect(modules).toContain('ui.message ${post.plugin}/${post.element}')
    expect(modules).toContain('post.plugin')
    expect(modules).toContain('report.plugin')
    expect(modules).toContain('g.name !== (n ?? g.name)')
    expect(client).toContain('setClientMessagePostHandler')
    expect(client).toContain('setClientMessageCancelHandler')
    expect(client).toContain('clientMessagePostHandler?.(')
    expect(client).toContain('clientMessageCancelHandler?.(')
    expect(modules).toContain('FAULT_RUNS_CAP = 4096')
    expect(modules).toContain('faultRuns: new Map')
    expect(modules).toContain('pluginSession')
    expect(modules).toContain('FAULT_RENDER_FV')
    expect(modules).toContain('FAULT_RENDER_VIEWPORT')
    expect(modules).toContain('FAULT_RENDER_LIVE')
    expect(modules).toContain('function clientFaultPace')
    expect(modules).toContain('function uiRenderPluginNames')
    expect(modules).toContain('function holdClientFaultMount')
    expect(modules).toContain('function releaseClientFaultMount')
    expect(modules).toContain('function recordDrawingReaders')
    expect(modules).toContain('uiRenderDrawingAls.run')
    expect(modules).toContain('function bumpHdPlugin')
    expect(modules).toContain('FAULT_RENDER_LIVE_MS = 34')
    expect(modules).toContain('FAULT_RENDER_STEADY_MS = 100')
    expect(modules).toContain('function noteClientFaultStale')
    expect(modules).toContain('function flushClientFaultFolds')
    expect(modules).toContain('folds:')
    expect(modules).toContain('DRAWING_READERS_CAP = 4000')
    expect(modules).toContain("FAULT_RENDER_STATE_SUFFIX = '\\0state'")
    expect(modules).toContain('densable sO:')
    expect(modules).toContain('function dropClientFaultRenderKey')
    expect(modules).toContain('faultRenderVersions.delete')
    expect(modules).not.toContain(
      'if (evicted !== undefined) bumpRasterFrames()',
    )
    expect(modules).toContain('function cancelClientMessage')
    expect(modules).toContain('clientMessagePosts.set(post.id')
  })

  test('ClientInstance wires gold threw/drawnAgain/laidOut (Z budget)', () => {
    const client = readFileSync(CLIENT, 'utf8')
    expect(client).toContain('threw: (error: unknown) => void')
    expect(client).toContain('drawnAgain: () => void')
    expect(client).toContain('laidOut: () => void')
    expect(client).toContain('function threwRecord')
    expect(client).toContain('function drawnAgainRecord')
    expect(client).toContain('function resizeRecord')
    expect(client).toContain('MEASURE_INSTANCE_CAP = 8')
    expect(client).toContain('MEASURE_FRAME_CAP = 20')
    expect(client).toContain(
      'its region changed size on each of ${MEASURE_INSTANCE_CAP} measurings',
    )
    expect(client).toContain(
      'the Clients on screen were measured again in ${MEASURE_FRAME_CAP} passes',
    )
    expect(client).toContain('export function clientTerminalStamp')
    expect(client).toContain(
      "return [r.columns, r.rows, r.conversationColumns].join('x')",
    )
  })
})

describe('densable 2.1.289 Amt/Zc fault-render debounce', () => {
  test('notifyDrawingReadersOfKeys is $C (Zc) not immediate E1t', () => {
    const modules = readFileSync(MODULES, 'utf8')
    expect(modules).toContain('function notifyDrawingReadersOfKeys')
    expect(modules).toContain('function bumpHdPlugin')
    expect(modules).toContain('FAULT_RENDER_LIVE_MS = 34')
    expect(modules).toContain('FAULT_RENDER_STEADY_MS = 100')
    expect(modules).toContain('function noteClientFaultStale')
    expect(modules).toContain('function flushClientFaultFolds')
    expect(modules).toContain('folds:')
    const notifyStart = modules.indexOf('function notifyDrawingReadersOfKeys')
    const notifyEnd = modules.indexOf('\nfunction ', notifyStart + 1)
    const notifyBody = modules.slice(notifyStart, notifyEnd)
    expect(notifyBody).toContain('noteClientFaultStale')
    expect(notifyBody).not.toContain("bumpHdPlugin(plugin, 'live')")
    const recordStart = modules.indexOf('function recordDrawingReaders')
    const recordEnd = modules.indexOf('\nfunction ', recordStart + 1)
    const recordBody = modules.slice(recordStart, recordEnd)
    expect(recordBody).toContain('noteClientFaultStale([drawing.instanceKey])')
    expect(recordBody).not.toContain("bumpHdPlugin(plugin, 'live')")
  })
})

describe('densable 2.1.289 jis/jP/U2 plugin render cooldown', () => {
  test('ui.invalidate ui.render still bumps Fv and schedules jis', () => {
    const modules = readFileSync(MODULES, 'utf8')
    expect(modules).toContain('PLUGIN_RENDER_COOLDOWN_MS = 1000')
    expect(modules).toContain('function invalidatePluginRender')
    expect(modules).toContain('function pluginVisibleLive')
    expect(modules).toContain('function noteSlowUiRender')
    expect(modules).toContain('function pluginOnCooldown')
    expect(modules).toContain('function scheduleHdPluginBump')
    expect(modules).toContain('function noteAbortedUiRender')
    expect(modules).toContain('pluginRenderCooldownUntil')
    const invalidateStart = modules.indexOf("if (op === 'ui.invalidate')")
    const invalidateEnd = modules.indexOf(
      '\n  if (op === ',
      invalidateStart + 1,
    )
    const invalidateBody = modules.slice(invalidateStart, invalidateEnd)
    expect(invalidateBody).toContain('bumpFaultRenderFv')
    expect(invalidateBody).toContain('invalidatePluginRender(plugin)')
    const scheduleStart = modules.indexOf('function scheduleHdPluginBump')
    const scheduleEnd = modules.indexOf('\nfunction ', scheduleStart + 1)
    const scheduleBody = modules.slice(scheduleStart, scheduleEnd)
    expect(scheduleBody).toContain('bumpHdPlugin(plugin, pace)')
    const jisStart = modules.indexOf('function invalidatePluginRender')
    const jisEnd = modules.indexOf('\nfunction ', jisStart + 1)
    const jisBody = modules.slice(jisStart, jisEnd)
    expect(jisBody).toContain('hdPluginSteadyBump.call')
    expect(jisBody).toContain('hdPluginLiveBump.call')
    expect(jisBody).toContain('pluginOnCooldown')
    expect(jisBody).toContain('pluginVisibleLive')
    expect(modules).toContain(
      "signal?.addEventListener('abort', onAbort, { once: true })",
    )
    expect(modules).toContain(
      'noteAbortedUiRender(liveNames, Date.now() - startedAt)',
    )
    expect(modules).toContain(
      "if (requestId !== '' && !signal?.aborted) recordDrawingReaders",
    )
    expect(modules).toContain('UI_RENDER_EVAL_CAP = 500')
    expect(modules).toContain('uiRenderEvalCache')
    expect(modules).toContain(
      'reuses its settled evaluation (one dispatch per draw)',
    )
    expect(modules).toContain('function rememberUiRenderEval')
    expect(modules).toContain('uiRenderEvalCache.delete(md)')
    expect(modules).toContain('function isInsideHookEval')
    expect(modules).toContain('hookEvalAls.run')
    expect(modules).toContain('rec.versions === faultRenderVersions')
    expect(modules).toContain('engineVersion')
    expect(modules).toContain('uiRenderEvalReuseCount')
    expect(modules).toContain('function countReuse')
  })
})

describe('densable 2.1.289 PluginClient no()/eo wrap', () => {
  test('PluginRasterPanes measures yoga and maps eo buttons', () => {
    const panes = readFileSync(
      join(import.meta.dir, '../../components/PluginRasterPanes.tsx'),
      'utf8',
    )
    expect(panes).toContain('measureElement(node)')
    expect(panes).toContain(
      'instanceRef.current.resize(measuredWidth, measuredHeight)',
    )
    expect(panes).toContain('export function pluginClientPointerButton')
    expect(panes).toContain("case 0:\n      return 'left'")
    expect(panes).not.toContain('[width, height, snapshot]')
  })
})
