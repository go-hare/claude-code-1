/**
 * Pass 5: imported ao/gt for UWt; Ryr/zl for Oo; F6e touch; confirm no fd ancestor walk.
 */
import {
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
  sha,
} from './_peel-251-helpers.mjs'

const buf = loadSea()

function grow(i, max = 40000) {
  for (const cap of [2000, 8000, 20000, max]) {
    const ex = extractFnAt(buf, i, cap)
    if (ex.body) return { ...ex, at: i }
  }
  return { ...extractFnAt(buf, i, max), at: i }
}

function dump(needle, n = 10) {
  const hits = allHits(buf, needle)
  console.log(`\n=== ${JSON.stringify(needle)} hits=${hits.length}`)
  for (const h of hits.slice(0, n)) {
    console.log(`  @${h} ${asciiSlice(buf, h - 60, h + Math.min(180, needle.length + 120)).replace(/\s+/g, ' ')}`)
  }
  return hits
}

function show(label, i, cap = 2000) {
  const ex = grow(i)
  console.log(`\n==== ${label} @${i}`)
  if (!ex.body) {
    console.log('MISS', asciiSlice(buf, i, i + 180))
    return
  }
  console.log(`len=${ex.len} sha=${ex.sha}`)
  console.log(ex.body.length <= cap ? ex.body : ex.body.slice(0, cap) + `\n… +${ex.body.length - cap}`)
}

// UWt imports
console.log('==== UWt prelude 182183800-182185287')
console.log(asciiSlice(buf, 182183800, 182185287))

dump('chunk-vv6p7qh8.js')
dump('readlink as gt')
dump('readlink as')
dump('realpath as gt')

// Find export of ao from that chunk — search the chunk file name nearby ao=
const chunkHits = allHits(buf, 'chunk-vv6p7qh8.js')
for (const h of chunkHits.slice(0, 5)) {
  console.log('\nchunk hit', h, asciiSlice(buf, h - 200, h + 80))
}

// path ancestor helpers used as ao(t) iterable
dump('function ao(t){')
dump('ao=function')
dump('function ao(e){let t=[e]')
dump('function ao(e){let t=[];')

// Search for a small function that loops L(e) and pushes
console.log('\n==== hunt ancestor-collectors (L + push/unshift, len<800)')
const fnAo = allHits(buf, 'function ')
let found = 0
for (const h of allHits(buf, 'function ao(').concat(allHits(buf, 'function ao(t)'))) {
  const ex = grow(h, 3000)
  if (!ex.body || ex.len > 900) continue
  console.log(`ao@${h} len=${ex.len} ${ex.body.slice(0, 160)}`)
}

// Broader: functions containing both `for(;` and `L(` and `push` near UWt import chunk
// Look at Jo cluster — Jo is canonical path
dump('function Jo(')

// Ryr / zl — readable set
dump('function Ryr(')
dump('function zl(')
dump('function he(i)')

// F6e touch
show('F6e', 185036404, 120)

// DH I() refuse
dump('function I(t){return new')
const dhI = allHits(buf, 'Refusing to write')
for (const h of dhI.slice(0, 6)) {
  console.log('refuse-write', h, asciiSlice(buf, h - 80, h + 160).replace(/\s+/g, ' '))
}

// Confirm no ao(/proc/self/fd
dump('ao(`/proc/self/fd')
dump('ao("/proc/self/fd')
dump('ao(`/proc/')
dump('for(let d of ao(')
dump('for(let y of ao(')
dump('for(let O of ao(')
dump('for(let l of ao(')

// UWt second ancestor loop
console.log('\n==== UWt ao uses')
const uw = grow(182185287)
const aoUses = []
let idx = 0
while (uw.body) {
  const k = uw.body.indexOf('ao(', idx)
  if (k < 0) break
  aoUses.push(uw.body.slice(Math.max(0, k - 20), k + 30))
  idx = k + 3
}
console.log(aoUses)

const dh = grow(182187516)
console.log('DH contains ao(', dh.body?.includes('ao('))
console.log('DH contains /proc/self/fd ancestor-of-fd?', /\bao\([^)]*proc/.test(dh.body || ''))

const e2 = grow(183343478)
console.log('E2t ao uses:')
idx = 0
while (e2.body) {
  const k = e2.body.indexOf('ao(', idx)
  if (k < 0) break
  console.log(' ', e2.body.slice(Math.max(0, k - 24), k + 28))
  idx = k + 3
}
