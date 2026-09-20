import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const sea = 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const buf = readFileSync(sea)
const outDir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

function idx(s, from = 0) {
  return buf.indexOf(Buffer.from(s, 'ascii'), from)
}
function hits(n, max = 10) {
  const out = []
  let p = 0
  while (out.length < max) {
    const i = idx(n, p)
    if (i < 0) break
    out.push(i)
    p = i + n.length
  }
  return out
}
function asciiWindow(pos, before, after, name) {
  const start = Math.max(0, pos - before)
  const end = Math.min(buf.length, pos + after)
  const raw = buf.subarray(start, end)
  let s = ''
  for (const b of raw) s += b >= 32 && b < 127 ? String.fromCharCode(b) : (b === 10 ? '\n' : (b === 13 ? '\r' : '.'))
  writeFileSync(join(outDir, name), `# pos=${pos}\n${s}\n`)
}

const needles = [
  'function Cs(){',
  'function Cs(',
  'function ni(){',
  'function ni(',
  'function bs(){',
  'function bs(',
  'function As(){',
  'Cs=()=>',
]
for (const n of needles) {
  const h = hits(n)
  console.log(h.length, JSON.stringify(n), h)
}

// prefer defs near 20827xxxx (_705 chunk)
for (const n of ['function Cs(){', 'function Cs(', 'function ni(){', 'function bs(){']) {
  for (const [k, i] of hits(n, 8).entries()) {
    if (i < 207000000 || i > 209000000) continue
    asciiWindow(i, 120, 1500, `gold-22-${n.replace(/\W+/g, '_')}-near-${k}.txt`)
  }
}

// dump _705 chunk body start
asciiWindow(208271124, 0, 8000, 'gold-22-705-body.txt')
