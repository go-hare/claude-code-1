import {
  loadSea,
  allHits,
  asciiSlice,
} from './_peel-251-helpers.mjs'

const buf = loadSea()
const h = 201866500
console.log(asciiSlice(buf, h, h + 1200))

for (const n of [
  'minWidth:2',
  'aria-label:"claude:"',
  'width:"100%"',
  'hideTrailingLine:hm',
]) {
  const hits = allHits(buf, n).filter(x => x > 201860000 && x < 201880000)
  console.log(n, hits.join(','))
  for (const hit of hits.slice(0, 2)) {
    console.log(asciiSlice(buf, hit - 100, hit + 400))
  }
}
