import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)
function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

const i = 317192918
const chunks = [
  '==== startsWith **/ wider ====',
  printable(buf.slice(i - 800, i + 400).toString('utf8')),
  '',
  '==== function Cs( ====',
]
let from = 0
const needle = Buffer.from('function Cs(')
let n = 0
while (n < 5) {
  const j = buf.indexOf(needle, from)
  if (j < 0) break
  chunks.push(`\n---- ${j} ----`)
  chunks.push(printable(buf.slice(j, j + 200).toString('utf8')))
  from = j + needle.length
  n++
}

writeFileSync(new URL('./gold-cs.txt', import.meta.url), chunks.join('\n'))
console.log('ok')
