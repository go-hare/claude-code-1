// densable 2.1.248 #48 — dump full chunk + callers of C/P/v/N/y
import { readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const b248 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe',
)

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

function sha(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
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

const lines = ['# gold-248-48-trust3', '']

// find chunk bounds: Version header just before y=65534
const yOff = 182939595
const header = Buffer.from('// Version: 2.1.248\n')
let chunkStart = -1
for (let i = yOff; i > yOff - 5000; i--) {
  if (b248[i] === header[0] && b248.subarray(i, i + header.length).equals(header)) {
    chunkStart = i
    break
  }
}
const nextHeader = b248.indexOf(header, yOff + 20)
lines.push(`chunkStart=${chunkStart} nextHeader=${nextHeader} yOff=${yOff}`)
lines.push(`chunkLen=${nextHeader > 0 ? nextHeader - chunkStart : 'unknown'}`)
lines.push('')

const chunkEnd = nextHeader > 0 ? nextHeader : yOff + 20000
const chunk = asciiSlice(b248, chunkStart, chunkEnd)
writeFileSync(`${outDir}/gold-248-48-chunk.txt`, chunk)
lines.push(`## chunk ascii len=${chunk.length} sha=${sha(chunk)}`)
lines.push('')

// exports of this chunk
const expIdx = chunk.lastIndexOf('export{')
lines.push('## export')
lines.push(chunk.slice(expIdx, expIdx + 800))
lines.push('')

// find function defs in first 8000 of chunk
lines.push('## first 8000 of chunk')
lines.push(chunk.slice(0, 8000))
lines.push('')

// search for uses of overflowuid helpers as CALLEES in this chunk
const patterns = [
  'await C()',
  'C()',
  'P(',
  'v(',
  'N(',
  '===y',
  '==y',
  'y===',
  ',y)',
  '(y)',
  'y,',
  'await _()',
  '_(',
  'r4n()',
  'await r4n',
  'hostStart',
  'innerStart',
  'overflowuid',
  'canonical',
  '/tmp',
  '/var',
  '/run',
  '/usr',
  '/etc',
  '/dev',
  '/proc',
  'nobody',
  'unmapped',
  'root',
  'system',
]

lines.push('## chunk-local needles')
for (const p of patterns) {
  let count = 0
  let idx = 0
  const hits = []
  while (true) {
    const k = chunk.indexOf(p, idx)
    if (k < 0) break
    count++
    if (hits.length < 6) hits.push(k)
    idx = k + p.length
  }
  if (count) {
    lines.push(`### ${JSON.stringify(p)} count=${count} offs=${hits.join(',')}`)
    for (const h of hits) {
      lines.push(chunk.slice(Math.max(0, h - 60), h + 120).replace(/\n/g, '\\n'))
      lines.push('---')
    }
  }
}

// source map: chunk-d4ydbwdj
lines.push('## sourcemap around overflowuid string @97792901')
lines.push(asciiSlice(b248, 97792800, 97793500))
lines.push('')

// look for exported names from this chunk used elsewhere
const exportMatch = chunk.slice(expIdx).match(/export\{([^}]+)\}/)
if (exportMatch) {
  lines.push(`## exports list: ${exportMatch[1]}`)
}

writeFileSync(`${outDir}/gold-248-48-trust3.txt`, lines.join('\n'))
console.log('WROTE trust3 + chunk', chunkStart, chunkEnd, chunk.length)
