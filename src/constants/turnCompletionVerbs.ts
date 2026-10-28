import { djb2Hash } from '../utils/hash.js'

// Past tense verbs for turn completion messages
// These verbs work naturally with "for [duration]" (e.g., "Worked for 5s")
export const TURN_COMPLETION_VERBS = [
  'Baked',
  'Brewed',
  'Churned',
  'Cogitated',
  'Cooked',
  'Crunched',
  'Sautéed',
  'Worked',
]

const FALLBACK_VERB = 'Worked'

/**
 * densable `ig(uuid)` — djb2(uuid) >>> 0 % 8, stable across remount/resume.
 * Gold SEA @207711273. Empty uuid still hashes to 0 → Baked.
 */
export function turnCompletionVerbFromUuid(uuid: string): string {
  const index = (djb2Hash(uuid) >>> 0) % TURN_COMPLETION_VERBS.length
  return TURN_COMPLETION_VERBS[index] ?? FALLBACK_VERB
}
