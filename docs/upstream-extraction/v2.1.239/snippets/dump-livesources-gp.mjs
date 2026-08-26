import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)

function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

// live-sources.md starts at 325172852
const lsStart = buf.indexOf(Buffer.from('# Live Documentation Sources'))
let ls = buf.slice(lsStart, lsStart + 25000).toString('utf8')
const lsEnd = ls.indexOf('\n# ')
if (lsEnd > 0) {
  // second heading at start is "# Live..." — find next top-level after body
}
// stop at next skill file-ish marker
const cut = ls.search(/\n# [A-Z][a-z].{0,40}\n/)
const ls2 = cut > 10 ? ls.slice(0, cut + 80) : ls.slice(0, 18000)
writeFileSync(
  new URL('./gold-live-sources-239.md', import.meta.url),
  printable(ls2).replace(/\r\n/g, '\n'),
)
console.log('live-sources start', lsStart, 'cut', cut, 'out', ls2.length)
console.log(
  'has SDK major',
  ls2.includes('SDK major-version'),
  'has MIGRATION.md',
  ls2.includes('MIGRATION.md'),
)

const gp = buf.indexOf(Buffer.from('function GP({isActive:'))
const gpText = printable(buf.slice(gp, gp + 6000).toString('utf8'))
writeFileSync(new URL('./gold-GP-search.txt', import.meta.url), gpText)
console.log('GP', gp, gpText.includes('backspace'), gpText.indexOf('backspace'))
