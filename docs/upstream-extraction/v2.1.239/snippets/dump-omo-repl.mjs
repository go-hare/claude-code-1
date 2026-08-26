import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)
function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

const i = 326479269
const chunks = [
  '==== REPL OMo -2000..+800 ====',
  printable(buf.slice(i - 2000, i + 800).toString('utf8')),
  '',
  '==== print OMo -800..+400 ====',
  printable(buf.slice(327188892 - 800, 327188892 + 400).toString('utf8')),
]
writeFileSync(new URL('./gold-omo-repl.txt', import.meta.url), chunks.join('\n'))
console.log('ok')
