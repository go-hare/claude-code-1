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

const i = buf.indexOf(Buffer.from('Meb as XX'))
console.log('Meb as XX', i)
console.log(asciiWindow(buf, i - 200, i + 250))

writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-dig-Meb-XX-import.txt',
  `# @${i}\n\n${asciiWindow(buf, i - 400, i + 300)}\n`,
)

// find export Meb
const asMeb = buf.indexOf(Buffer.from(' as Meb'))
console.log('as Meb first', asMeb)
if (asMeb >= 0) {
  console.log(asciiWindow(buf, asMeb - 80, asMeb + 40))
}

let from = 0
let n = 0
while (n < 8) {
  const j = buf.indexOf(Buffer.from(' as Meb'), from)
  if (j < 0) break
  const win = asciiWindow(buf, j - 60, j + 30)
  console.log('as Meb', j, win)
  from = j + 6
  n++
}

// function that is exported as Meb: search export{...Meb
from = 0
n = 0
const needle = Buffer.from('export{')
while (n < 30) {
  const j = buf.indexOf(needle, from)
  if (j < 0) break
  const win = asciiWindow(buf, j, j + 500)
  if (/\bMeb\b/.test(win) && (win.includes(' as Meb') || win.includes('Meb,') || win.startsWith('export{Meb'))) {
    console.log('export-Meb', j, win.slice(0, 300))
    writeFileSync(
      'docs/upstream-extraction/v2.1.247/snippets/gold-dig-Meb-export.txt',
      `# @${j}\n\n${win}\n`,
    )
    break
  }
  from = j + 7
  n++
  if (from > 250000000) break
}
