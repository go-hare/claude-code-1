import { readFileSync, writeFileSync } from 'node:fs'

const s = readFileSync(new URL('./gold-GP-search.txt', import.meta.url), 'utf8')
const keys = ['if(j.ctrl)', 'if(j.meta)', 'case"w"', 'case"d"', 'case"f"', 'case"b"']
let out = ''
for (const k of keys) {
  const i = s.indexOf(k)
  out += `\n==== ${k} ${i} ====\n`
  if (i >= 0) out += s.slice(i, i + 1200) + '\n'
}
writeFileSync(new URL('./gold-GP-tail.txt', import.meta.url), out)
console.log(out.length)
