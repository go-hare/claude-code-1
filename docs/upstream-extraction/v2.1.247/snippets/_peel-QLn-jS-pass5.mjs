import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

const OUT = 'docs/upstream-extraction/v2.1.247/snippets'

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

function dump(name, i, before, after) {
  writeFileSync(
    `${OUT}/${name}`,
    `# offset=${i}\n\n${asciiWindow(buf, Math.max(0, i - before), i + after)}\n`,
  )
  console.log('DUMP', name, i)
}

function findAll(needle, limit = 8, from = 0, to = buf.length) {
  const n = Buffer.from(needle)
  const hits = []
  let i = from
  while (hits.length < limit) {
    const j = buf.indexOf(n, i)
    if (j < 0 || j > to) break
    hits.push(j)
    i = j + n.length
  }
  return hits
}

console.log('=== D1c / Eu preprocess ===')
const d1c = findAll('Eu as D1c', 4)
console.log('Eu as D1c', d1c)
for (const pat of ['function Eu(', 'Eu=p(', 'function Eu(e,t)', 'Eu=(e,t)']) {
  const hits = findAll(pat, 6, 206600000, 206680000)
  console.log(pat, hits)
  for (const i of hits) console.log(' ', asciiWindow(buf, i, i + 180).replace(/\n/g, ' '))
}

console.log('\n=== Hid lazy p ===')
for (const pat of ['function Hid(', 'Hid=', 'export{Hid']) {
  const hits = findAll(pat, 4)
  console.log(pat, hits)
}

console.log('\n=== Qt marketplace name ===')
dump('gold-dig-QLn-Qt-name.txt', 207878371, 20, 700)

console.log('\n=== _716 zod import line ===')
const zodImp = buf.indexOf(
  Buffer.from('i1c as B,l1c as f,n1c as d'),
  207830000,
)
console.log('zodImp', zodImp)
if (zodImp > 0) dump('gold-dig-QLn-716-zod-import.txt', zodImp, 180, 80)

console.log('\n=== confirm te is preprocess via D1c body / usage ===')
const teUse = findAll('te(Mo,Io())', 4)
console.log('te(Mo,Io())', teUse)

const pre = findAll('type:"preprocess"', 6, 206600000, 206680000)
console.log('type preprocess', pre)
for (const i of pre) console.log(asciiWindow(buf, i - 80, i + 80))

console.log('\n=== p lazy from _830 ===')
const hid = findAll('Hid as p', 6, 207830000, 207850000)
console.log(hid)
