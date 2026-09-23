/**
 * densable 2.1.251 SEA peel recon5 — #44 Tie/wur + export lines.
 */
import {
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
  sha,
} from './_peel-251-helpers.mjs'

const buf = loadSea()

function extractAt(i, maxLen = 8000) {
  const fn = extractFnAt(buf, i, maxLen)
  console.log(
    `extract @${i} miss=${!!fn.miss || !!fn.missEnd} len=${fn.len ?? 0} sha=${fn.sha ?? '-'}`,
  )
  console.log(fn.body || (fn.preview || '').slice(0, 400))
  console.log('---')
  return fn
}

for (const n of ['function Tie(', 'function wur(', 'async function wur(', 'function DT(']) {
  const hits = allHits(buf, n)
  console.log(n, 'hits', hits.length)
  for (const i of hits.slice(0, 6)) {
    const fn = lastFnStartGeneric(buf, i, 200)
    console.log(`  @${i} ${asciiSlice(buf, i, i + 120).replace(/\s+/g, ' ')}`)
    if (n.startsWith('function Tie') || n.includes('wur') || n.includes('DT')) {
      extractAt(i, n.includes('wur') ? 4000 : 800)
    }
  }
}

const tieCall = buf.indexOf(Buffer.from('let K=Tie(J)'))
console.log('Tie(J) @', tieCall)
if (tieCall >= 0) {
  const fn = lastFnStartGeneric(buf, tieCall, 8000)
  console.log('lastFn', fn.name, fn.i)
  extractAt(fn.i, 2000)
  console.log(asciiSlice(buf, tieCall - 180, tieCall + 220))
}

console.log('\n=== _ g export ===')
console.log(asciiSlice(buf, 179407800, 179408200))

console.log('\n=== HA DVt import full ===')
console.log(asciiSlice(buf, 184277500, 184277780))

console.log('\n=== uo import of _ g J ===')
console.log(asciiSlice(buf, 204640350, 204640560))

console.log('\n=== switch site sha ===')
const sw = asciiSlice(buf, 204655580, 204655920)
console.log(sw)
console.log('switchSha', sha(sw))

console.log('\n=== S0e HA restore excerpt ===')
console.log(asciiSlice(buf, 184387050, 184387420))

const italic = asciiSlice(buf, 183517458, 183517458 + 78)
console.log('\nitalic method', italic, sha(italic))
