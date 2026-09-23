import { EXE_248, loadSea, asciiSlice } from './_peel-248-na-helpers.mjs'
const b = loadSea(EXE_248)
const wo = 192124739
let i = wo
let found = []
while (found.length < 8) {
  const k = b.lastIndexOf(Buffer.from('KC'), i)
  if (k < 0) break
  found.push({ k, s: asciiSlice(b, k, k + 80) })
  i = k
}
console.log(found)
console.log('---win before Wo---')
console.log(asciiSlice(b, 192124500, 192124850))
