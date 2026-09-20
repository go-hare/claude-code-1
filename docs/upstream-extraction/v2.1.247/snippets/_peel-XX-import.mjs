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

const nme = 214521154
const head = asciiWindow(buf, nme - 8000, nme + 80)
writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-dig-nme-imports.txt',
  `# nme-8k @${nme}\n\n${head}\n`,
)

const xxImp = head.match(/import\{[^}]*as XX[^}]*\}from"[^"]+"/)
console.log('xx-import', xxImp && xxImp[0])

const xxHits = [...head.matchAll(/as XX[,}]/g)]
console.log(
  'as XX',
  xxHits.map((h) => head.slice(Math.max(0, h.index - 60), h.index + 30)),
)

// also search function XX near pluginRegistry
let from = 0
let n = 0
const needle = Buffer.from('function XX(')
while (n < 15) {
  const i = buf.indexOf(needle, from)
  if (i < 0) break
  const win = asciiWindow(buf, i, i + 200)
  const dist = i - nme
  if (win.includes('pluginRegistry') || win.includes('marketplaces') || Math.abs(dist) < 800000) {
    console.log('XX', i, 'dist', dist, win.slice(0, 180))
  }
  from = i + 10
  n++
}

// Search `{namespace:"pluginRegistry",file:`
const key = buf.indexOf(Buffer.from('{namespace:"pluginRegistry",file:e}'))
const key2 = buf.indexOf(Buffer.from('namespace:"pluginRegistry",file:'))
console.log('key1', key, 'key2', key2)
if (key2 >= 0) {
  console.log(asciiWindow(buf, key2 - 120, key2 + 200))
}
