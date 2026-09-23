import { readFileSync } from 'fs'

const src = readFileSync('src/bootstrap/state.ts', 'utf8')
const typeMatch = src.match(/type State = \{([\s\S]*?)\n\}/)
if (!typeMatch) {
  console.log('no State')
  process.exit(1)
}
const body = typeMatch[1]
const fields = []
for (const line of body.split('\n')) {
  const m = line.match(/^\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*[?:]/)
  if (m) fields.push(m[1])
}
console.log('TYPE_FIELD_COUNT', fields.length)
const dead = []
const live = []
for (const f of fields) {
  const re = new RegExp(`STATE\\.${f}\\b`, 'g')
  const matches = [...src.matchAll(re)]
  if (matches.length === 0) dead.push(f)
  else live.push({ f, n: matches.length })
}
console.log(`\n=== ZERO STATE.field refs (${dead.length}) ===`)
for (const f of dead) console.log(f)
console.log(`\n=== LIVE STATE.field refs (${live.length}) ===`)
for (const { f, n } of live) console.log(`${n}\t${f}`)
