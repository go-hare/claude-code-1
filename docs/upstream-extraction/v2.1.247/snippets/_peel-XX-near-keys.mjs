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

const factory = 207948145
writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-dig-keys-factory.txt',
  `# pluginRegistry factory @${factory}\n\n${asciiWindow(buf, factory - 2500, factory + 800)}\n`,
)

// find function XX near this factory
const around = asciiWindow(buf, factory - 8000, factory + 2000)
const idx = around.lastIndexOf('function XX(')
console.log('xx-in-around', idx, idx >= 0 ? around.slice(idx, idx + 500) : 'none')

const idx2 = around.indexOf('XX=')
console.log('XX=', idx2 >= 0 ? around.slice(Math.max(0, idx2 - 40), idx2 + 200) : 'none')

// search `function XX(e,t){` near 2079xxxxx
let from = 207000000
let n = 0
const needle = Buffer.from('function XX(')
while (n < 20) {
  const i = buf.indexOf(needle, from)
  if (i < 0 || i > 216000000) break
  console.log('XX@', i, asciiWindow(buf, i, i + 280))
  from = i + 10
  n++
}

// J8 used in GCS: J8(d,BLn(t)) — path-to-key
from = 207000000
n = 0
const j8 = Buffer.from('function J8(')
while (n < 12) {
  const i = buf.indexOf(j8, from)
  if (i < 0 || i > 216000000) break
  const win = asciiWindow(buf, i, i + 350)
  if (win.includes('plugin') || win.includes('namespace') || Math.abs(i - factory) < 200000) {
    console.log('J8@', i, win.slice(0, 280))
  }
  from = i + 10
  n++
}
