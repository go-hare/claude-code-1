/**
 * 248 #20 — extract sp() used by P0n, and 247 deleteJob unpushed call.
 */
import { existsSync, writeFileSync } from 'fs'
import {
  EXE_247,
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
} from './_peel-248-na-helpers.mjs'

const out = 'docs/upstream-extraction/v2.1.248/snippets/gold-248-20-sp.txt'
const b248 = loadSea(EXE_248)
const b247 = existsSync(EXE_247) ? loadSea(EXE_247) : null
const lines = ['# gold-248-20-sp', '']

function dumpFn(label, buf, i, maxLen = 2000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
}

// P0n uses sp(e,p)===sp(e,g). Find function sp( near that offset.
const p0n = 186369915
lines.push('## window before P0n looking for function sp')
lines.push(asciiSlice(b248, p0n - 8000, p0n - 7000))
lines.push('')

const winStart = p0n - 200000
const win = asciiSlice(b248, winStart, p0n)
const re = /function (sp|Dm|jn|Ul|Ba)\(/g
let m
const found = []
while ((m = re.exec(win))) {
  found.push({ name: m[1], abs: winStart + m.index })
}
lines.push(`## helpers in 200k before P0n count=${found.length}`)
for (const f of found.slice(-20)) {
  lines.push(`- ${f.name} @${f.abs}`)
}
lines.push('')

for (const name of ['function sp(', 'function Dm(', 'function jn(']) {
  const hits = allHits(b248, name)
  lines.push(`## ${name} hits=${hits.length}`)
  for (const i of hits.slice(0, 6)) {
    lines.push(`- @${i} ${asciiSlice(b248, i, i + 180)}`)
  }
  lines.push('')
}

// last function sp before P0n
{
  const needle = Buffer.from('function sp(')
  let best = -1
  let i = Math.max(0, p0n - 500000)
  while (i < p0n) {
    const k = b248.indexOf(needle, i)
    if (k < 0 || k >= p0n) break
    best = k
    i = k + needle.length
  }
  dumpFn('#20 last function sp( before P0n', b248, best, 800)
  lines.push(`## last sp @${best}`)
  if (best >= 0) lines.push(asciiSlice(b248, best, best + 400))
  lines.push('')
}

// Also function sp= or sp=e
for (const n of [',sp,', 'sp=function', 'const sp=', 'var sp=', 'function sp(e,t)']) {
  const hits = allHits(b248, n)
  lines.push(`## needle ${JSON.stringify(n)} hits=${hits.length}`)
  for (const i of hits.slice(0, 4)) {
    lines.push(`- @${i} ${asciiSlice(b248, i - 40, i + 200)}`)
  }
  lines.push('')
}

// 247 deleteJob unpushed call — search JS band
if (b247) {
  const hits = []
  const n = Buffer.from('has commits that are on no remote, kept')
  let i = 0
  while (i < b247.length) {
    const k = b247.indexOf(n, i)
    if (k < 0) break
    hits.push(k)
    i = k + n.length
  }
  lines.push(`## 247 on-no-remote kept @ ${hits.join(',')}`)
  for (const k of hits) {
    lines.push(asciiSlice(b247, k - 400, k + 200))
    lines.push('---')
    const { i: fi, name } = lastFnStartGeneric(b247, k, 20000)
    dumpFn(`#20-247 covering ${name}`, b247, fi, 12000)
  }
}

writeFileSync(out, lines.join('\n'))
console.log('WROTE', out, 'lines', lines.length)
