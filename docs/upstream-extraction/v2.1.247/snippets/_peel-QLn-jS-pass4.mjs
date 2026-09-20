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
  const text = asciiWindow(buf, Math.max(0, i - before), i + after)
  writeFileSync(`${OUT}/${name}`, `# offset=${i}\n\n${text}\n`)
  console.log('DUMP', name, i, 'len', text.length)
  return text
}

function findAll(needle, limit = 20, from = 0, to = buf.length) {
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

dump('gold-dig-jS-ho-body.txt', 207874075, 20, 1800)
dump('gold-dig-jS-Mo-cluster.txt', 207875596, 20, 900)

console.log('\n=== _716 module start before ho ===')
const ho = 207874075
const buns = findAll('// @bun @bytecode', 15, 207760000, ho)
console.log('bun before ho', buns)
const lastBun = buns[buns.length - 1]
if (lastBun) dump('gold-dig-QLn-716-realhead.txt', lastBun, 40, 3500)

console.log('\n=== as B in 20780-20788 ===')
for (const pat of [' as B,', ' as B}', 'B as ', 'var B=', 'B=p(', 'B=Zt', 'B=vc']) {
  const hits = findAll(pat, 12, 207800000, 207916000)
  console.log(pat, hits)
  for (const i of hits.slice(0, 4)) {
    console.log(' ', i, asciiWindow(buf, i - 50, i + 40).replace(/\n/g, ' '))
  }
}

console.log('\n=== _750 Zt/vc/_c/gc cluster ===')
dump('gold-dig-QLn-750-Zt-vc.txt', 206662539, 80, 500)

for (const name of ['_c', 'gc', 'xc', 'Tn(', 'Nn(', 'En(']) {
  const hits = findAll(name === 'Tn(' || name === 'Nn(' || name === 'En(' ? `function ${name[0]}n(` : `var ${name}=`, 6, 206500000, 206700000)
  console.log(name, hits)
}

console.log('\n=== _c / gc defs ===')
for (const pat of [
  'var _c=',
  '_c={',
  'gc={',
  'var gc=',
  'function Tn(',
  'function Nn(',
  'type:"unknown"',
  'type:"any"',
  'type:"array"',
]) {
  const hits = findAll(pat, 8, 206600000, 206680000)
  console.log(pat, hits)
  for (const i of hits.slice(0, 2)) {
    console.log(' ', i, asciiWindow(buf, i, i + 140).replace(/\n/g, ' '))
  }
}

console.log('\n=== p / te / d / f / i / x / M in _716 imports ===')
// after real module head
if (lastBun) {
  const head = asciiWindow(buf, lastBun, lastBun + 8000)
  for (const name of [' as p,', ' as p}', ' as te,', ' as te}', ' as d,', ' as f,', ' as i,', ' as x,', ' as B,', ' as M,']) {
    const i = head.indexOf(name)
    if (i >= 0) console.log(name, head.slice(Math.max(0, i - 70), i + 30))
  }
}

console.log('\n=== Qt() marketplace name schema ===')
for (const pat of ['Qt=p(', 'function Qt(', 'Qt=e(()', 'name:Qt()']) {
  const hits = findAll(pat, 6, 207800000, 207920000)
  console.log(pat, hits)
  if (hits[0]) console.log(' ', asciiWindow(buf, hits[0], hits[0] + 250).replace(/\n/g, ' '))
}
