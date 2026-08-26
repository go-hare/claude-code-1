import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)
function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}
writeFileSync(
  new URL('./gold-self-line.txt', import.meta.url),
  printable(buf.slice(314384900, 314386200).toString('utf8')),
)
console.log('ok')
