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
  'could not be read',
  'Unable to read managed policy',
  'function _m(){',
  'function fr(){',
  'policySettings")===null',
]
for (const n of needles) {
  const h = hits(n)
  console.log(h.length, JSON.stringify(n), h)
}

for (const n of ['could not be read', 'function _m(){', 'function fr(){']) {
  for (const [k, i] of hits(n, 3).entries()) {
    asciiWindow(i, 400, 1200, `gold-22-${n.replace(/\W+/g, '_')}-${k}.txt`)
  }
}

// scan backwards from Q$ for "function Bt(){"
let pos = 208884712
let found = 0
while (pos > 206000000 && found < 8) {
  const i = buf.lastIndexOf(Buffer.from('function Bt(){'), pos - 1)
  if (i < 0) break
  console.log('Bt before Q$', i, 'delta', 208884712 - i)
  asciiWindow(i, 100, 800, `gold-22-bt-before-q-${found}.txt`)
  found++
  pos = i
}

// plugin cache 246 vs 247: dump around copyPluginToVersionedCache
for (const [k, i] of hits('copyPluginToVersionedCache', 4).entries()) {
  asciiWindow(i, 200, 2500, `gold-19-copyVersioned-${k}.txt`)
}

// RC diff: unique-ish
for (const n of ['working_tree', 'workingTree', 'uncommitted_diff', 'file_history', 'diffHunks', 'replDiff']) {
  const h = hits(n, 4)
  console.log(h.length, JSON.stringify(n), h)
}
