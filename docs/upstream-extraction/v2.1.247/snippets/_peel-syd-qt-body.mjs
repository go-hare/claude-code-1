import { readFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

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

function allHits(needle) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (from < buf.length) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

console.log('==== syd as vn ====')
const syd = allHits(' as syd')
console.log(syd)
for (const i of syd.slice(0, 4)) console.log(ascii(i - 50, i + 15))

for (const n of ['function syd(', 'syd=()=>', 'function syd()']) {
  console.log(n, allHits(n).slice(0, 5))
}

// _841 export syd
console.log('\n==== _841 near syd ====')
const exp = buf.indexOf(Buffer.from('syd as vn'))
console.log(ascii(exp - 30, exp + 20))

// search function that returns CLAUDE_CONFIG_DIR in 208800-209100 (_841?)
const cfg = allHits('CLAUDE_CONFIG_DIR')
for (const i of cfg.filter(i => i > 208800000 && i < 209200000).slice(0, 8)) {
  console.log('---', i)
  console.log(ascii(i - 80, i + 120))
}

console.log('\n==== qt in _583 before to ====')
for (const n of ['async function qt(', 'function qt(']) {
  for (const i of allHits(n).filter(i => i > 210540000 && i < 210554200)) {
    console.log(i, ascii(i, i + 350))
  }
}

// copy with junction type
for (const n of [
  'type:"junction"',
  'symlink(e,n',
  'async function qt(e,n,t){',
]) {
  console.log(n, allHits(n).slice(0, 6))
}

// objects/info copy helper name from to: qt(
console.log('\n==== function before to @210552137 ====')
console.log(ascii(210551400, 210552200))
