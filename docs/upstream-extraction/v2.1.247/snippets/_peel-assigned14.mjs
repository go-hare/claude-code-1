import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const sea247 = process.env.OFFICIAL_247 ||
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const sea246 = process.env.OFFICIAL_246 ||
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe'
const buf = readFileSync(sea247)
const buf246 = existsSync(sea246) ? readFileSync(sea246) : null
const outDir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

function idx(bufx, s, from = 0) {
  return bufx.indexOf(Buffer.from(s, 'ascii'), from)
}

function asciiWindow(bufx, pos, before, after, name) {
  const start = Math.max(0, pos - before)
  const end = Math.min(bufx.length, pos + after)
  const raw = bufx.subarray(start, end)
  let s = ''
  for (const b of raw) s += b >= 32 && b < 127 ? String.fromCharCode(b) : (b === 10 ? '\n' : (b === 13 ? '\r' : '.'))
  writeFileSync(join(outDir, name), `# pos=${pos}\n${s}\n`)
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

const needles = [
  'function Q$(){',
  'function Z$(){',
  'function Q$(',
  'function Z$(',
  'Q$=()=>',
  'Z$=()=>',
  'var Q$=',
  'var Z$=',
  'function Q$(){',
  'Q$()',
  'error detail withheld',
  'control or invisible characters',
  'escape-safe',
  'version==="unknown"',
  "version==='unknown'",
  'live cache',
  'second-scope',
  'working-tree diff',
  'workingTreeDiff',
  'cwd_diff',
  'cwdDiff',
  'session_diff',
  'repl_diff',
]

for (const n of needles) {
  const h247 = hits(buf, n)
  const h246 = buf246 ? hits(buf246, n) : []
  console.log(`247=${h247.length} 246=${h246.length}`, JSON.stringify(n), h247.slice(0, 4))
}

for (const n of ['function Q$(){', 'function Z$(){', 'function Q$(', 'function Z$(']) {
  for (const [k, i] of hits(buf, n, 4).entries()) {
    asciiWindow(buf, i, 80, 1200, `gold-22-${n.replace(/\W+/g, '_')}-${k}.txt`)
  }
}

for (const n of ['error detail withheld', 'control or invisible characters']) {
  for (const [k, i] of hits(buf, n, 4).entries()) {
    asciiWindow(buf, i, 400, 800, `gold-25-${n.replace(/\W+/g, '_')}-${k}.txt`)
  }
}

for (const n of ['version==="unknown"', "version==='unknown'"]) {
  for (const [k, i] of hits(buf, n, 6).entries()) {
    asciiWindow(buf, i, 600, 1500, `gold-19-${n.replace(/\W+/g, '_')}-${k}.txt`)
  }
}
