/**
 * Find lyr's ce(s,RP) truncator. RP binding too.
 */
import { allHits, asciiSlice, extractFnAt, lastFnStartGeneric, loadSea } from './_peel-251-helpers.mjs'

const buf = loadSea()

function grow(i) {
  for (const cap of [800, 2000, 8000]) {
    const ex = extractFnAt(buf, i, cap)
    if (ex.body) return { ...ex, at: i }
  }
  return { ...extractFnAt(buf, i, 8000), at: i }
}

console.log('==== lyr neighborhood 181658800-181660200')
console.log(asciiSlice(buf, 181658800, 181660200))

console.log('\n==== RP bindings')
for (const n of ['var RP=', 'let RP=', 'const RP=', 'RP=']) {
  const hits = allHits(buf, n)
  console.log(n, hits.length, hits.slice(0, 8).join(','))
  for (const h of hits.slice(0, 6)) {
    if (Math.abs(h - 181659488) > 200000) continue
    console.log('  near', h, asciiSlice(buf, h, h + 80))
  }
}

console.log('\n==== function ce( that slices / length-caps')
for (const h of allHits(buf, 'function ce(')) {
  const ex = grow(h)
  if (!ex.body) continue
  const looks =
    (ex.body.includes('slice') || ex.body.includes('substring') || ex.body.includes('length')) &&
    ex.len < 250 &&
    /^function ce\([A-Za-z]+,[A-Za-z]+\)/.test(ex.body)
  if (looks) {
    console.log(`@${h} len=${ex.len}`, ex.body)
  }
}

console.log('\n==== ce(s,RP) call sites')
for (const n of ['ce(s,RP)', 'ce(e,RP)', 'ce(t,RP)']) {
  const hits = allHits(buf, n)
  console.log(n, hits)
}

// $e and xP already known. What is ce imported as?
console.log('\n==== imports mentioning ce near lyr module')
const win = asciiSlice(buf, 181650000, 181659488)
const idx = win.lastIndexOf('import{')
console.log('last import in prelude', idx >= 0 ? win.slice(idx, idx + 400) : win.slice(0, 400))
