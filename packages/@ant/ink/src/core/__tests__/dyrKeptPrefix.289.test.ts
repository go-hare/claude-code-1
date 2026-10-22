import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const TERMINAL = join(import.meta.dir, '../terminal.ts')
const INK = join(import.meta.dir, '../ink.tsx')

describe('densable 2.1.289 dyr keptPrefix 5th arg', () => {
  test('writeDiffToTerminal has keptPrefix and empty-diff still writes it', async () => {
    const src = await Bun.file(TERMINAL).text()
    expect(src).toContain('keptPrefix = ')
    expect(src).toContain('viewportRows?: number')
    expect(src).toContain(
      "if (keptPrefix !== '') writeContentToTerminal(terminal, keptPrefix)",
    )
    expect(src).toContain('keptPrefix + (useSync ? BSU : ')
  })

  test('onRender passes takeKeptForNextFrame as dyr 5th arg', async () => {
    const src = await Bun.file(INK).text()
    expect(src).toContain('this.takeKeptForNextFrame()')
    expect(src).toContain('this.skipSyncMarkers(),')
    expect(src).toContain('setImmediate(this.writeKeptForNextFrame)')
    expect(src).toContain(
      'if (!this.frameMicrotaskQueued) this.queuePacedFrame()',
    )
  })

  test('unmount dyr is !isHandedOff + stdoutSize().rows', async () => {
    const src = await Bun.file(INK).text()
    expect(src).toContain('this.renderCalled && !this.isHandedOff')
    expect(src).toContain('this.stdoutSize().rows')
    expect(src).not.toContain('this.renderCalled && !this.isPaused')
  })

  test('unmount restore is wDn restoreTerminalModes not writeSync DEC list', async () => {
    const src = await Bun.file(INK).text()
    expect(src).toContain(
      'restoreTerminalModes(this.modes, this.writeBeforeExit)',
    )
    expect(src).toContain('this.nonBlockingStdout?.flush()')
    expect(src).toContain('this.restoreConsolePatches()')
    expect(src).not.toContain('writeSync(1, DISABLE_MOUSE_TRACKING)')
    expect(src).toContain('this.srPreParkTimer !== null')
    expect(src).toContain('this.srAnnouncementHoldTimer !== null')
    expect(src).toContain("csi('G')")
    expect(src).toContain('this.srPreParked = true')
    expect(src).toContain('this.srHeldAnnouncements')
    expect(src).toContain('applyTranscriptFrontCut')
    expect(src).toContain('cursorTo(q.col + 1)')
    expect(src).toContain('K < x.length')
    expect(src).toContain('N === -1')
    expect(src).toContain('this.rootNode.transcriptFrontCutRows ?? null')
    expect(src).toContain('const holdMs = takeScreenReaderAnnouncementHoldMs()')
    expect(src).toContain('N !== -1 && holdMs > 0 && !this.isExiting')
    expect(src).toContain(
      'const declaredPark = this.computeScreenReaderPark(n, R, x, m)',
    )
    expect(src).toContain(
      'this.prevScreenReaderParkDeclared = declaredPark !== null',
    )
    expect(src).not.toContain('planScreenReaderFrameUpdate(')
  })

  test('drainStdin is aqe + resync({probe:!1}); backpressure resyncs', async () => {
    const src = await Bun.file(INK).text()
    expect(src).toContain('querier.resync({ probe: false })')
    expect(src).toContain('this.appRef.current?.querier?.resync({ probe })')
    expect(src).toContain('countDa1Replies')
    expect(src).toContain('Bun.sleepSync(2)')
  })
})
