/**
 * densable `Jd` — kitty graphics live-image registry.
 *
 * Gold walks a resend queue in `retransmitAll` and joins pending sequences
 * in `drain`. Do not export minify `Jd`.
 *
 * densable constants: F1=8, uv=16777216, U1=3145728, k1=8, fRt=256.
 * densable `ego(id)` = APC delete `a=d,d=I,i=${id},q=2`.
 */

import { randomInt } from 'node:crypto'
import {
  collectIterm2Cells,
  wrapTmuxItermFile,
  wrapTmuxPassthrough,
} from './iterm2Image.js'
import type { Screen } from './screen.js'
import type { ImageProtocol } from './terminalCapabilities.js'

const SMALL_ID_LIMIT = 256
const WIDE_ID_LIMIT = 16_777_216
const DRAIN_BYTE_CAP = 3_145_728
const CONSUMED_BACKLOG = 8
const SMALL_BITS = 8
const APC_G = '\x1b_G'
const ST = '\x1b\\'
const SAVE_CURSOR = '\x1b7'
const RESTORE_CURSOR = '\x1b8'

type ImageBox = { columns: number; rows: number }

type LiveImage = {
  isSent: boolean
  resend: (() => string) | undefined
  onRefused: ((reason: string) => void) | undefined
  protocol: ImageProtocol
  box: ImageBox | undefined
  isDrawn: boolean
  isDirty: boolean
  deferredSince: number | undefined
  hasGlyphs: boolean
  reuseKey: string | undefined
}

type PendingTransmit = {
  sequence: string
  isConsumed: boolean
}

function kittyDelete(id: number): string {
  return `${APC_G}a=d,d=I,i=${id},q=2${ST}`
}

function cellsDiffer(a: Screen, b: Screen, idx: number): boolean {
  const offset = idx << 1
  return (
    a.cells[offset] !== b.cells[offset] ||
    a.cells[offset + 1] !== b.cells[offset + 1]
  )
}

function groupRuns(
  indexes: number[],
  width: number,
): Array<{ x: number; y: number; length: number }> {
  const runs: Array<{ x: number; y: number; length: number }> = []
  for (const idx of indexes) {
    const x = idx % width
    const y = Math.floor(idx / width)
    const last = runs.at(-1)
    if (last !== undefined && last.y === y && last.x + last.length === x) {
      last.length++
    } else {
      runs.push({ x, y, length: 1 })
    }
  }
  return runs
}

export class TerminalImages {
  readonly live = new Map<number, LiveImage>()
  readonly pendingDeletes = new Set<number>()
  readonly pendingTransmits = new Map<number, PendingTransmit[]>()
  pendingOrphans: string[] = []
  readonly freeSmall = new Set<number>()
  readonly freeIterm = new Map<string, number[]>()
  placements = 0
  nextSmall = 1
  nextWide = randomInt(SMALL_ID_LIMIT, WIDE_ID_LIMIT)
  isTmuxPassthrough = false
  isDrawHeld = false

  constructor(private readonly requestFrame: () => void) {}

  allocate(
    bits: number,
    onRefused?: (reason: string) => void,
    protocol: ImageProtocol = 'kitty',
    reuseKey?: string,
  ): number | undefined {
    const id =
      protocol === 'iterm'
        ? this.takeIterm(reuseKey)
        : bits === SMALL_BITS
          ? this.takeSmall()
          : this.takeWide()
    if (id !== undefined) {
      this.live.set(id, {
        isSent: false,
        resend: undefined,
        onRefused,
        protocol,
        box: undefined,
        isDrawn: false,
        isDirty: false,
        deferredSince: undefined,
        hasGlyphs: false,
        reuseKey,
      })
    }
    return id
  }

  transmit(
    id: number,
    encode: (imageId: number) => string,
    options: { resend?: boolean; box?: ImageBox } = { resend: true },
  ): boolean {
    const live = this.live.get(id)
    const consumed = !options.resend
    if (live === undefined || (consumed && this.isBackedUp(id))) return false
    if (live.protocol === 'iterm') {
      return this.keepIterm(id, live, encode, options)
    }
    try {
      const resend = () => encode(id)
      const sequence = resend()
      live.isSent = true
      live.resend = consumed ? undefined : resend
      this.queue(id, { sequence, isConsumed: consumed })
    } catch {
      return false
    }
    this.requestFrame()
    return true
  }

  private keepIterm(
    id: number,
    live: LiveImage,
    encode: (imageId: number) => string,
    options: { box?: ImageBox },
  ): boolean {
    try {
      const resend = () => encode(id)
      resend()
      live.isSent = true
      live.resend = resend
      live.box = options.box
      live.isDirty = true
    } catch {
      return false
    }
    this.requestFrame()
    return true
  }

  isBackedUp(id: number): boolean {
    const pending = this.pendingTransmits.get(id) ?? []
    let consumed = 0
    for (const item of pending) if (item.isConsumed) consumed++
    return consumed >= CONSUMED_BACKLOG
  }

  refused(id: number, reason: string): void {
    if (reason === 'OK') return
    this.live.get(id)?.onRefused?.(reason)
  }

  free(id: number): void {
    const live = this.live.get(id)
    if (live === undefined) return
    const { isSent, protocol, reuseKey } = live
    this.live.delete(id)
    if (protocol === 'iterm') {
      if (reuseKey !== undefined) {
        const list = this.freeIterm.get(reuseKey) ?? []
        this.freeIterm.delete(reuseKey)
        this.freeIterm.set(reuseKey, [...list, id])
        const [oldest] = this.freeIterm.keys()
        if (oldest !== undefined && this.freeIterm.size > SMALL_ID_LIMIT) {
          this.freeIterm.delete(oldest)
        }
      }
      return
    }
    for (const item of this.pendingTransmits.get(id) ?? []) {
      if (item.isConsumed) this.pendingOrphans.push(item.sequence)
    }
    this.pendingTransmits.delete(id)
    if (id < SMALL_ID_LIMIT) this.freeSmall.add(id)
    if (isSent) {
      this.pendingDeletes.add(id)
      this.requestFrame()
    }
  }

  retransmitAll(): void {
    for (const [id, live] of this.live) {
      if (live.protocol === 'iterm') {
        live.isDirty = true
        continue
      }
      if (live.resend !== undefined)
        this.queue(id, { sequence: live.resend(), isConsumed: false })
    }
  }

  redrawInline(): void {
    if (!this.hasItermImages) return
    for (const live of this.live.values()) {
      if (live.protocol === 'iterm') live.isDirty = true
    }
    this.requestFrame()
  }

  requestDraw(): void {
    if (this.hasItermImages) this.requestFrame()
  }

  resendAll(): void {
    if (this.live.size === 0) return
    this.retransmitAll()
    this.requestFrame()
  }

  forOuter(seq: string): string {
    return this.isTmuxPassthrough && seq !== '' ? wrapTmuxPassthrough(seq) : seq
  }

  placeIterm(
    screen: Screen,
    prevScreen: Screen | undefined,
    moveTo: (col: number, row: number) => string | undefined,
    tmuxMoveTo?: (
      col: number,
      row: number,
    ) => { row: number; column: number } | undefined,
    allowDraw = true,
  ): string {
    this.isDrawHeld = false
    if (!this.hasItermImages) return ''
    const prev =
      prevScreen !== undefined && prevScreen.width === screen.width
        ? prevScreen
        : undefined
    const prevTotal = prev === undefined ? 0 : prev.width * prev.height
    const changed = (idx: number) =>
      prev === undefined || idx >= prevTotal || cellsDiffer(screen, prev, idx)
    const collected = collectIterm2Cells(screen)
    let out = ''
    let bytes = 0
    this.placements++
    const sorted = [...this.live].sort(
      ([, a], [, b]) =>
        (a.deferredSince ?? Number.MAX_SAFE_INTEGER) -
        (b.deferredSince ?? Number.MAX_SAFE_INTEGER),
    )
    for (const [id, live] of sorted) {
      const { box, resend } = live
      if (live.protocol !== 'iterm' || box === undefined || !resend) continue
      const cells = collected.get(id)
      if (cells === undefined) {
        live.isDrawn = false
        live.hasGlyphs = false
        continue
      }
      const hasChanges = cells.indexes.some(changed)
      const hadGlyphs = live.hasGlyphs
      live.hasGlyphs ||= hasChanges
      const { originX, originY } = cells
      const complete =
        cells.isConsistent &&
        cells.count === box.columns * box.rows &&
        cells.lastRow < box.rows &&
        cells.lastColumn < box.columns
      const bottomY = originY + box.rows - 1
      const topPos = complete
        ? tmuxMoveTo === undefined
          ? moveTo(originX, originY)
          : tmuxMoveTo(originX, originY)
        : undefined
      const bottomOk =
        (tmuxMoveTo === undefined
          ? moveTo(originX, bottomY)
          : tmuxMoveTo(originX, bottomY)) !== undefined
      if (topPos !== undefined && bottomOk) {
        if (!live.isDirty && live.isDrawn && !hasChanges) continue
        if (tmuxMoveTo !== undefined && hasChanges) {
          live.isDrawn = false
          live.isDirty = true
          this.requestFrame()
          continue
        }
        if (!allowDraw) {
          live.isDrawn = false
          live.isDirty = true
          this.isDrawHeld = true
          continue
        }
        const seq = resend()
        if (bytes > 0 && bytes + seq.length > DRAIN_BYTE_CAP) {
          live.isDrawn = false
          live.isDirty = true
          live.deferredSince ??= this.placements
          this.requestFrame()
          continue
        }
        out +=
          typeof topPos === 'string'
            ? topPos + seq
            : wrapTmuxItermFile(seq, topPos)
        bytes += seq.length
        live.isDrawn = true
        live.isDirty = false
        live.deferredSince = undefined
        live.hasGlyphs = false
        continue
      }
      live.isDrawn = false
      live.hasGlyphs = false
      const toErase = hadGlyphs ? cells.indexes : cells.indexes.filter(changed)
      for (const run of groupRuns(toErase, screen.width)) {
        const mv = moveTo(run.x, run.y)
        if (mv !== undefined) out += `${mv}\x1b[${run.length}X`
      }
    }
    return out === '' ? '' : `${SAVE_CURSOR}${out}${RESTORE_CURSOR}`
  }

  get hasHeldDraw(): boolean {
    return this.isDrawHeld
  }

  get hasItermImages(): boolean {
    for (const live of this.live.values()) {
      if (live.protocol === 'iterm') return true
    }
    return false
  }

  drain(): string {
    const orphans = this.pendingOrphans.splice(0)
    const deletes = [...this.pendingDeletes].map(id => kittyDelete(id))
    const transmits: string[] = []
    let bytes = 0
    this.pendingDeletes.clear()
    for (const [id, queue] of this.pendingTransmits) {
      for (let head = queue[0]; head !== undefined; head = queue[0]) {
        if (bytes > 0 && bytes + head.sequence.length > DRAIN_BYTE_CAP) {
          this.requestFrame()
          return this.forOuter([...orphans, ...deletes, ...transmits].join(''))
        }
        transmits.push(head.sequence)
        bytes += head.sequence.length
        queue.shift()
      }
      this.pendingTransmits.delete(id)
    }
    return this.forOuter([...orphans, ...deletes, ...transmits].join(''))
  }

  get size(): number {
    return this.live.size
  }

  queue(id: number, item: PendingTransmit): void {
    const pending = this.pendingTransmits.get(id) ?? []
    const kept = item.isConsumed
      ? pending
      : pending.filter(entry => entry.isConsumed)
    this.pendingTransmits.set(id, [...kept, item])
  }

  private takeIterm(reuseKey?: string): number | undefined {
    if (reuseKey !== undefined) {
      const list = this.freeIterm.get(reuseKey)
      if (list && list.length > 0) {
        const reused = list.pop()!
        if (list.length === 0) this.freeIterm.delete(reuseKey)
        return reused
      }
    }
    return this.takeSmall()
  }

  takeSmall(): number | undefined {
    const [recycled] = this.freeSmall
    if (recycled !== undefined) {
      this.freeSmall.delete(recycled)
      return recycled
    }
    return this.nextSmall >= SMALL_ID_LIMIT ? undefined : this.nextSmall++
  }

  takeWide(): number {
    let id = this.nextWide
    do id = id + 1 >= WIDE_ID_LIMIT ? SMALL_ID_LIMIT : id + 1
    while (this.live.has(id))
    this.nextWide = id
    return id
  }
}
