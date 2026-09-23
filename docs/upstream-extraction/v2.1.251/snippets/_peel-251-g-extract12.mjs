import { asciiSlice, extractFnAt, loadSea } from './_peel-251-helpers.mjs'
const buf = loadSea()
const t = asciiSlice(buf, 181226500, 181226850)
console.log(t)
const rel = t.indexOf('function $V')
console.log('rel', rel)
if (rel >= 0) {
  const i = 181226500 + rel
  console.log(extractFnAt(buf, i, 800))
}
const t2 = asciiSlice(buf, 185309850, 185310050)
console.log('odn', t2)
