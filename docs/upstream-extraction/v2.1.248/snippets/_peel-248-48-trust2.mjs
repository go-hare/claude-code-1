// densable 2.1.248 #48 — find trust-apply callers of C/P/v/N/y
import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const exe248 =
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe'
const exe247 =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const b248 = readFileSync(exe248)
const b247 = readFileSync(exe247)

function asciiSlice(buf, start, end) {
  let s = ''
  const a = Math.max(0, start)
  const b = Math.min(buf.length, end)
  for (let j = a; j < b; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

function allHits(buf, needle) {
  const n = typeof needle === 'string' ? Buffer.from(needle) : needle
  const hits = []
  let i = 0
  while (i < buf.length) {
    const k = buf.indexOf(n, i)
    if (k < 0) break
    hits.push(k)
    i = k + n.length
  }
  return hits
}

const lines = ['# gold-248-48-trust2', '']

function dumpHits(label, needle, buf, max = 12) {
  const hits = allHits(buf, needle)
  lines.push(`## ${label} hits=${hits.length}`)
  for (const h of hits.slice(0, max)) {
    lines.push(`- @${h}`)
    lines.push(asciiSlice(buf, h - 120, h + 220))
    lines.push('')
  }
}

// chunk start around y=65534
const yOff = 182939595
lines.push('## chunk start before y=65534')
lines.push(asciiSlice(b248, yOff - 2500, yOff + 80))
lines.push('')

lines.push('## 5000 before y')
lines.push(asciiSlice(b248, yOff - 5000, yOff))
lines.push('')

// look for function names that might apply trust
const needles = [
  'overflowuid',
  'innerStart',
  'hostStart',
  'await C()',
  'await C(',
  'function C(',
  'P(await',
  'function v(',
  'function N(',
  'var y=65534',
  'y===',
  '===y',
  '===y||',
  '===y?',
  ',y)',
  '(y)',
  'y,',
  'uidsCollapse',
  'function M(',
  'function ce(',
  'function _()',
  'uid mapping',
  'uid_map',
  '/proc/self/uid_map',
  '/proc/1/uid_map',
  'user namespace',
  'userns',
  'root-equivalent',
  'canonical system',
  'SYSTEM_DIR',
  'system dir',
  'nobody',
  '65534',
  '4294967295',
]

for (const n of needles) dumpHits(`248 ${JSON.stringify(n)}`, n, b248, 8)

// compare 247 around same strings
for (const n of [
  'overflowuid',
  'innerStart',
  'var y=65534',
  'function v(e){let n=[];for(let t of e.split',
  'uidsCollapse',
]) {
  dumpHits(`247 ${JSON.stringify(n)}`, n, b247, 4)
}

writeFileSync(`${outDir}/gold-248-48-trust2.txt`, lines.join('\n'))
console.log('WROTE', lines.length, 'lines')
