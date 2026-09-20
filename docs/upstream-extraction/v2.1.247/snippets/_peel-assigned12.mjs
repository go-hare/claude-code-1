import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const sea = process.env.OFFICIAL_247 ||
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
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
  return pos
}

const needles = [
  'wsc as Ae',
  'xsc as Ie',
  'export{wsc',
  'export{xsc',
  'as wsc}',
  'as xsc}',
  'as wsc,',
  'as xsc,',
  'function wsc(',
  'function xsc(',
  'wsc=',
  'xsc=',
  'var wsc=',
  'var xsc=',
]

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
}

// dump first few likely defs
for (const n of ['function wsc(', 'function xsc(', 'var wsc=', 'var xsc=', 'as wsc}', 'as xsc}']) {
  let p = 0
  let k = 0
  while (k < 3) {
    const i = idx(n, p)
    if (i < 0) break
    asciiWindow(i, 200, 2500, `gold-22-${n.replace(/\W+/g, '_')}-${k}.txt`)
    k++
    p = i + n.length
  }
}

// also dump around Onboarding Ae()/Ie() usage more completely
const yo = idx('function Yo({host:i,onDone:s})')
if (yo >= 0) asciiWindow(yo, 0, 8000, 'gold-22-yo-full.txt')
