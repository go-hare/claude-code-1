import { EXE_248, loadSea, asciiSlice, allHits, extractFnAt } from './_peel-248-na-helpers.mjs'
const b = loadSea(EXE_248)
const i = 178357416
console.log(asciiSlice(b, i - 800, i + 250))
console.log('--- f( hits near ---')
for (const h of allHits(b, 'function f(').filter(x => x > 178350000 && x < 178360000)) {
  console.log(h, extractFnAt(b, h, 400))
}
