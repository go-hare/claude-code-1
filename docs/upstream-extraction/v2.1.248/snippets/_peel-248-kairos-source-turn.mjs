import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  loadSea,
  sha,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = ['# gold-248-kairos-source-turn', '']

const needles = [
  'kairosActive',
  'sessionSource',
  'replaceKairos',
  'isKairos',
  'kairos',
  'outputTokensAtTurnStart',
  'snapshotForTurn',
  'continuationCount',
  'budgetContinuation',
  'recordSlowOperation',
  'slowOperations()',
  'addSlowOperation',
]

for (const n of needles) {
  const hits = allHits(buf, n)
  lines.push(`## needle=${JSON.stringify(n)} hits=${hits.length}`)
  for (const i of hits.slice(0, 8)) {
    lines.push(`@${i} ${asciiSlice(buf, Math.max(0, i - 120), i + Math.min(n.length + 280, 400))}`)
    lines.push('')
  }
}

writeFileSync(
  new URL('./gold-248-kairos-source-turn.txt', import.meta.url),
  lines.join('\n'),
)
console.log('wrote', lines.length)
