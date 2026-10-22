import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const INK = join(import.meta.dir, '../ink.tsx')
const CONSTANTS = join(import.meta.dir, '../constants.ts')

describe('densable 2.1.289 scheduleFrame pacer', () => {
  test('scheduleRender is scheduleFrame, not lodash throttle', async () => {
    const src = await Bun.file(INK).text()
    expect(src).toContain(
      'this.scheduleRender = Object.assign(() => this.scheduleFrame(), {',
    )
    expect(src).toContain('cancel: () => this.cancelScheduledFrame()')
    expect(src).toContain('private scheduleFrame()')
    expect(src).toContain('private queuePacedFrame()')
    expect(src).toContain('queueMicrotask(() => {')
    expect(src).toContain('this.frameMicrotaskQueued = false')
    expect(src).toContain('this.onRender()')
    expect(src).not.toContain("from 'lodash-es/throttle.js'")
    expect(src).not.toContain('throttle(deferredRender')
  })

  test('onRender gates isUnmounted || isHandedOff', async () => {
    const src = await Bun.file(INK).text()
    expect(src).toContain('if (this.isUnmounted || this.isHandedOff)')
    expect(src).toContain('get isHandedOff(): boolean')
    expect(src).toContain('this.modes.isSuspended')
    expect(src).toContain(
      'this.ownTree !== undefined && Ns().has(this.options.stdout)',
    )
    expect(src).not.toContain(
      'this.ownTree !== undefined && instances.has(this.options.stdout)',
    )
    const onRender = src.indexOf('onRender() {')
    const gate = src.indexOf(
      'if (this.isUnmounted || this.isHandedOff)',
      onRender,
    )
    expect(onRender).toBeGreaterThan(0)
    expect(gate).toBeGreaterThan(onRender)
    expect(gate).toBeLessThan(onRender + 80)
  })

  test('pacer constants match gold Vh/SSo/_So', async () => {
    const src = await Bun.file(CONSTANTS).text()
    expect(src).toContain('export const FRAME_INTERVAL_MS = 16')
    expect(src).toContain('export const INPUT_PRIORITY_FRAME_MS = 4')
    const ink = await Bun.file(INK).text()
    expect(ink).toContain('this.pacerNow() + 50')
    expect(ink).toContain(
      'now < this.inputPriorityUntil ? INPUT_PRIORITY_FRAME_MS : FRAME_INTERVAL_MS',
    )
    expect(ink).toContain(
      'if (this.isScreenReaderEnabled && this.srHeldAnnouncements.length > 0)',
    )
    expect(ink).toContain(
      'onInputPriorityFrame={this.requestInputPriorityFrame}',
    )
  })

  test('queuePacedFrame holds when nonBlockingStdout.queuedBytes > bSo', async () => {
    const src = await Bun.file(INK).text()
    expect(src).toContain(
      'this.nonBlockingStdout.queuedBytes() > STDOUT_BACKLOG_BYTES',
    )
    expect(src).toContain('this.frameHeldForBacklog = true')
    expect(src).toContain(
      'installNonBlockingStdout(this.handleStdoutBackpressure)',
    )
    const constants = await Bun.file(CONSTANTS).text()
    expect(constants).toContain('export const STDOUT_BACKLOG_BYTES = 16384')
    expect(constants).toContain('export const STDOUT_BACKLOG_RETRY_MS = 250')
  })

  test('tree() constructs InkTree not an empty object', async () => {
    const src = await Bun.file(INK).text()
    expect(src).toContain('this.ownTree ??= new InkTree(this.rootNode)')
    expect(src).toContain('Ns().treeRoots.set(this.options.stdout, this)')
    expect(src).not.toContain('this.ownTree ??= {}')
  })

  test('Ns is the instances map analog of gold Ht.of(U().host)', async () => {
    const instancesSrc = await Bun.file(
      join(import.meta.dir, '../instances.ts'),
    ).text()
    expect(instancesSrc).toContain('export function Ns()')
    expect(instancesSrc).toContain('return Ht.of(U().host)')
    expect(instancesSrc).toContain('const instances = Ns()')
    expect(instancesSrc).toContain('readonly treeRoots')
    expect(instancesSrc).toContain('occupant.holdsRawMode')
    expect(instancesSrc).not.toContain('new Proxy')
  })

  test('handleResume matches gold SIGCONT extras', async () => {
    const src = await Bun.file(INK).text()
    const resumeStart = src.indexOf('private handleResume')
    const resumeEnd = src.indexOf('resetScreenReaderDiffState():')
    const resume = src.slice(resumeStart, resumeEnd)
    expect(resume).toContain('this.forgetPointer()')
    expect(resume).toContain("process.kill(process.pid, 'SIGWINCH')")
    expect(resume).toContain('this.imagesStale = true')
    expect(resume).toContain('this.mainScreenBehindAlt = undefined')
    expect(resume).toContain(
      'this.nativeCursorVisible = this.accessibilityMode',
    )
    expect(src).toContain(
      'return this.nativeCursorVisible ? SHOW_CURSOR : HIDE_CURSOR',
    )
    expect(resume).toContain('this.resetFramesForAltScreen()')
    expect(resume).toContain('this.reenterAltScreen()')
    expect(resume).not.toContain('enableMouseTracking')
    expect(resume.match(/this\.imagesStale = true/g)?.length).toBe(2)
  })

  test('onRender consumes imagesStale before renderer', async () => {
    const src = await Bun.file(INK).text()
    expect(src).toContain(
      'if (this.imagesStale) (this.imagesStale = false), this.terminalImages.retransmitAll()',
    )
    const consume = src.indexOf(
      'if (this.imagesStale) (this.imagesStale = false), this.terminalImages.retransmitAll()',
    )
    const renderer = src.indexOf('const frame = this.renderer({')
    expect(consume).toBeGreaterThan(0)
    expect(consume).toBeLessThan(renderer)
    expect(src).toContain(
      'terminalImages = new TerminalImages(() => this.scheduleRender())',
    )
    expect(src).not.toContain('export function Jd')
    expect(src).not.toContain('export class Jd')
    expect(src).toContain("from './terminalImages.js'")
    expect(src).toContain("dom.createNode('ink-root', Yoga.Config.create())")
    expect(src).toContain('get holdsRawMode(): boolean')
    expect(src).toContain('terminalImages={this.terminalImages}')
  })

  test('onRender parks nativeCursor hide/show when eD pin is on', async () => {
    const src = await Bun.file(INK).text()
    expect(src).toContain(
      'this.options.nativeCursor || this.bgWorkerForceShowCursor',
    )
    expect(src).toContain("optimized.unshift({ type: 'cursorHide' })")
    expect(src).toContain("optimized.push({ type: 'cursorShow' })")
    const root = await Bun.file(join(import.meta.dir, '../root.ts')).text()
    expect(root).toContain('nativeCursor ?? isNativeCursorEnabled()')
  })

  test('keepForNextFrame is gold setImmediate then microtask onRender takeKept', async () => {
    const src = await Bun.file(INK).text()
    const start = src.indexOf('keepForNextFrame(seq: string)')
    const end = src.indexOf('private takeKeptForNextFrame')
    const body = src.slice(start, end)
    expect(start).toBeGreaterThan(0)
    expect(body).toContain('setImmediate(this.writeKeptForNextFrame)')
    expect(body).toContain(
      'if (!this.frameMicrotaskQueued) this.queuePacedFrame()',
    )
    expect(body).toContain('this.keptForNextFrame += seq')
    expect(src).toContain('this.takeKeptForNextFrame()')
    expect(src).toContain('this.skipSyncMarkers(),')
  })
})
