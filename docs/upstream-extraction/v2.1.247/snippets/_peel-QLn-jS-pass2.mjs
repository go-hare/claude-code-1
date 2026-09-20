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
  const start = Math.max(0, i - before)
  const text = asciiWindow(buf, start, i + after)
  writeFileSync(`${OUT}/${name}`, `# offset=${i}\n\n${text}\n`)
  console.log('DUMP', name, i, 'len', text.length)
  return text
}

function findAll(needle, limit = 30, from = 0, to = buf.length) {
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

console.log('=== full _716 import around QLn/jS ===')
dump('gold-dig-QLn-716-import.txt', 212843677, 400, 250)

console.log('\n=== wn/Me import cluster ===')
dump('gold-dig-QLn-wn-Me-import.txt', 212846176, 250, 200)

console.log('\n=== marketplace schema JS @207911448 ===')
dump('gold-dig-QLn-schema-207911448.txt', 207911448, 2500, 1500)

console.log('\n=== pluginRoot rewrite @207876150 ===')
dump('gold-dig-jS-pluginRoot-rewrite.txt', 207876150, 800, 400)

console.log('\n=== qQc / rQc bindings ===')
for (const name of ['qQc', 'rQc', 'sQc']) {
  const pats = [
    `function ${name}(`,
    `function ${name}()`,
    `var ${name}=`,
    ` as ${name},`,
    ` as ${name}}`,
    `${name} as `,
    `()=>${name}`,
    `${name}:()=>`,
  ]
  console.log('---', name)
  for (const pat of pats) {
    const hits = findAll(pat, 8)
    for (const i of hits) {
      console.log(pat, i, asciiWindow(buf, i - 50, i + 100).replace(/\n/g, ' '))
    }
  }
}

console.log('\n=== i1c / l1c (wn/Me originals) ===')
for (const name of ['i1c', 'l1c']) {
  const pats = [
    `function ${name}(`,
    `var ${name}=`,
    ` as ${name},`,
    ` as ${name}}`,
    `${name} as `,
    `${name}:()=>`,
  ]
  console.log('---', name)
  for (const pat of pats) {
    const hits = findAll(pat, 10)
    for (const i of hits.slice(0, 6)) {
      console.log(pat, i, asciiWindow(buf, i - 40, i + 90).replace(/\n/g, ' '))
    }
  }
}

console.log('\n=== _716.js module header / export ===')
const m716 = findAll('_716.js', 15)
console.log('_716.js string hits', m716)
for (const i of m716.slice(0, 8)) {
  console.log(i, asciiWindow(buf, i - 30, i + 40))
}

// Find export block that mentions qQc
let from = 0
let n = 0
while (n < 40) {
  const j = buf.indexOf(Buffer.from('export{'), from)
  if (j < 0) break
  const win = asciiWindow(buf, j, j + 800)
  if (win.includes('as qQc') || win.includes('qQc as') || /\bqQc\b/.test(win)) {
    console.log('export-qQc', j, win.slice(0, 400))
    dump('gold-dig-QLn-716-export.txt', j, 80, 900)
    break
  }
  from = j + 7
  n++
}

console.log('\n=== QLn() and jS() call sites (unique) ===')
for (const pat of ['QLn()', 'jS()']) {
  const hits = findAll(pat, 20)
  console.log(pat, hits)
  for (const i of hits) {
    const w = asciiWindow(buf, i - 30, i + 50)
    console.log(' ', i, w.replace(/\n/g, ' '))
  }
}

console.log('\n=== Me(wn()) unique ===')
const mewn = findAll('Me(wn())', 10)
console.log(mewn)
for (const i of mewn) console.log(i, asciiWindow(buf, i - 40, i + 60))
