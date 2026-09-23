import { allHits, extractFnAt, loadSea } from './_peel-251-helpers.mjs'
const buf = loadSea()
const hits = allHits(buf, 'function Que(t)')
console.log(hits)
for (const h of hits) {
  const ex = extractFnAt(buf, h, 400)
  console.log(h, ex)
}
const hits2 = allHits(buf, 'function odn(')
console.log('odn', hits2)
for (const h of hits2.filter((x) => x > 185300000)) {
  const ex = extractFnAt(buf, h, 25000)
  console.log('odn', h, ex.len, ex.sha, ex.missEnd, (ex.body || '').slice(0, 200))
}
