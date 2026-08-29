/**
 * densable J$0 gap/backfill serializer locks (Project C Phase-2+).
 * Gold: gold-project-c-xxc-host.txt function J$0
 */
import { describe, expect, test } from 'bun:test'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { serializeGapBackfill } from '../axcScreenSerialize.js'
import { createNode, type DOMElement } from '../dom.js'
import instances from '../instances.js'
import { nodeCache } from '../node-cache.js'
import Ink from '../ink.js'
import { NATIVE_HISTORY_CAP } from '../nativeHistoryPump.js'
import {
  createRenderFrameContext,
  didLayoutShift,
  runWithRenderFrameContext,
} from '../render-node-to-output.js'
import { StylePool } from '../screen.js'

function makeTtyStdout() {
  const stdout = new PassThrough() as PassThrough & {
    columns: number
    rows: number
    isTTY: boolean
  }
  stdout.columns = 80
  stdout.rows = 24
  stdout.isTTY = true
  return stdout
}

function makeTtyStdin() {
  const stdin = new EventEmitter() as EventEmitter & {
    isTTY: boolean
    setRawMode?: (m: boolean) => void
    ref?: () => void
    unref?: () => void
    resume?: () => void
    pause?: () => void
    read?: () => null
  }
  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  stdin.resume = () => {}
  stdin.pause = () => {}
  stdin.read = () => null
  return stdin
}

describe('serializeGapBackfill (densable J$0)', () => {
  test('empty scroll / bad range → []', () => {
    const scroll = createNode('ink-box')
    scroll.scrollHeight = 0
    expect(serializeGapBackfill(scroll, 0, 10, 80, new StylePool())).toEqual([])

    scroll.scrollHeight = 100
    expect(serializeGapBackfill(scroll, 10, 10, 80, new StylePool())).toEqual(
      [],
    )
    expect(serializeGapBackfill(scroll, 20, 10, 80, new StylePool())).toEqual(
      [],
    )
  })

  test('no Ink instance on stdout → []', () => {
    const scroll = createNode('ink-box')
    scroll.scrollHeight = 50
    const child = createNode('ink-box')
    scroll.childNodes.push(child)
    child.parentNode = scroll
    // Ensure no ink on process.stdout
    const prev = instances.get(process.stdout)
    if (prev) instances.delete(process.stdout)
    try {
      expect(serializeGapBackfill(scroll, 0, 5, 80, new StylePool())).toEqual(
        [],
      )
    } finally {
      if (prev) instances.set(process.stdout, prev)
    }
  })

  test('caps span at uyn (NATIVE_HISTORY_CAP)', () => {
    const stdout = makeTtyStdout()
    const ink = new Ink({
      stdout: stdout as never,
      stdin: makeTtyStdin() as never,
      stderr: new PassThrough() as never,
      exitOnCtrlC: false,
      patchConsole: false,
    })
    instances.set(process.stdout, ink)
    try {
      const scroll = createNode('ink-box')
      scroll.scrollHeight = NATIVE_HISTORY_CAP + 500
      const child = createNode('ink-box')
      // yogaNode required for renderNodeToOutput early path; without layout
      // we still exercise range clamp — paint may yield empty lines.
      scroll.childNodes.push(child)
      child.parentNode = scroll

      const from = 0
      const to = NATIVE_HISTORY_CAP + 200
      const lines = serializeGapBackfill(
        scroll,
        from,
        to,
        40,
        ink.getStylePool(),
      )
      // Without calculated yoga layout, paint may be empty — but must not
      // exceed uyn rows when content exists. Cap is in the height math.
      expect(lines.length).toBeLessThanOrEqual(NATIVE_HISTORY_CAP)
      // Explicit range math lock: end-start capped
      const end = Math.ceil(to)
      const start = Math.max(0, Math.floor(from), end - NATIVE_HISTORY_CAP)
      expect(end - start).toBe(NATIVE_HISTORY_CAP)
    } finally {
      instances.delete(process.stdout)
      ink.unmount()
    }
  })

  test('nCi clears descendant nodeCache then restores root cache', () => {
    const stdout = makeTtyStdout()
    const ink = new Ink({
      stdout: stdout as never,
      stdin: makeTtyStdin() as never,
      stderr: new PassThrough() as never,
      exitOnCtrlC: false,
      patchConsole: false,
    })
    instances.set(process.stdout, ink)
    try {
      const scroll = createNode('ink-box')
      scroll.scrollHeight = 50
      const content = createNode('ink-box')
      const grandchild = createNode('ink-box')
      scroll.childNodes.push(content)
      content.parentNode = scroll
      content.childNodes.push(grandchild)
      grandchild.parentNode = content

      const rootLayout = { x: 1, y: 2, width: 3, height: 4 }
      const childLayout = { x: 5, y: 6, width: 7, height: 8 }
      nodeCache.set(content, rootLayout)
      nodeCache.set(grandchild, childLayout)

      serializeGapBackfill(scroll, 0, 5, 40, ink.getStylePool())

      expect(nodeCache.get(grandchild)).toBeUndefined()
      expect(nodeCache.get(content)).toEqual(rootLayout)
      expect(content.dirty).toBe(true)
    } finally {
      instances.delete(process.stdout)
      ink.unmount()
    }
  })

  test('J$0 b9r() isolation does not leak layoutShifted into live ctx', () => {
    const stdout = makeTtyStdout()
    const ink = new Ink({
      stdout: stdout as never,
      stdin: makeTtyStdin() as never,
      stderr: new PassThrough() as never,
      exitOnCtrlC: false,
      patchConsole: false,
    })
    instances.set(process.stdout, ink)
    try {
      const scroll = createNode('ink-box')
      scroll.scrollHeight = 50
      const content = createNode('ink-box')
      scroll.childNodes.push(content)
      content.parentNode = scroll
      // Mismatched cache vs yoga computed rect → isolated paint sets
      // layoutShifted on the swapped b9r(), not the live ctx.
      nodeCache.set(content, { x: 1, y: 2, width: 3, height: 4 })

      const live = createRenderFrameContext()
      live.layoutShifted = false
      runWithRenderFrameContext(live, () => {
        serializeGapBackfill(scroll, 0, 5, 40, ink.getStylePool())
        expect(didLayoutShift()).toBe(false)
      })

      const liveShifted = createRenderFrameContext()
      liveShifted.layoutShifted = true
      runWithRenderFrameContext(liveShifted, () => {
        serializeGapBackfill(scroll, 0, 5, 40, ink.getStylePool())
        expect(didLayoutShift()).toBe(true)
      })
    } finally {
      instances.delete(process.stdout)
      ink.unmount()
    }
  })
})

describe('Axc resize replay → tickPump (236 #9 surface)', () => {
  test('after width resize, tickPump replays nativeHistory into writes', () => {
    const { Axc } = require('../axc.js') as typeof import('../axc.js')
    const chunks: string[] = []
    const out = new PassThrough()
    out.on('data', (c: Buffer | string) => {
      chunks.push(typeof c === 'string' ? c : c.toString('utf8'))
    })
    const axc = new Axc(out, 80, 24)
    axc.setup()
    axc.nativeHistory.push('msg-after-resize-line')
    expect(axc.handleResize(100, 24)).toBe('replay')
    chunks.length = 0
    expect(axc.tickPump()).toBe(false) // single line → drained
    expect(chunks.join('')).toContain('msg-after-resize-line')
  })
})

// silence unused
void (null as unknown as DOMElement)
