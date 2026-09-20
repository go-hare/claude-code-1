import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function asciiWindow(buf, start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

const start = 211422617
writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-dig-lh-ch-ol.txt',
  asciiWindow(buf, start, start + 2500),
)
console.log(asciiWindow(buf, start, start + 1800))

// xe( function near this
const xe = buf.indexOf(Buffer.from('function xe('), 211400000)
console.log('\n--- xe ---', xe, xe > 0 ? asciiWindow(buf, xe, xe + 350) : '')
