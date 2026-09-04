/**
 * densable 2.1.243 #1 — `/usage` Loops breakdown (SEA `Xu` / `Nh` / `qe` / `oe`).
 *
 * Rows are keyed by loop prompt. A fire increments `runs` and stamps
 * `lastRunMs`; assistant usage after that fire adds `tokens`.
 */

import type { Message } from '../types/message.js'
import { cronToHuman } from './cron.js'
import { isLoopScheduledTaskFire, type LoopFireStamp } from './loopNoopFold.js'

export type { LoopFireStamp }

export type LoopUsageRow = {
  prompt: string
  cron?: string
  isDynamic: boolean
  runs: number
  tokens: number
  lastRunMs: number
}

/** Official `Oa.slice(0, So)` — max visible rows before "… N more". */
export const LOOP_USAGE_VISIBLE_ROWS = 8

/** Column widths from SEA `qs/Xs/Js/nn/Qs`; `Lh = Zs+24`. */
export const LOOP_USAGE_COL = {
  every: 10,
  runs: 6,
  tokens: 8,
  perRun: 9,
  lastRun: 9,
} as const

const LOOP_USAGE_FIXED =
  LOOP_USAGE_COL.every +
  LOOP_USAGE_COL.runs +
  LOOP_USAGE_COL.tokens +
  LOOP_USAGE_COL.perRun +
  LOOP_USAGE_COL.lastRun

export const LOOP_USAGE_WIDE_MIN = LOOP_USAGE_FIXED + 24

export function getLoopFireStamp(msg: Message): LoopFireStamp | undefined {
  const raw = msg.loop
  if (!raw || typeof raw !== 'object') return undefined
  const loop = raw as Partial<LoopFireStamp>
  if (typeof loop.prompt !== 'string' || loop.prompt.length === 0) {
    return undefined
  }
  return {
    prompt: loop.prompt,
    cron: typeof loop.cron === 'string' ? loop.cron : undefined,
    isDynamic: loop.isDynamic === true,
  }
}

/** densable `Nh` — interval cell. */
export function formatLoopEvery(
  row: Pick<LoopUsageRow, 'isDynamic' | 'cron'>,
): string {
  if (row.isDynamic) return 'dynamic'
  if (!row.cron) return '?'
  const n = row.cron.match(
    /^(?:(?:\*\/(\d+)|(\*)) \* \* \* \*|0 (?:\*\/(\d+)|(\*)) \* \* \*|0 0 (?:\*\/(\d+)|(\*)) \* \*|(\d{1,2}) (\d{1,2}) \* \* \*)$/,
  )
  if (n) {
    if (n[1] || n[2]) return `${n[1] ?? 1}m`
    if (n[3] || n[4]) return `${n[3] ?? 1}h`
    if (n[5] || n[6]) return `${n[5] ?? 1}d`
    return `at ${n[8]!.padStart(2, '0')}:${n[7]!.padStart(2, '0')}`
  }
  return cronToHuman(row.cron).toLowerCase()
}

function usageTokens(msg: Message): number {
  const usage = msg.message?.usage
  if (!usage || typeof usage !== 'object') return 0
  const u = usage as Record<string, unknown>
  const n = (key: string): number =>
    typeof u[key] === 'number' && Number.isFinite(u[key])
      ? (u[key] as number)
      : 0
  return (
    n('input_tokens') +
    n('output_tokens') +
    n('cache_read_input_tokens') +
    n('cache_creation_input_tokens')
  )
}

function getOrCreate(
  loops: Map<string, LoopUsageRow>,
  stamp: LoopFireStamp,
): LoopUsageRow {
  let row = loops.get(stamp.prompt)
  if (!row) {
    row = {
      prompt: stamp.prompt,
      cron: stamp.cron,
      isDynamic: stamp.isDynamic,
      runs: 0,
      tokens: 0,
      lastRunMs: 0,
    }
    loops.set(stamp.prompt, row)
  }
  return row
}

/** densable `qe` + `oe` + usage attribution onto the open loop batch. */
export function collectLoopUsageRows(
  messages: readonly Message[],
): LoopUsageRow[] {
  const loops = new Map<string, LoopUsageRow>()
  let open: LoopUsageRow | undefined

  for (const msg of messages) {
    if (isLoopScheduledTaskFire(msg)) {
      const stamp = getLoopFireStamp(msg)
      if (!stamp) {
        open = undefined
        continue
      }
      const row = getOrCreate(loops, stamp)
      row.runs++
      const ts =
        typeof msg.timestamp === 'string' ? Date.parse(msg.timestamp) : 0
      if (Number.isFinite(ts) && ts >= row.lastRunMs) {
        row.lastRunMs = ts
        row.cron = stamp.cron ?? row.cron
        row.isDynamic = stamp.isDynamic
      }
      open = row
      continue
    }
    if (open && msg.type === 'assistant') {
      open.tokens += usageTokens(msg)
    }
  }

  return [...loops.values()].sort((a, b) => b.lastRunMs - a.lastRunMs)
}
