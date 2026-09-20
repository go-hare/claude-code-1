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
function hits(bufx, n, max = 12) {
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
  'function Bt(){',
  'function Bt(',
  'Bt().length',
  '==="unknown"',
  '=="unknown"',
  '!=="unknown"',
  'plugins/cache',
  'copyPluginToVersionedCache',
  'getVersionedCachePath',
  'safeWireMessage',
  'escapeAnsi',
  'stripControl',
  'bidirectional-formatting',
  'Marketplace name cannot contain control',
  'repl_diff_read',
  'repl_diff',
  'gitDiff',
  'working tree diff',
  'session working tree',
  'diff_files',
]
for (const n of needles) {
  const h247 = hits(buf, n)
  const h246 = buf246 ? hits(buf246, n) : []
  console.log(`247=${h247.length} 246=${h246.length}`, JSON.stringify(n), 'd=', h247.length - h246.length, h247.slice(0, 5))
}

for (const n of ['function Bt(){', 'function Bt(', 'Bt().length']) {
  for (const [k, i] of hits(buf, n, 3).entries()) {
    asciiWindow(buf, i, 200, 800, `gold-22-${n.replace(/\W+/g, '_')}-${k}.txt`)
  }
}

// dump Q$ call sites that are not the def
for (const [k, i] of hits(buf, 'Q$()', 6).entries()) {
  asciiWindow(buf, i, 120, 400, `gold-22-Q$-call-${k}.txt`)
}

// dump Z$ call sites
for (const [k, i] of hits(buf, 'Z$()', 6).entries()) {
  asciiWindow(buf, i, 120, 400, `gold-22-Z$-call-${k}.txt`)
}

// dump all ==="unknown" near plugin
for (const [k, i] of hits(buf, '==="unknown"', 12).entries()) {
  asciiWindow(buf, i, 400, 900, `gold-19-unknown-${k}.txt`)
}
