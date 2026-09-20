import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const sea247 = 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const sea246 = 'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe'
const buf = readFileSync(sea247)
const buf246 = existsSync(sea246) ? readFileSync(sea246) : null
const outDir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

function idx(bufx, s, from = 0) {
  return bufx.indexOf(Buffer.from(s, 'ascii'), from)
}
function hits(bufx, n, max = 8) {
  const out = []
  let p = 0
  while (out.length < max) {
    const i = idx(bufx, n, p)
    if (i < 0) break
    out.push(i)
    p = i + n.length
  }
  return out
}
function asciiWindow(bufx, pos, before, after, name) {
  const start = Math.max(0, pos - before)
  const end = Math.min(bufx.length, pos + after)
  const raw = bufx.subarray(start, end)
  let s = ''
  for (const b of raw) s += b >= 32 && b < 127 ? String.fromCharCode(b) : (b === 10 ? '\n' : (b === 13 ? '\r' : '.'))
  writeFileSync(join(outDir, name), `# pos=${pos}\n${s}\n`)
}

const needles = [
  'removeFreshCopyUnlessInUse',
  'evictCachedVersionDir',
  'clearOccupantForReplace',
  'UnlessInUse',
  'inUse',
  'unless in use',
  'live cache',
  'second scope',
  'second-scope',
]
for (const n of needles) {
  const a = hits(buf, n)
  const b = buf246 ? hits(buf246, n) : []
  console.log(`247=${a.length} 246=${b.length}`, JSON.stringify(n), a.slice(0, 4))
}

for (const n of ['removeFreshCopyUnlessInUse', 'evictCachedVersionDir', 'clearOccupantForReplace']) {
  for (const [k, i] of hits(buf, n, 3).entries()) {
    asciiWindow(buf, i, 300, 2000, `gold-19-${n}-${k}.txt`)
  }
}

// find function body of official k = removeFreshCopyUnlessInUse
// dump around function k( near plugin cache module 223437539 is export - body is earlier
asciiWindow(buf, 223400000, 0, 200, 'gold-19-mod-probe.txt')

// search function that mentions unknown + rm
for (const n of ['e!=="unknown"', 't!=="unknown"', 'n!=="unknown"', 'r!=="unknown"']) {
  const a = hits(buf, n, 6)
  console.log(a.length, n, a)
}

// Bt import into Q$ file: dump as Bt, at 208399560 and as Bt} at 208276530
asciiWindow(buf, 208399560, 200, 200, 'gold-22-as-bt-208399560.txt')
asciiWindow(buf, 208276530, 200, 200, 'gold-22-as-bt-208276530.txt')

// dump chunk start before Q$
let p = 208884712
for (let i = 0; i < 3; i++) {
  const j = buf.lastIndexOf(Buffer.from('// Version: 2.1.247'), p - 1)
  console.log('chunk version before', j)
  if (j < 0) break
  asciiWindow(buf, j, 0, 2500, `gold-22-chunk-before-q-${i}.txt`)
  p = j
}
