import { EXE_248, loadSea, asciiSlice, extractFnAt, allHits } from './_peel-248-na-helpers.mjs'
const b = loadSea(EXE_248)

function show(n) {
  const hits = allHits(b, n)
  console.log('===', n, 'hits', hits.length, hits.slice(0, 6).join(','))
  for (const i of hits.slice(0, 5)) {
    console.log(asciiSlice(b, i, i + 160))
    console.log('---')
  }
}

show('function Tt(){')
show('function SJt(')
show('function Ao(')
show('isEssentialTrafficOnly')
show('KC=')
const kcAssign = []
let i = 192100000
while (i < 192125000) {
  const k = b.indexOf(Buffer.from('KC='), i)
  if (k < 0 || k > 192125000) break
  kcAssign.push(k)
  i = k + 2
}
console.log('KC= in fleet window', kcAssign)
for (const k of kcAssign) console.log(k, asciiSlice(b, k - 5, k + 40))
