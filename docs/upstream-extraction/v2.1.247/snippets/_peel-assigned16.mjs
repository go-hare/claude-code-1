import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const sea = 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const buf = readFileSync(sea)
const outDir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

function idx(s, from = 0) {
  return buf.indexOf(Buffer.from(s, 'ascii'), from)
}
function asciiWindow(pos, before, after, name) {
  const start = Math.max(0, pos - before)
  const end = Math.min(buf.length, pos + after)
  const raw = buf.subarray(start, end)
  let s = ''
  for (const b of raw) s += b >= 32 && b < 127 ? String.fromCharCode(b) : (b === 10 ? '\n' : (b === 13 ? '\r' : '.'))
  writeFileSync(join(outDir, name), `# pos=${pos}\n${s}\n`)
}

// filehead before Q$
asciiWindow(208884712, 25000, 200, 'gold-22-q-filehead.txt')

// Bt defs near Q$ cluster
for (const pos of [207733743, 208106234, 208204853, 208229598, 211375634, 211406885, 211776725, 223006218]) {
  asciiWindow(pos, 80, 600, `gold-22-bt-at-${pos}.txt`)
}

// as Bt} / export Bt near 2088
const needles = [' as Bt}', ' as Bt,', '{Bt as', 'function Bt(){return', 'Bt=()=>', 'var Bt=']
for (const n of needles) {
  const hits = []
  let p = 0
  while (hits.length < 8) {
    const i = idx(n, p)
    if (i < 0) break
    hits.push(i)
    p = i + n.length
  }
  console.log(hits.length, JSON.stringify(n), hits)
  for (const [k, i] of hits.entries()) {
    asciiWindow(i, 150, 400, `gold-22-bt-alias-${n.replace(/\W+/g, '_')}-${k}.txt`)
  }
}
