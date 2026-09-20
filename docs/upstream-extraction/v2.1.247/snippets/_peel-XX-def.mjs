import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function asciiWindow(buf, start, end, collapse = true) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return collapse ? s.replace(/[.]{4,}/g, '...') : s
}

// Find bun module header before nme
const nme = 214521154
const header = Buffer.from('// @bun @bytecode')
let from = nme - 5_000_000
let last = -1
while (from < nme) {
  const i = buf.indexOf(header, from)
  if (i < 0 || i > nme) break
  last = i
  from = i + 10
}
console.log('last bun header before nme', last, nme - last)

if (last > 0) {
  const start = asciiWindow(buf, last, last + 2500, false)
  const imports = [...start.matchAll(/import\{[^}]*XX[^}]*\}from"[^"]+"/g)]
  console.log('imports-with-XX', imports.map((m) => m[0].slice(0, 200)))
  writeFileSync(
    'docs/upstream-extraction/v2.1.247/snippets/gold-dig-mkt-mod-start.txt',
    `# header@${last}\n\n${asciiWindow(buf, last, last + 4000)}\n`,
  )
}

// brute: all `function XX(` in file
from = 0
let n = 0
const needle = Buffer.from('function XX(')
while (n < 30) {
  const i = buf.indexOf(needle, from)
  if (i < 0) break
  const win = asciiWindow(buf, i, i + 220)
  console.log(n, i, 'distNme', i - nme, win.slice(0, 160).replace(/\n/g, ' '))
  from = i + 10
  n++
}

// J8 near nme
from = nme - 2_000_000
n = 0
const j8 = Buffer.from('function J8(')
while (n < 15) {
  const i = buf.indexOf(j8, from)
  if (i < 0 || i > nme + 100000) break
  console.log('J8', i, asciiWindow(buf, i, i + 280).slice(0, 220))
  from = i + 10
  n++
}
