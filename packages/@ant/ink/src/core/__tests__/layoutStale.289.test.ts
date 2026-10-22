import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { createNode, scheduleRenderFrom } from '../dom.js'

const INK = join(import.meta.dir, '../ink.tsx')
const RECON = join(import.meta.dir, '../reconciler.ts')
const DOM = join(import.meta.dir, '../dom.ts')
const APP = join(import.meta.dir, '../../components/App.tsx')

describe('densable 2.1.289 layoutStale re-layout', () => {
  test('scheduleRenderFrom sets root layoutStale then onRender', () => {
    const root = createNode('ink-root')
    const child = createNode('ink-box')
    child.parentNode = root
    root.childNodes.push(child)
    let rendered = 0
    root.onRender = () => {
      rendered++
    }
    scheduleRenderFrom(child)
    expect(root.layoutStale).toBe(true)
    expect(rendered).toBe(1)
  })

  test('resetAfterCommit clears layoutStale before onComputeLayout', async () => {
    const src = await Bun.file(RECON).text()
    expect(src).toContain('rootNode.layoutStale = false')
    expect(src).not.toContain('rootNode.layoutStale = true')
    const clear = src.indexOf('rootNode.layoutStale = false')
    const compute = src.indexOf('rootNode.onComputeLayout()')
    expect(clear).toBeGreaterThan(0)
    expect(compute).toBeGreaterThan(clear)
    expect(src).toContain('rootNode.onRender?.()')
    expect(src).not.toContain('COMMIT_LOG')
    expect(src).not.toContain("process.env.NODE_ENV === 'test'")
  })

  test('COLD_START layoutStale is only set by scheduleRenderFrom', async () => {
    const recon = await Bun.file(RECON).text()
    const ink = await Bun.file(INK).text()
    const dom = await Bun.file(DOM).text()
    expect(dom).toContain('root.layoutStale = true')
    expect(recon).toContain('rootNode.layoutStale = false')
    expect(ink).toContain('if (this.rootNode.layoutStale)')
  })

  test('onRender layoutStale arm re-runs onComputeLayout + flushSyncWork', async () => {
    const src = await Bun.file(INK).text()
    expect(src).toContain('if (this.rootNode.layoutStale)')
    expect(src).toContain('this.rootNode.onComputeLayout?.()')
    expect(src).toContain('reconciler.flushSyncWork()')
    const arm = src.indexOf('if (this.rootNode.layoutStale)')
    const paint = src.indexOf('this.options.onBeforeRender?.()')
    expect(arm).toBeGreaterThan(0)
    expect(paint).toBeGreaterThan(arm)
  })

  test('dom types expose layoutStale', async () => {
    const src = await Bun.file(DOM).text()
    expect(src).toContain('layoutStale?: boolean')
    expect(src).toContain('root.layoutStale = true')
  })
})

describe('densable 2.1.289 createInstance inherits root yoga config', () => {
  test('createInstance is _r(type, root.yogaNode?.config)', async () => {
    const src = await Bun.file(RECON).text()
    expect(src).toContain('createNode(type, _root.yogaNode?.config)')
    expect(src).not.toContain('const node = createNode(type)\n')
  })
})

describe('densable 2.1.289 createInstance sy raw-mode hold', () => {
  test('createInstance calls sy(x,f) after apply props, not export function sy', async () => {
    const src = await Bun.file(RECON).text()
    expect(src).not.toContain('export function sy')
    expect(src).toContain('syncRawModeHold(node, _root)')
    const create = src.indexOf('createInstance(')
    const apply = src.indexOf('applyProp(node, key, value)', create)
    const sy = src.indexOf('syncRawModeHold(node, _root)', create)
    expect(apply).toBeGreaterThan(create)
    expect(sy).toBeGreaterThan(apply)
    expect(src).toContain('if (holds === !!node._holdsRawModeRef) return')
    expect(src).toContain('host.setRawMode(delta > 0)')
    expect(src).toContain(
      'host._pendingRawModeDelta = (host._pendingRawModeDelta ?? 0) + delta',
    )
  })

  test('dom types expose sy fields', async () => {
    const src = await Bun.file(DOM).text()
    expect(src).toContain('_holdsRawModeRef?: boolean')
    expect(src).toContain('_pendingRawModeDelta?: number')
    expect(src).toContain('setRawMode?: (enabled: boolean) => void')
  })
})

describe('densable 2.1.289 onRender layoutStale uses isHandedOff', () => {
  test('stale arm returns on isHandedOff not isPaused', async () => {
    const src = await Bun.file(INK).text()
    const arm = src.indexOf('if (this.rootNode.layoutStale)')
    const slice = src.slice(arm, arm + 700)
    expect(slice).toContain('if (this.isUnmounted || this.isHandedOff)')
    expect(slice).not.toContain('if (this.isUnmounted || this.isPaused)')
  })
})

describe('densable 2.1.289 App pendingRawModeDelta + tD settle', () => {
  test('componentDidMount drains _pendingRawModeDelta then binds setRawMode', async () => {
    const src = await Bun.file(APP).text()
    expect(src).toContain('root._pendingRawModeDelta ?? 0')
    expect(src).toContain('root.setRawMode = this.handleSetRawMode')
    expect(src).toContain('this.props.rootNode.setRawMode = undefined')
    expect(src).toContain(
      'while (this.rawModeEnabledCount > 0) this.handleSetRawMode(false)',
    )
  })

  test('extendedKeys settle is tD().onSettle not lazy require', async () => {
    const src = await Bun.file(APP).text()
    expect(src).toContain("caps.get('extendedKeys').state === 'pending'")
    expect(src).toContain("caps.onSettle('extendedKeys'")
    expect(src).not.toContain('armExtendedKeysSettle')
    expect(src).not.toContain("require('../core/terminalCapabilities.js')")
    expect(src).toContain('probeTerminalIdentity(this.querier, tD()')
    expect(src).toContain("item.response.type === 'kittyGraphics'")
  })

  test('Pw is setRawMode in e plus revoked-tty catch; disable has count<=0 guard', async () => {
    const src = await Bun.file(APP).text()
    expect(src).toContain("!('setRawMode' in stdin)")
    expect(src).toContain("message.includes('setRawMode failed')")
    expect(src).toContain('if (this.rawModeEnabledCount <= 0) return')
  })

  test('handleSetRawMode always uses required modes; no CSI else', async () => {
    const src = await Bun.file(APP).text()
    expect(src).toContain(
      "readonly modes: import('../core/terminalModes.js').TerminalModes",
    )
    expect(src).toContain("modes.set('bracketedPaste')")
    expect(src).toContain("modes.reset('extendedKeys')")
    expect(src).not.toContain('ENABLE_KITTY_KEYBOARD')
    expect(src).not.toContain('ENABLE_MODIFY_OTHER_KEYS')
    expect(src).not.toContain('armExtendedKeysSettle')
    expect(src).toContain("if (O() === 'windows')")
    expect(src).not.toContain("if (process.platform === 'win32')")
  })

  test('handleReadable catch is ot(Y(u), telemetryMessage) then re-attach', async () => {
    const src = await Bun.file(APP).text()
    expect(src).toContain('function Y(n: unknown): Error')
    expect(src).toContain('function ot<T>(n: T, e: string): T')
    expect(src).toContain(
      "defaultCallbacks.logError(ot(Y(error), 'stdin readable handler threw during input processing'))",
    )
    expect(src).toContain(
      'handleReadable: re-attaching stdin readable listener after error recovery',
    )
  })
})

describe('densable 2.1.289 wrapAnsi Z / M1 / Oc', () => {
  test('Z is wrapAnsiEngine over Bun.wrapAnsi; no wrap-ansi npm', async () => {
    const src = await Bun.file(join(import.meta.dir, '../wrapAnsi.ts')).text()
    expect(src).toContain('function wrapAnsiEngine')
    expect(src).toContain('Bun.wrapAnsi')
    expect(src).not.toContain("from 'wrap-ansi'")
  })

  test('M1 is App arrowWindow; jediTerm does not export trackArrowBurst', async () => {
    const app = await Bun.file(APP).text()
    const jedi = await Bun.file(
      join(import.meta.dir, '../jediTermInput.ts'),
    ).text()
    const index = await Bun.file(join(import.meta.dir, '../../index.ts')).text()
    expect(app).toContain('function trackAppArrowBurst')
    expect(app).toContain('arrowWindow: Array<{ t: number; n: number }> = []')
    expect(jedi).not.toContain('export function trackArrowBurst')
    expect(jedi).not.toContain('export function createArrowBurstWindow')
    expect(index).not.toContain('trackArrowBurst')
    expect(index).not.toContain('createArrowBurstWindow')
    expect(index).not.toContain('bindInkSessionHost')
    expect(index).not.toContain('planScreenReaderFrameUpdate')
    expect(index).not.toContain('eraseScreenReaderLinesUp')
    expect(index).not.toContain('wrapScreenReaderLineByCells')
    expect(index).not.toContain('isGraphemeBoundary')
    expect(index).not.toContain('hardWrapScreenReaderLine')
  })

  test('measureTextNode is gold Oc then f===0 early return', async () => {
    const src = await Bun.file(DOM).text()
    expect(src).toContain('expandTabsJoin(')
    expect(src).toContain('hasEscOrC1(rawText)')
    expect(src).toContain(
      'widthMode === LayoutMeasureMode.Undefined || dimensions.width <= width',
    )
    expect(src).not.toContain('const text = expandTabs(rawText)')
    expect(src).not.toContain(
      "text.includes('\\n') && widthMode === LayoutMeasureMode.Undefined",
    )
  })

  test('output clip is Ya + this.lineCells.width + Bun.sliceAnsi, not npm sliceAnsi', async () => {
    const src = await Bun.file(join(import.meta.dir, '../output.ts')).text()
    expect(src).toContain('this.lineCells.width(')
    expect(src).toContain('sanitizeBidiControls(line)')
    expect(src).toContain('sliceAnsi(')
    expect(src).toContain('Bun.sliceAnsi')
    expect(src).toContain("from './utils/sliceAnsi.js'")
    expect(src).toContain('isSoftwareBidiNeeded()')
    expect(src).toContain('index < sliceStart - 1 || index >= sliceEnd')
    expect(src).toContain('if (x > clip.x2!)')
    expect(src).not.toContain('widestLine(text)')
    expect(src).not.toContain('lineCellsWidth(')
    expect(src).toContain('new LineCells(stylePool, screen.charPool)')
  })
})
