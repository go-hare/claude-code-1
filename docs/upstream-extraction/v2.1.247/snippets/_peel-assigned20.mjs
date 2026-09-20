import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const sea = 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const buf = readFileSync(sea)
const outDir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

function idx(s, from = 0) {
  return buf.indexOf(Buffer.from(s, 'ascii'), from)
}
function hits(n, max = 8) {
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
  'ZGc as Bt',
  'as ZGc}',
  'as ZGc,',
  'function ZGc(',
  'function ZGc(){',
  'ZGc=',
  'var ZGc=',
  'XGc as _m',
  'function XGc(',
  'function XGc(){',
  '$Gc as fr',
  'function $Gc(',
  'function $Gc(){',
]
for (const n of needles) {
  const h = hits(n)
  console.log(h.length, JSON.stringify(n), h)
}

for (const n of ['function ZGc(){', 'function ZGc(', 'var ZGc=', 'ZGc=', 'as ZGc}', 'as ZGc,']) {
  for (const [k, i] of hits(n, 3).entries()) {
    asciiWindow(i, 200, 1500, `gold-22-${n.replace(/\W+/g, '_')}-${k}.txt`)
  }
}

for (const n of ['function XGc(){', 'function XGc(', 'function $Gc(){', 'function $Gc(']) {
  for (const [k, i] of hits(n, 2).entries()) {
    asciiWindow(i, 80, 800, `gold-22-${n.replace(/\W+/g, '_')}-${k}.txt`)
  }
}
