import {
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
} from './_peel-251-helpers.mjs'
const buf = loadSea()

const hits = allHits(buf, 'function AL(')
console.log('AL hits', hits.filter((h) => h > 180000000 && h < 186000000))
for (const h of hits) {
  if (h > 184000000 && h < 186000000) {
    const ex = extractFnAt(buf, h, 800)
    console.log(h, ex.len, ex.sha, (ex.body || '').slice(0, 300))
  }
}

// AL() call near odn
const win = asciiSlice(buf, 185309860, 185310120)
console.log('odn tail', win)

const hits2 = allHits(buf, 'function AL()')
console.log('AL()', hits2)
for (const h of hits2) {
  if (h > 179000000 && h < 190000000) {
    const ex = extractFnAt(buf, h, 400)
    console.log('AL()', h, ex.len, ex.sha, ex.body)
  }
}
