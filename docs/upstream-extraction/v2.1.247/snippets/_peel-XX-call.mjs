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

const call = buf.indexOf(Buffer.from('XX("marketplaces",Fs())'))
console.log('XFe-call', call)
console.log(asciiWindow(buf, call - 80, call + 80))

// all XX("marketplaces"
let from = 0
let n = 0
const needle = Buffer.from('XX("marketplaces"')
while (n < 10) {
  const i = buf.indexOf(needle, from)
  if (i < 0) break
  console.log('call@', i, asciiWindow(buf, i - 60, i + 80))
  from = i + 10
  n++
}

// Find import as XX from a chunk, searching backwards from call for "as XX"
if (call > 0) {
  const head = asciiWindow(buf, call - 200000, call)
  let idx = 0
  const hits = []
  while (hits.length < 15) {
    const i = head.indexOf('as XX', idx)
    if (i < 0) break
    hits.push(head.slice(Math.max(0, i - 100), i + 50))
    idx = i + 5
  }
  console.log('as XX in 200k', hits.length)
  for (const h of hits) console.log(' --', h.replace(/\n/g, ' '))
}

// Maybe imported as { _r as XX } or similar from keys module
const keysMod = 207948124
console.log('keys-export-scan nearby')
console.log(asciiWindow(buf, keysMod - 300, keysMod))
