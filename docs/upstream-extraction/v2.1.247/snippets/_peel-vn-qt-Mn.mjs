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

console.log('==== _583 imports around 210528 ====')
console.log(ascii(210527600, 210528200))

console.log('\n==== as vn ====')
for (const n of [' as vn}', ' as vn,', 'vn as ', 'function vn()']) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 8))
  for (const i of hits.slice(0, 2)) console.log(ascii(i - 60, i + 40))
}

console.log('\n==== qt as @210527731 ====')
console.log(ascii(210527680, 210527900))

console.log('\n==== Mn @208177817 ====')
console.log(ascii(208177817, 208178050))

console.log('\n==== getClaudeConfig / CLAUDE_CONFIG_DIR function ====')
for (const n of [
  'function vn(){return',
  'vn=()=>',
  'CLAUDE_CONFIG_DIR??',
]) {
  console.log(n, allHits(n).slice(0, 5))
  for (const i of allHits(n).slice(0, 2)) console.log(ascii(i - 20, i + 150))
}

// copy dir helper near Ne
console.log('\n==== after Ne copy, qt objects ====')
const cp = allHits('async function qt')
console.log('async function qt', cp)
const cp2 = allHits('function qt(e,n')
console.log('function qt(e,n', cp2)
for (const i of cp2.filter(i => i > 210520000 && i < 210560000)) {
  console.log(ascii(i, i + 400))
}

// symlink / cpSync
const link = allHits('async function qt(e,n,t)')
console.log('async function qt(e,n,t)', link)
