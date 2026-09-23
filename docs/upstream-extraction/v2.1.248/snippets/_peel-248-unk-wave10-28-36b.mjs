/**
 * wave10 pass2 — extract cTe.d, 247 rule builder, NDn mention regex, Ejn fold
 */
import { writeFileSync } from 'fs'
import {
  EXE_247,
  EXE_248,
  loadSea,
  asciiSlice,
  sha,
  allHits,
  extractFnAt,
  lastFnStartGeneric,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const b248 = loadSea(EXE_248)
const b247 = loadSea(EXE_247)
const lines = [
  '# gold-248-unk-wave10-28-36b',
  `when=${new Date().toISOString()}`,
  '',
]

function dumpFn(buf, label, i, maxLen = 4000) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) {
    lines.push('MISS')
    lines.push('')
    return { miss: true }
  }
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    const other = buf === b248 ? b247 : b248
    const inOther = other.indexOf(Buffer.from(ext.body))
    lines.push(
      `len=${ext.len} sha=${ext.sha} exactOther=${inOther >= 0 ? inOther : 0}`,
    )
    lines.push(ext.body)
  } else {
    lines.push(`MISS ${JSON.stringify(ext)}`)
  }
  lines.push('')
  return ext
}

function dumpNear(buf, label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function extractNear(buf, label, i, look = 4000, maxLen = 4000) {
  const start = lastFnStartGeneric(buf, i, look)
  lines.push(`## ${label} near@${i} fn=${start.name} @${start.i}`)
  return dumpFn(buf, `${label} ${start.name}`, start.i, maxLen)
}

function cnt(buf, n) {
  return allHits(buf, n).length
}

// ---- #28 d() before cTe @203817988 ----
lines.push('# ==== #28 d / cTe neighborhood ====')
dumpNear(b248, '#28 before-cTe', 203817988, 2500, 200)

{
  const win = asciiSlice(b248, 203815000, 203818200)
  const names = [...win.matchAll(/(?:async )?function ([A-Za-z_$][\w$]*)\(/g)]
  lines.push('## #28 fns-before-cTe')
  for (const m of names) {
    const abs = 203815000 + m.index
    lines.push(`- ${m[1]} @${abs}`)
  }
  lines.push('')
  for (const m of names) {
    dumpFn(b248, `#28 pre-cTe ${m[1]}`, 203815000 + m.index, 2500)
  }
}

// 247 _e() used by Cr: b=_e()
for (const n of ['function _e(', 'function De(']) {
  const hits = allHits(b247, n).filter(i => i > 233400000 && i < 233430346)
  lines.push(`## 247 ${n} near-Cr hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 4)) dumpFn(b247, `247 ${n}`, i, 2000)
}

// Search 247 for same cTe shape: ruleBehavior==="allow"
for (const n of [
  'ruleBehavior==="allow"',
  'ruleBehavior==="allow"',
  '.ruleBehavior==="allow"',
]) {
  const a = allHits(b248, n)
  const b = allHits(b247, n)
  lines.push(`## ${n} 248=${a.length} 247=${b.length}`)
  for (const i of a.slice(0, 4)) extractNear(b248, `#28 248 ${n}`, i, 2000, 2000)
  for (const i of b.slice(0, 4)) extractNear(b247, `#28 247 ${n}`, i, 2000, 2000)
}

// d($r(  — sanitizer on ruleValue
for (const n of ['d($r(', 'd($r(o.ruleValue)', '$r(o.ruleValue)']) {
  const a = allHits(b248, n)
  const b = allHits(b247, n)
  lines.push(`## ${JSON.stringify(n)} 248=${a.join(',')} 247=${b.join(',')}`)
  for (const i of a.slice(0, 4)) dumpNear(b248, `#28 248 ${n}`, i, 120, 180)
  for (const i of b.slice(0, 4)) dumpNear(b247, `#28 247 ${n}`, i, 120, 180)
}

// Find function d( near 203817000 that takes a string and truncates
{
  const hits = allHits(b248, 'function d(').filter(
    i => i > 203800000 && i < 203817988,
  )
  lines.push(`## function d( 203800-203818 = ${hits.join(',')}`)
  for (const i of hits) dumpFn(b248, '#28 d-near-cTe', i, 1500)
}

// Also search for `function d(e)` / `function d(t)` immediately before cTe more broadly
{
  const start = 203780000
  const win = asciiSlice(b248, start, 203818000)
  const names = [...win.matchAll(/function (d|g|S|\$r|p)\(/g)]
  lines.push('## #28 short-fns 203780-203818')
  for (const m of names.slice(-20)) {
    lines.push(`- ${m[1]} @${start + m.index}`)
  }
  lines.push('')
  for (const m of names.slice(-12)) {
    dumpFn(b248, `#28 short ${m[1]}`, start + m.index, 2000)
  }
}

// Cd disclosure builder: look for additionalDirectories + allow rules assembly
for (const n of [
  'additionalDirectories??[]',
  'permissions?.additionalDirectories',
  'commandHelperSources',
  'hookSources',
]) {
  const a = allHits(b248, n).filter(i => i > 200000000)
  const b = allHits(b247, n).filter(i => i > 230000000)
  lines.push(`## ${n} 248code=${a.length} 247code=${b.length}`)
  for (const i of a.slice(0, 3)) extractNear(b248, `#28 248 ${n}`, i, 3000, 2500)
  for (const i of b.slice(0, 3)) extractNear(b247, `#28 247 ${n}`, i, 3000, 2500)
}

// YC / $e 200-grapheme wrappers — are they used by cTe?
dumpFn(b248, '#28 YC', 178361620, 400)
dumpNear(b248, '#28 YC-win', 178361678, 80, 200)
for (const n of ['YC(', 'function YC(']) {
  lines.push(`## ${n} 248=${cnt(b248, n)} 247=${cnt(b247, n)}`)
}

// de(n,200) — grapheme trunc
for (const n of ['function de(', 'de(n,200)', 'de(t,200)', 'de(e,200)']) {
  const a = allHits(b248, n)
  lines.push(`## ${n} 248=${a.length}`)
  for (const i of a.slice(0, 3)) {
    if (n.startsWith('function')) dumpFn(b248, `#28 ${n}`, i, 800)
    else dumpNear(b248, `#28 ${n}`, i, 60, 80)
  }
}

// ---- #36 NDn regex + Ejn ----
lines.push('# ==== #36 NDn / Ejn ====')
dumpNear(b248, '#36 NDn-win', 186136311, 80, 800)
extractNear(b248, '#36 NDn-fn', 186136311, 2000, 1500)

// full regex literal after NDn=
{
  const win = asciiSlice(b248, 186136300, 186137200)
  lines.push('## #36 NDn-ascii-900')
  lines.push(win)
  lines.push('')
}

dumpFn(b248, '#36 Ejn', 186136000, 2500)
// find function Ejn exactly
for (const i of allHits(b248, 'function Ejn(').slice(0, 3)) {
  dumpFn(b248, '#36 Ejn-def', i, 2000)
}

// 247 equivalent of Ejn / mention regex
for (const n of [
  'dm-peer-',
  'String.raw`(?:^|[\\s\\u3002',
  'new RegExp(String.raw`(?:^|[\\s\\u3002',
]) {
  const a = allHits(b248, n)
  const b = allHits(b247, n)
  lines.push(`## ${n} 248=${a.join(',')} 247=${b.join(',')}`)
  for (const i of a.slice(0, 2)) dumpNear(b248, `#36 248 ${n}`, i, 40, 700)
  for (const i of b.slice(0, 2)) dumpNear(b247, `#36 247 ${n}`, i, 40, 700)
}

// 247 typeahead near dm-peer-
for (const i of allHits(b247, 'function ').filter(() => false));
{
  const hits = allHits(b247, 'dm-peer-').filter(i => i > 200000000)
  for (const i of hits.slice(0, 3)) {
    dumpNear(b247, '#36 247 dm-peer', i, 200, 500)
    extractNear(b247, '#36 247 dm-peer-fn', i, 4000, 2500)
  }
}

// Compare Ejn vs leftover: does Ejn fold t?
// leftover: prefix = normalizeSessionNameKey(queryPrefix)
// official: !p.startsWith(t) — who folds t?
for (const n of [
  'function Ejn(',
  'dr(u.name)',
  'startsWith(t)',
  'ckt(u.name)',
  'function ckt(',
  'function fkt(',
]) {
  const a = allHits(b248, n)
  const b = allHits(b247, n)
  lines.push(`## ${n} 248=${a.length}@${a.slice(0, 4)} 247=${b.length}@${b.slice(0, 4)}`)
}

for (const n of ['function ckt(', 'function fkt(', 'function LDn(', 'function FDn(']) {
  for (const i of allHits(b248, n).slice(0, 2)) dumpFn(b248, `#36 ${n}`, i, 1500)
}

// 247 fold name near mention typeahead
for (const n of [
  '.normalize("NFKC").replace(/[\\p{Cc}\\p{Cf}]/gu,(t)=>/\\s/.test(t)?t:"").trim().toLowerCase().replace(/\\s+/g,"-")',
]) {
  const a = allHits(b248, n)
  const b = allHits(b247, n)
  lines.push(`## fold-body 248=${a.join(',')} 247=${b.join(',')}`)
}

// Parse mention: look for NDn.exec / matchAll
for (const n of ['NDn', 'function ckt(', '[\u3002\u3001\uFF1F\uFF01]']) {
  lines.push(`## needle-check ${JSON.stringify(n)} 248=${cnt(b248, n)} 247=${cnt(b247, n)}`)
}

// Extract mention parse function that uses NDn
dumpNear(b248, '#36 after-NDn', 186136311, 0, 1500)

// 247 regex same String.raw
const reHead = 'new RegExp(String.raw`(?:^|[\\s\\u3002'
lines.push(`## reHead 248=${cnt(b248, reHead)} 247=${cnt(b247, reHead)}`)

writeFileSync(`${outDir}/gold-248-unk-wave10-28-36b.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-unk-wave10-28-36b.txt`, 'lines', lines.length)
