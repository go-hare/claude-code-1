/**
 * wave9 pass2 — extract #14 c/cGn/Dv producers, #28 $_, #31 dNe, #36 extra NFKC
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
  '# gold-248-unk-wave9b',
  `when=${new Date().toISOString()}`,
  '',
]

function cnt(buf, n) {
  return allHits(buf, n).length
}

function dumpFn(buf, label, i, maxLen = 8000) {
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
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
  return ext
}

function dumpNear(buf, label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function hits(buf, n, min = 0) {
  return allHits(buf, n).filter(i => i >= min)
}

// ---- #14 extract full chunk around c/cGn ----
lines.push('# ==== #14 c/cGn/Dv chunk ====')
const cI = b248.indexOf(
  Buffer.from(
    'function c(n,t){return n.replace(/(`+)(.+?)\\1/g',
  ),
)
dumpFn(b248, '#14 c', cI, 1200)
const cGnI = b248.indexOf(Buffer.from('function cGn(n,t){return d(n)?c(n,t):n}'))
dumpFn(b248, '#14 cGn', cGnI, 400)
const dI = b248.indexOf(Buffer.from('function d(n){return _.some((t)=>n.startsWith(t))||a(n)}'))
dumpFn(b248, '#14 d', dI, 400)
const aI = b248.indexOf(Buffer.from('function a(n){let t=n.replace(E,"").indexOf(`${$Ie}${FIe}\\``)'))
dumpFn(b248, '#14 a', aI, 400)
const dvI = b248.indexOf(Buffer.from('function Dv(d){return cGn(d,(C)=>ae.bold(C))}'))
dumpFn(b248, '#14 Dv-bold', dvI, 200)

dumpNear(b248, '#14 chunk-export', cGnI, 0, 400)

// 247 equivalents
for (const n of [
  'function cGn(',
  'Set model to ',
  'Kept model as ',
  'Current model: ',
  ' · model set to ',
  '${$Ie}${FIe}',
  'Fast mode ON · model set to `',
]) {
  lines.push(`- 247 ${JSON.stringify(n)}=${cnt(b247, n)}  248=${cnt(b248, n)}`)
}
lines.push('')

// producers that wrap model in backticks
for (const n of [
  'Set model to `',
  'Kept model as `',
  'Current model: `',
  'model set to `',
  '${i9}`',
  'i9+"`"',
  '`${i9}`',
  '`${i9}${',
  '`${SZ}`',
  '`${FIe}`',
  'FIe+"`',
  '`${$Ie}${FIe}`',
  '"`"+',
]) {
  const a = hits(b248, n)
  const b = cnt(b247, n)
  lines.push(`- prod ${JSON.stringify(n)} 248=${a.length} 247=${b}`)
  for (const i of a.slice(0, 4)) {
    dumpNear(b248, `#14 prod ${n}`, i, 80, 180)
    const st = lastFnStartGeneric(b248, i, 4000)
    if (st.i >= 0) dumpFn(b248, `#14 prod-fn ${st.name}`, st.i, 2500)
  }
}

// callers of cGn / Dv
for (const n of ['cGn(', 'Dv(', 'segments:[{text:Dv(']) {
  const a = hits(b248, n, 170000000)
  lines.push(`- call ${JSON.stringify(n)} code=${a.length}`)
  for (const i of a.slice(0, 8)) dumpNear(b248, `#14 call ${n}`, i, 60, 160)
}

// leftover-shaped builders
for (const n of [
  'Set model to ${',
  'Kept model as ${',
  'function JKt(',
  'announceKeptOn',
  'renderModelLabel',
]) {
  const a = hits(b248, n, 170000000)
  lines.push(`- builder ${JSON.stringify(n)} 248=${a.length} 247=${cnt(b247, n)}`)
  for (const i of a.slice(0, 3)) dumpNear(b248, `#14 builder ${n}`, i, 80, 200)
}

// 247 Fast mode ON · model set to
dumpNear(
  b247,
  '#14 247 Fast mode ON model set',
  b247.indexOf(Buffer.from('Fast mode ON')),
  40,
  80,
)
const f247 = hits(b247, ' · model set to ')
lines.push(`## 247 model set to hits=${f247.length}`)
for (const i of f247.slice(0, 6)) dumpNear(b247, '#14 247 model-set', i, 80, 160)

// ---- #21 _P Expected schema callers ----
lines.push('# ==== #21 _P callers ====')
const pI = b248.indexOf(
  Buffer.from('function _P(l,d){let f=l?.trim()?l:d?.trim()?d:""'),
)
dumpNear(b248, '#21 _P-callers', pI, 800, 40)
const nW247 = b247.indexOf(
  Buffer.from('function nW(e,r){let n=e?.trim()?e:r?.trim()?r:""'),
)
dumpNear(b247, '#21 247-nW-callers', nW247, 800, 40)

// lastMessage assignment from hook
for (const n of [
  'lastMessage=_P',
  'lastMessage:_P',
  '_P(',
  'hook error',
  'Expected schema:',
]) {
  const a = hits(b248, n, 201000000).filter(i => i < 202000000)
  lines.push(`- #21 mid ${JSON.stringify(n)} @201-202M =${a.length}`)
  for (const i of a.slice(0, 3)) dumpNear(b248, `#21 mid ${n}`, i, 80, 160)
}

// ---- #28 $_ and rule list ----
lines.push('# ==== #28 $_ / rule list ====')
for (const n of [
  'function $_(',
  '$_(_.rules',
  '$_(T.dirs',
  'unprintable characters',
  'pre-approves ',
  'hasProjectAllowRules',
  'rawCount',
]) {
  lines.push(
    `- ${JSON.stringify(n)} 248=${cnt(b248, n)} 247=${cnt(b247, n)}`,
  )
}
const dollar = hits(b248, 'function $_(')
for (const i of dollar.slice(0, 6)) dumpFn(b248, '#28 $_', i, 1500)
for (const n of ['unprintable characters', 'pre-approves ', '$_(_.rules']) {
  for (const i of hits(b248, n).slice(0, 3)) {
    dumpNear(b248, `#28 ${n}`, i, 80, 200)
    const st = lastFnStartGeneric(b248, i, 3000)
    if (st.i >= 0) dumpFn(b248, `#28 near ${st.name}`, st.i, 2000)
  }
}

// 247 TrustDialog Go equivalent
const go247 = hits(b247, 'tengu_trust_dialog_shown').filter(i => i > 200000000)
for (const i of go247.slice(0, 2)) {
  dumpNear(b247, '#28 247 trust-shown', i, 80, 200)
  const st = lastFnStartGeneric(b247, i, 8000)
  dumpFn(b247, `#28 247-${st.name}`, st.i, 4000)
}

// 247 $_ 
for (const i of hits(b247, 'function $(').slice(0, 4)) {
  const win = asciiSlice(b247, i, i + 80)
  if (win.includes('function $_(') || win.startsWith('function $(')) {
    dumpFn(b247, '#28 247-$_-ish', i, 800)
  }
}

// grapheme R() near TrustDialog?
const rG = b248.indexOf(
  Buffer.from(
    'function R(t,n){let r="";for(let{segment:e}of Xi().segment(t)){if(r.length+e.length>n)break;r+=e}return r}',
  ),
)
dumpFn(b248, '#28 R-grapheme-trunc', rG, 200)
dumpNear(b248, '#28 R-neighbors', rG, 400, 200)
const r247 = b247.indexOf(
  Buffer.from('for(let{segment:e}of Xi().segment(t)){if(r.length+e.length>n)break'),
)
dumpNear(b247, '#28 247 R-shape', r247, 80, 80)

// ---- #31 dNe ----
lines.push('# ==== #31 dNe afterReconnect ====')
const dne = b248.indexOf(
  Buffer.from('function dNe(e,t,r,{afterReconnect:o=!1}={})'),
)
dumpFn(b248, '#31 dNe', dne, 6000)
dumpNear(b248, '#31 dNe-win', dne, 120, 80)

const dne247 = hits(b247, 'afterReconnect:o=!1')
const dne247b = hits(b247, 'afterReconnect')
lines.push(
  `247 afterReconnect:o=!1 =${dne247.length} afterReconnect=${dne247b.length}`,
)
for (const i of dne247b.filter(x => x > 200000000).slice(0, 6)) {
  dumpNear(b247, '#31 247 afterReconnect', i, 80, 200)
  const st = lastFnStartGeneric(b247, i, 4000)
  if (st.i >= 0) dumpFn(b247, `#31 247-${st.name}`, st.i, 4000)
}

// 248 afterReconnect call sites
for (const i of hits(b248, 'afterReconnect').filter(x => x > 170000000).slice(0, 10)) {
  dumpNear(b248, '#31 248 afterReconnect', i, 80, 200)
}

// resync unique?
lines.push(`resync 248=${cnt(b248, 'resync')} 247=${cnt(b247, 'resync')}`)
for (const n of [
  'resyncPermission',
  'resyncAfterReconnect',
  'resyncPending',
  'dNe(',
]) {
  lines.push(`- ${n} 248=${cnt(b248, n)} 247=${cnt(b247, n)}`)
}

// ---- #36 extra NFKC / localeCompare near mention ----
lines.push('# ==== #36 extra fold ====')
const nfkc248 = hits(b248, 'normalize("NFKC")')
const nfkc247 = hits(b247, 'normalize("NFKC")')
lines.push(`NFKC offs 248=${nfkc248.join(',')} count=${nfkc248.length}`)
lines.push(`NFKC offs 247 count=${nfkc247.length}`)

// find 248 NFKC not present as same window in 247 by function body
for (const i of nfkc248.filter(x => x > 180000000 && x < 187000000)) {
  const st = lastFnStartGeneric(b248, i, 2000)
  const ext = extractFnAt(b248, st.i, 2500)
  const in247 = ext.body ? b247.indexOf(Buffer.from(ext.body)) : -1
  lines.push(
    `- NFKC @${i} fn=${st.name}@${st.i} exact247=${in247 >= 0 ? in247 : 0} sha=${ext.sha || '?'}`,
  )
}

// mention resolve / typeahead fold unique?
for (const n of [
  'function f4p(',
  'function p4p(',
  'function l4p(',
  'function XTe(',
  'function YTe(',
  'function g2t(',
  'function Rz(',
]) {
  const a = hits(b248, n)
  const b = hits(b247, n)
  lines.push(`- ${n} 248=${a.length} 247=${b.length}`)
  if (a.length) dumpFn(b248, n, a[0], 2000)
}

writeFileSync(`${outDir}/gold-248-unk-wave9b.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-unk-wave9b.txt`, 'lines', lines.length)
