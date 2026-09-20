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

console.log('==== _583 import block around vn ====')
console.log(ascii(210530800, 210532400))

console.log('\n==== _841 export syd ====')
const e841 = allHits(' as syd')
for (const i of e841) console.log(i, ascii(i - 80, i + 20))

// _841 module typically ~2088xxxxx
console.log('\n==== function p in _845 vs _841 ====')
console.log(ascii(206466500, 206466800))

console.log('\n==== all async function qt(e,n ====')
for (const i of allHits('async function qt(e,n')) {
  console.log(i, ascii(i, i + 250))
}

console.log('\n==== function qt(e,n,t) ====')
for (const i of allHits('function qt(e,n,t)')) {
  console.log(i, ascii(i, i + 300))
}

// copy objects helper - symlink recursive
console.log('\n==== cp + junction near 210556 ====')
console.log(ascii(210556200, 210557400))
