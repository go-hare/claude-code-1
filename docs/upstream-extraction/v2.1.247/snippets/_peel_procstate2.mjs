import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function extractJs(start, end, minLen = 30) {
  let s = ''
  for (let i = start; i < end && i < buf.length; i++) {
    const c = buf[i]
    s += c >= 32 && c <= 126 ? String.fromCharCode(c) : '\n'
  }
  return s
}

const off = 207472400
const js = extractJs(off - 4000, off + 8000)
writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-procstat-parse-207472739.txt',
  js,
)
console.log(js.slice(0, 2500))
console.log('---LEN', js.length)
