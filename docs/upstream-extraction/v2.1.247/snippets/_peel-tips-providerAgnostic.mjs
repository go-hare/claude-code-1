/**
 * Peel the full 247 built-in spinner-tip array and record, per tip id, whether
 * upstream sets `providerAgnostic:!0`. Output: gold-tips-providerAgnostic-0.txt.
 */
import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function ascii(start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

function findAll(needle) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (from < buf.length) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

const ANCHOR = '{id:"new-user-warmup"'
const hits = findAll(ANCHOR)
console.log(`anchor ${ANCHOR} hits: ${hits.join(', ')}`)

for (const [n, at] of hits.entries()) {
  const text = ascii(at, at + 80_000)
  const parts = text.split('{id:"')
  const rows = []
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i]
    const q = chunk.indexOf('"')
    if (q < 0) continue
    const id = chunk.slice(0, q)
    if (!/^[a-z0-9.\-_]+$/i.test(id)) break
    if (!/content:|isRelevant/.test(chunk.slice(0, 400))) continue
    rows.push({
      id,
      providerAgnostic: /providerAgnostic:\s*!0/.test(chunk.slice(0, q + 260)),
    })
  }
  console.log(`\n=== hit ${n} @${at} — ${rows.length} tip objects ===`)
  for (const r of rows) {
    console.log(`  ${r.providerAgnostic ? 'YES' : ' - '}  ${r.id}`)
  }
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/gold-tips-providerAgnostic-${n}.txt`,
    `# offset=${at} hit=${n}/${hits.length} needle=${JSON.stringify(ANCHOR)}\n` +
      `# ${rows.length} tip objects; YES = providerAgnostic:!0\n\n` +
      rows.map(r => `${r.providerAgnostic ? 'YES' : ' - '}  ${r.id}`).join('\n') +
      '\n',
  )
}
