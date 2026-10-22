/**
 * Query the terminal and await responses without timeouts.
 *
 * Terminal queries (DECRQM, DA1, OSC 11, etc.) share the stdin stream
 * with keyboard input. Response sequences are syntactically
 * distinguishable from key events, so the input parser recognizes them
 * and dispatches them here.
 *
 * To avoid timeouts, each query batch is terminated by a DA1 sentinel
 * (CSI c) — every terminal since VT100 responds to DA1, and terminals
 * answer queries in order. So: if your query's response arrives before
 * DA1's, the terminal supports it; if DA1 arrives first, it doesn't.
 *
 * Usage:
 *   const [sync, grapheme] = await Promise.all([
 *     querier.send(decrqm(2026)),
 *     querier.send(decrqm(2027)),
 *     querier.flush(),
 *   ])
 *   // sync and grapheme are DECRPM responses or undefined if unsupported
 */

import type { TerminalResponse } from './parse-keypress.js'
import { ESC, ESC_TYPE } from './termio/ansi.js'
import { csi } from './termio/csi.js'
import { osc } from './termio/osc.js'

/** A terminal query: an outbound request sequence paired with a matcher
 *  that recognizes the expected inbound response. Built by `decrqm()`,
 *  `oscColor()`, `kittyKeyboard()`, etc. */
export type TerminalQuery<T extends TerminalResponse = TerminalResponse> = {
  /** Escape sequence to write to stdout */
  request: string
  /** Recognizes the expected response in the inbound stream */
  match: (r: TerminalResponse) => r is T
}

type DecrpmResponse = Extract<TerminalResponse, { type: 'decrpm' }>
type Da1Response = Extract<TerminalResponse, { type: 'da1' }>
type Da2Response = Extract<TerminalResponse, { type: 'da2' }>
type KittyResponse = Extract<TerminalResponse, { type: 'kittyKeyboard' }>
type CursorPosResponse = Extract<TerminalResponse, { type: 'cursorPosition' }>
type OscResponse = Extract<TerminalResponse, { type: 'osc' }>
type XtversionResponse = Extract<TerminalResponse, { type: 'xtversion' }>
type CellSizeResponse = Extract<TerminalResponse, { type: 'cellSize' }>
type KittyGraphicsResponse = Extract<
  TerminalResponse,
  { type: 'kittyGraphics' }
>

// -- Query builders --

/** DECRQM: request DEC private mode status (CSI ? mode $ p).
 *  Terminal replies with DECRPM (CSI ? mode ; status $ y) or ignores. */
export function decrqm(mode: number): TerminalQuery<DecrpmResponse> {
  return {
    request: csi(`?${mode}$p`),
    match: (r): r is DecrpmResponse => r.type === 'decrpm' && r.mode === mode,
  }
}

/** Primary Device Attributes query (CSI c). Every terminal answers this —
 *  used internally by flush() as a universal sentinel. Call directly if
 *  you want the DA1 params. */
export function da1(): TerminalQuery<Da1Response> {
  return {
    request: csi('c'),
    match: (r): r is Da1Response => r.type === 'da1',
  }
}

/** Secondary Device Attributes query (CSI > c). Returns terminal version. */
export function da2(): TerminalQuery<Da2Response> {
  return {
    request: csi('>c'),
    match: (r): r is Da2Response => r.type === 'da2',
  }
}

/** Query current Kitty keyboard protocol flags (CSI ? u).
 *  Terminal replies with CSI ? flags u or ignores. */
export function kittyKeyboard(): TerminalQuery<KittyResponse> {
  return {
    request: csi('?u'),
    match: (r): r is KittyResponse => r.type === 'kittyKeyboard',
  }
}

/** DECXCPR: request cursor position with DEC-private marker (CSI ? 6 n).
 *  Terminal replies with CSI ? row ; col R. The `?` marker is critical —
 *  the plain DSR form (CSI 6 n → CSI row;col R) is ambiguous with
 *  modified F3 keys (Shift+F3 = CSI 1;2 R, etc.). */
export function cursorPosition(): TerminalQuery<CursorPosResponse> {
  return {
    request: csi('?6n'),
    match: (r): r is CursorPosResponse => r.type === 'cursorPosition',
  }
}

/** OSC dynamic color query (e.g. OSC 11 for bg color, OSC 10 for fg).
 *  The `?` data slot asks the terminal to reply with the current value. */
export function oscColor(code: number): TerminalQuery<OscResponse> {
  return {
    request: osc(code, '?'),
    match: (r): r is OscResponse => r.type === 'osc' && r.code === code,
  }
}

/** XTVERSION: request terminal name/version (CSI > 0 q).
 *  Terminal replies with DCS > | name ST (e.g. "xterm.js(5.5.0)") or ignores.
 *  This survives SSH — the query goes through the pty, not the environment,
 *  so it identifies the *client* terminal even when TERM_PROGRAM isn't
 *  forwarded. Used to detect xterm.js for wheel-scroll compensation. */
export function xtversion(): TerminalQuery<XtversionResponse> {
  return {
    request: csi('>0q'),
    match: (r): r is XtversionResponse => r.type === 'xtversion',
  }
}

/** densable `gyr` — XTWINOPS CSI 16 t; reply `CSI 6 ; height ; width t`. */
export function cellSize(): TerminalQuery<CellSizeResponse> {
  return {
    request: csi('16t'),
    match: (r): r is CellSizeResponse => r.type === 'cellSize',
  }
}

const KITTY_GRAPHICS_QUERY_ID = 31

/** densable `igo` — APC `_G` query id=31 dummy AAAA. */
export function kittyGraphicsQuery(
  id = KITTY_GRAPHICS_QUERY_ID,
): TerminalQuery<KittyGraphicsResponse> {
  const apc = ESC + String.fromCharCode(ESC_TYPE.APC)
  const st = ESC + String.fromCharCode(ESC_TYPE.ST)
  return {
    request: `${apc}Gi=${id},s=1,v=1,a=q,t=d,f=24;AAAA${st}`,
    match: (r): r is KittyGraphicsResponse =>
      r.type === 'kittyGraphics' && r.id === id,
  }
}

// -- Querier --

/** Sentinel request sequence (DA1). Kept internal; flush() writes it. */
const SENTINEL = csi('c')

type Pending =
  | {
      kind: 'query'
      request: string
      written: boolean
      match: (r: TerminalResponse) => boolean
      resolve: (r: TerminalResponse | undefined) => void
    }
  | {
      kind: 'sentinel'
      request: string
      written: boolean
      resolve: (ok: boolean) => void
    }
  | { kind: 'barrier' }

export class TerminalQuerier {
  /**
   * Interleaved queue of queries and sentinels in send order. Terminals
   * respond in order, so each flush() barrier only drains queries queued
   * before it — concurrent batches from independent callers stay isolated.
   */
  private queue: Pending[] = []
  /**
   * densable `hyr.isInputAttached` — stdin readable is live. Queries
   * enqueue without writing until attach so replies are not lost.
   */
  private isInputAttached = false
  /** densable theme-notify subscribers. Callback receives `dark`. */
  private themeListeners = new Set<(dark: boolean) => void>()

  constructor(private stdout: NodeJS.WriteStream) {}

  /**
   * densable `hyr.setInputAttached`. Detach is a flag only; attach
   * writes every queued item that is not a barrier and not yet `written`.
   */
  setInputAttached(attached: boolean): void {
    this.isInputAttached = attached
    if (!attached) return
    for (const item of this.queue) {
      if (item.kind !== 'barrier' && !item.written) this.write(item)
    }
  }

  /**
   * Send a query and wait for its response.
   *
   * Resolves with the response when `query.match` matches an incoming
   * TerminalResponse, or with `undefined` when a flush() sentinel arrives
   * before any matching response (meaning the terminal ignored the query).
   *
   * Never rejects; never times out on its own. If you never call flush()
   * and the terminal doesn't respond, the promise remains pending.
   */
  send<T extends TerminalResponse>(
    query: TerminalQuery<T>,
  ): Promise<T | undefined> {
    return new Promise(resolve => {
      this.enqueue({
        kind: 'query',
        request: query.request,
        written: false,
        match: query.match,
        resolve: r => resolve(r as T | undefined),
      })
    })
  }

  /**
   * Send the DA1 sentinel. Resolves `true` when DA1's response arrives,
   * `false` if `resync` splices the sentinel first.
   *
   * As a side effect, all queries still pending when DA1 arrives are
   * resolved with `undefined` (terminal didn't respond → doesn't support
   * the query). This is the barrier that makes send() timeout-free.
   *
   * Safe to call with no pending queries — still waits for a round-trip.
   */
  flush(): Promise<boolean> {
    return new Promise(resolve => {
      this.enqueue({
        kind: 'sentinel',
        request: SENTINEL,
        written: false,
        resolve,
      })
    })
  }

  /**
   * densable `owed()` — count `kind==="barrier"` or
   * `kind==="sentinel" && n.written`. Queries never count; unwritten
   * sentinels do not count until attach writes them.
   */
  owed(): number {
    let count = 0
    for (const item of this.queue) {
      if (
        item.kind === 'barrier' ||
        (item.kind === 'sentinel' && item.written)
      ) {
        count++
      }
    }
    return count
  }

  /**
   * Drop a still-pending query. Match is by `query.match` identity, the
   * same object passed to `send()`. Resolves that send() with undefined.
   */
  cancel(query: TerminalQuery): void {
    const idx = this.queue.findIndex(
      p => p.kind === 'query' && p.match === query.match,
    )
    if (idx === -1) return
    const [q] = this.queue.splice(idx, 1)
    if (q?.kind === 'query') q.resolve(undefined)
  }

  /** densable `subscribeThemeChange` — DEC 2031 reports, not query replies. */
  subscribeThemeChange(cb: (dark: boolean) => void): () => void {
    this.themeListeners.add(cb)
    return () => {
      this.themeListeners.delete(cb)
    }
  }

  /**
   * densable `hyr.resync`. Splice-drain: query → undefined, sentinel →
   * false. `probe && isInputAttached` pushes a DA1 barrier (not a
   * sentinel) so the next DA1 is consumed without resolving callers.
   */
  resync({ probe }: { probe: boolean }): void {
    for (const item of this.queue.splice(0)) {
      if (item.kind === 'query') item.resolve(undefined)
      else if (item.kind === 'sentinel') item.resolve(false)
    }
    if (probe && this.isInputAttached) {
      this.queue.push({ kind: 'barrier' })
      this.stdout.write(SENTINEL)
    }
  }

  /**
   * densable `hyr.onResponse`. Returns whether the response was
   * consumed. Unmatched non-DA1 (e.g. kitty graphics) is false so App
   * can `terminalImages.refused`.
   */
  onResponse(r: TerminalResponse): boolean {
    if (r.type === 'themeNotify') {
      for (const cb of this.themeListeners) cb(r.dark)
      return true
    }
    if (this.queue[0]?.kind === 'barrier') {
      if (r.type === 'da1') this.queue.shift()
      return true
    }
    const idx = this.queue.findIndex(p => p.kind === 'query' && p.match(r))
    if (idx !== -1) {
      const [q] = this.queue.splice(idx, 1)
      if (q?.kind === 'query') q.resolve(r)
      return true
    }
    if (r.type !== 'da1') return false
    const s = this.queue.findIndex(p => p.kind === 'sentinel')
    if (s === -1) return false
    for (const p of this.queue.splice(0, s + 1)) {
      if (p.kind === 'query') p.resolve(undefined)
      else if (p.kind === 'sentinel') p.resolve(true)
    }
    return true
  }

  /** densable `hyr.enqueue` — write only while stdin readable is attached. */
  private enqueue(item: Exclude<Pending, { kind: 'barrier' }>): void {
    this.queue.push(item)
    if (this.isInputAttached) this.write(item)
  }

  /** densable `hyr.write`. */
  private write(item: Exclude<Pending, { kind: 'barrier' }>): void {
    item.written = true
    this.stdout.write(item.request)
  }
}
