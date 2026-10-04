/**
 * densable `rf`/`hDe` — restored session cost from a case history_file JSONL.
 * Gold: `(await hDe(e)).costState?.totalCostUSD ?? 0`, swallow on throw.
 *
 * Host: gold JSONL `type:"cost-state"` last-wins `totalCostUSD`. Do not invent
 * storageV5 transcript.
 */
import { readFile } from 'fs/promises'
import { parseJSONL } from '../../json.js'

export type EvalCostState = {
  totalCostUSD: number
}

function isCostStateLine(value: unknown): value is {
  type: 'cost-state'
  totalCostUSD: number
} {
  if (value === null || typeof value !== 'object') return false
  const rec = value as Record<string, unknown>
  return rec.type === 'cost-state' && typeof rec.totalCostUSD === 'number'
}

/**
 * densable `hDe` JSONL slice used by `rf`. Last-wins cost-state on the file.
 */
export async function loadEvalHistoryCostState(
  path: string,
): Promise<EvalCostState | undefined> {
  const raw = await readFile(path)
  const lines = parseJSONL<unknown>(raw)
  let last: EvalCostState | undefined
  for (const line of lines) {
    if (isCostStateLine(line)) last = { totalCostUSD: line.totalCostUSD }
  }
  return last
}

/** densable `rf`. */
export async function restoreEvalHistoryCostUsd(path: string): Promise<number> {
  try {
    return (await loadEvalHistoryCostState(path))?.totalCostUSD ?? 0
  } catch {
    return 0
  }
}
