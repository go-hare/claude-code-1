import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)
function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}
const i = buf.indexOf(Buffer.from('function DHm('))
const i2 = buf.indexOf(Buffer.from('This session is '))
writeFileSync(
  new URL('./gold-dhm.txt', import.meta.url),
  `DHm ${i}\n` +
    printable(buf.slice(Math.max(0, i - 40), i + 800).toString('utf8')) +
    `\n\nThis session is ${i2}\n` +
    printable(buf.slice(Math.max(0, i2 - 200), i2 + 500).toString('utf8')),
)
console.log({ i, i2 })
