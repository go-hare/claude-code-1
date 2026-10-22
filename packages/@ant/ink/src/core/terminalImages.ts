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

const SMALL_ID_LIMIT = 256
const WIDE_ID_LIMIT = 16_777_216
const DRAIN_BYTE_CAP = 3_145_728
const CONSUMED_BACKLOG = 8
const SMALL_BITS = 8
const APC_G = '\x1b_G'
const ST = '\x1b\\'

type LiveImage = {
  isSent: boolean
  resend: (() => string) | undefined
  onRefused: ((reason: string) => void) | undefined
}

type PendingTransmit = {
  sequence: string
  isConsumed: boolean
}

function kittyDelete(id: number): string {
  return `${APC_G}a=d,d=I,i=${id},q=2${ST}`
}

export class TerminalImages {
  readonly live = new Map<number, LiveImage>()
  readonly pendingDeletes = new Set<number>()
  readonly pendingTransmits = new Map<number, PendingTransmit[]>()
  pendingOrphans: string[] = []
  readonly freeSmall = new Set<number>()
  nextSmall = 1
  nextWide = randomInt(SMALL_ID_LIMIT, WIDE_ID_LIMIT)

  constructor(private readonly requestFrame: () => void) {}

  allocate(
    bits: number,
    onRefused?: (reason: string) => void,
  ): number | undefined {
    const id = bits === SMALL_BITS ? this.takeSmall() : this.takeWide()
    if (id !== undefined) {
      this.live.set(id, { isSent: false, resend: undefined, onRefused })
    }
    return id
  }

  transmit(
    id: number,
    encode: (imageId: number) => string,
    options: { resend?: boolean } = { resend: true },
  ): boolean {
    const live = this.live.get(id)
    const consumed = !options.resend
    if (live === undefined || (consumed && this.isBackedUp(id))) return false
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
    const { isSent } = live
    this.live.delete(id)
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
    for (const [id, { resend }] of this.live) {
      if (resend !== undefined)
        this.queue(id, { sequence: resend(), isConsumed: false })
    }
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
          return [...orphans, ...deletes, ...transmits].join('')
        }
        transmits.push(head.sequence)
        bytes += head.sequence.length
        queue.shift()
      }
      this.pendingTransmits.delete(id)
    }
    return [...orphans, ...deletes, ...transmits].join('')
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
