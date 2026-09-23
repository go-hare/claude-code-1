/**
 * wave10 pass3 — 247 H/pe vs 248 d; de import; Ejn caller fold
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
const lines = ['# gold-248-unk-wave10-28-36c', `when=${new Date().toISOString()}`, '']

function dumpFn(buf, label, i, maxLen = 2000) {
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

// 247 Z @233414784 — walk backward for H / pe / var a=60
dumpNear(b247, '#28 247 before-Z', 233414784, 2500, 80)
{
  const start = 233412000
  const win = asciiSlice(b247, start, 233415100)
  const names = [...win.matchAll(/function ([A-Za-z_$][\w$]*)\(/g)]
  lines.push('## #28 247 fns-before-Z')
  for (const m of names) lines.push(`- ${m[1]} @${start + m.index}`)
  lines.push('')
  for (const m of names) dumpFn(b247, `#28 247 ${m[1]}`, start + m.index, 1500)
}

// 247 pe used by so
for (const i of allHits(b247, 'function pe(').filter(x => x > 233400000 && x < 233430000)) {
  dumpFn(b247, '#28 247 pe', i, 1500)
}

// 248 d body exact in 247?
const dBody =
  'function d(t){let e=bt(t).replace(R,"").trim();return e.length>a?`${de(e,a)}\\u2026`:e}'
const dShape = 'e.length>a?`${de(e,a)}'
const dShape2 = '.length>a?`'
lines.push(`## d-body-exact 248=${allHits(b248, dBody)} 247=${allHits(b247, dBody)}`)

for (const n of [
  'e.length>a?`${de(e,a)}',
  'e.length>a?`${',
  'var a=60',
  'a=60',
  '/[\\x00-\\x1f\\x7f-\\x9f\\u2028\\u2029]|\\p{Cf}/gu',
]) {
  const a = allHits(b248, n)
  const b = allHits(b247, n)
  lines.push(`## ${JSON.stringify(n)} 248=${a.slice(0, 6)} 247=${b.slice(0, 6)}`)
  for (const i of a.slice(0, 3)) dumpNear(b248, `#28 248 ${n}`, i, 80, 120)
  for (const i of b.slice(0, 3)) dumpNear(b247, `#28 247 ${n}`, i, 80, 120)
}

// imported de from chunk-3yhm9tnn — find f() wrapper
dumpNear(b248, '#28 de-import-chunk', 178357416, 400, 200)
dumpFn(b248, '#28 de-full', 178357416, 400)
// function f( near that de
{
  const win = asciiSlice(b248, 178356800, 178357600)
  lines.push('## #28 around-de-chunk')
  lines.push(win)
  lines.push('')
}

// leftover-shaped truncateSessionNamePrefix in 248
const leftoverTrunc =
  'function de(t,n){if(n<=0)return"";if(t.length<=n)return t;let e=t.slice(0,n),r=e.charCodeAt(n-1);return f(r>=55296&&r<=56319?e.slice(0,-1):e)}'
lines.push(
  `## leftover-de-shape 248=${allHits(b248, leftoverTrunc)} 247=${allHits(b247, leftoverTrunc)}`,
)
for (const n of [
  'r>=55296&&r<=56319',
  'charCodeAt(n-1)',
  'function truncateSessionNamePrefix',
]) {
  lines.push(
    `## ${n} 248=${allHits(b248, n).length} 247=${allHits(b247, n).length}`,
  )
}

// 247 equivalent of d near Cr trust: _e()
dumpNear(b247, '#28 247 Cr-start', 233430346, 2000, 80)

// #36: who calls Ejn — is t pre-folded?
for (const n of ['Ejn(', 'dcu(', 'function Ejn(', 'dr(t)', 'Dr(t)']) {
  const a = allHits(b248, n)
  const b = allHits(b247, n)
  lines.push(`## call ${n} 248=${a.slice(0, 8)} 247=${b.slice(0, 8)}`)
}
for (const i of allHits(b248, 'Ejn(').filter(x => x !== 186136109 && x > 180000000)) {
  dumpNear(b248, '#36 Ejn-call', i, 120, 80)
}
for (const i of allHits(b247, 'dcu(').filter(x => x > 210000000 && x < 220000000)) {
  dumpNear(b247, '#36 247 dcu-call', i, 120, 80)
}

// typeahead caller: leftover folds query; official Ejn does not fold t
for (const n of ['Ejn(e,dr(', 'Ejn(', 'buildPeerMentionTypeahead']) {
  const a = allHits(b248, n)
  lines.push(`## ${n} 248=${a}`)
}

writeFileSync(`${outDir}/gold-248-unk-wave10-28-36c.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-unk-wave10-28-36c.txt`, 'lines', lines.length)
