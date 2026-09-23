/**
 * Peel official 248 LKn initialize pending-prompt split after i?.()??[]
 */
import { writeFileSync } from 'fs'
import { EXE_248, EXE_247, loadSea, asciiSlice, allHits } from './_peel-248-na-helpers.mjs'

const b248 = loadSea(EXE_248)
const b247 = loadSea(EXE_247)
const lines = ['# gold-248-31 initialize pending split', `when=${new Date().toISOString()}`, '']

const n248 = 'i?.()??[]'
for (const off of allHits(b248, n248)) {
  lines.push(`## 248 ${n248} @${off}`)
  lines.push(asciiSlice(b248, off - 200, off + 1800))
  lines.push('')
}

const n247 = 's?.()??[]'
for (const off of allHits(b247, n247)) {
  if (off < 200000000 || off > 220000000) continue
  lines.push(`## 247 ${n247} @${off}`)
  lines.push(asciiSlice(b247, off - 200, off + 1800))
  lines.push('')
}

// also hunt filter after getPendingPrompts destructure
for (const needle of [
  'pending_user_dialog_requests',
  'pending_permission_requests:R',
  'pending_permission_requests:u',
  'subtype==="can_use_tool"',
  'subtype==="request_user_dialog"',
]) {
  const hits = allHits(b248, needle).filter((x) => x > 183090000 && x < 183120000)
  lines.push(`## 248 near-LKn ${JSON.stringify(needle)} ${hits}`)
  for (const off of hits.slice(0, 4)) {
    lines.push(asciiSlice(b248, off - 60, off + 200))
    lines.push('')
  }
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-31-init-pending.txt',
  lines.join('\n'),
)
console.log('wrote', lines.length)
