/**
 * densable 2.1.251 SEA peel extract10 — #65 typing park.
 */
import {
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
  sha,
  allHits,
} from './_peel-251-helpers.mjs'

const buf = loadSea()
if (buf.length !== 217360032) throw new Error(`size ${buf.length}`)

function showFn(label, i, maxLen = 8000) {
  const ex = extractFnAt(buf, i, maxLen)
  console.log(`\n==== ${label} @${i} len=${ex.len} sha=${ex.sha} missEnd=${!!ex.missEnd}`)
  if (ex.body) console.log(ex.body.slice(0, 4000))
  else console.log('PREVIEW', (ex.preview || '').slice(0, 400))
}

function win(label, i, before, after) {
  const t = asciiSlice(buf, i - before, i + after)
  console.log(`\n==== WIN ${label} @${i} len=${t.length} sha=${sha(t)}`)
  console.log(t)
}

showFn('#65 Vd', 202741234, 1500)
showFn('#65 d9', 203359883, 2500)
win('#65 Vd typing', 202741234, 0, 400)
win('#65 d9 typing case', 203360050, 80, 400)

const hits = allHits(buf, 'x?"typing"')
console.log('x?typing hits', hits)
for (const h of hits.slice(0, 4)) {
  const fn = lastFnStartGeneric(buf, h, 8000)
  console.log(h, fn.name, fn.i)
  const ex = extractFnAt(buf, fn.i, 4000)
  console.log('  ', ex.len, ex.sha, (ex.body || '').slice(0, 800))
}

const hits2 = allHits(buf, 'case"typing"')
console.log('case typing hits', hits2)
for (const h of hits2.slice(0, 4)) {
  const fn = lastFnStartGeneric(buf, h, 8000)
  console.log(h, fn.name, fn.i)
  win('case typing', h, 200, 400)
}
