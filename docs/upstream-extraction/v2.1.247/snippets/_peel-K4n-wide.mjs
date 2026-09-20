import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'

function ascii(start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

writeFileSync(`${outDir}/gold-forged-K4n-wide.txt`, ascii(210542311, 210554000))
console.log('K4n window', ascii(210542311, 210544000))
console.log('\n==== later ====')
console.log(ascii(210548000, 210550500))
