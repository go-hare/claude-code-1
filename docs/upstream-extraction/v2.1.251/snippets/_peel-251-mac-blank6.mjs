import {
  loadSea,
  allHits,
  asciiSlice,
  extractFnAt,
  sha,
} from './_peel-251-helpers.mjs'

const buf = loadSea()

// Find write() that consumes softWrap number[] from qv
// Search for patterns near softWrap assignment during write
const hits = allHits(buf, 'prevContentEnd')
console.log('prevContentEnd', hits.length, hits.join(','))
for (const h of hits) {
  console.log('\n@', h)
  console.log(asciiSlice(buf, h - 300, h + 900))
}

// Also search isSW / softWrap kind checks in write
for (const n of [
  '===di.Continuation',
  '!==di.HardBreak',
  '>di.HardBreak',
  'di.Continuation',
  '&Ao',
  'id(',
]) {
  const hs = allHits(buf, n).filter(h => h > 189620000 && h < 189720000)
  console.log('\n', n, 'in ink range', hs.length, hs.slice(0, 8).join(','))
  for (const h of hs.slice(0, 2)) {
    console.log(asciiSlice(buf, h - 120, h + 350))
  }
}

// Extract write method of Output class — search "write(t,o,u,c)"
const writeHits = allHits(buf, 'write(t,o,u,c)')
console.log('\nwrite(t,o,u,c)', writeHits)
for (const h of writeHits.filter(x => x > 189600000 && x < 189750000)) {
  const ext = extractFnAt(buf, h - 20, 8000)
  // might not find function keyword — dump window
  console.log(asciiSlice(buf, h - 50, h + 2500))
}
