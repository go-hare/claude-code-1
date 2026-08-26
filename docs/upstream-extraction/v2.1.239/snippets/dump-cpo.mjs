import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)
const i = buf.indexOf(Buffer.from('function cpo(e){'))
const j = buf.indexOf(Buffer.from('You can continue'))
function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}
writeFileSync(
  new URL('./gold-cpo.txt', import.meta.url),
  [
    i < 0 ? 'MISS cpo' : printable(buf.slice(i, i + 800).toString('utf8')),
    '\n==== You can continue ====\n',
    j < 0 ? 'MISS' : printable(buf.slice(j, j + 600).toString('utf8')),
  ].join(''),
)
console.log({ i, j })
