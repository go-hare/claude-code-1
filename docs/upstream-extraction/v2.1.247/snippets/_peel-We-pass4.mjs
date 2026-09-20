import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function asciiWindow(start, end) {
  let s = ''
  const a = Math.max(0, start)
  const b = Math.min(buf.length, end)
  for (let j = a; j < b; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

function findAll(needle, limit = 30) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (hits.length < limit) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

function extractFn(start) {
  let i = start
  while (i < buf.length && buf[i] !== 123) i++
  if (i >= buf.length) return { start, end: start, text: '' }
  let depth = 0
  let inS = 0
  let esc = false
  for (; i < buf.length; i++) {
    const c = buf[i]
    if (inS) {
      if (esc) {
        esc = false
        continue
      }
      if (c === 92) {
        esc = true
        continue
      }
      if (c === inS) inS = 0
      continue
    }
    if (c === 34 || c === 39 || c === 96) {
      inS = c
      continue
    }
    if (c === 123) depth++
    else if (c === 125) {
      depth--
      if (depth === 0) {
        return { start, end: i + 1, text: asciiWindow(start, i + 1) }
      }
    }
  }
  return { start, end: start + 200, text: asciiWindow(start, start + 200) }
}

function dump(name, content) {
  writeFileSync(`${outDir}/${name}`, content)
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

log('# pass4 kdb/Ar')

// _499.js kdb
for (const n of [
  ' as kdb',
  'kdb as ',
  'B:/~BUN/root/_499.js',
]) {
  const hits = findAll(n, 15)
  log(`${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 10)) {
    log(`  @${i} ${asciiWindow(i - 80, i + 120).replace(/\n/g, ' ')}`)
  }
}

// _721 Ar export neighborhood
dump('gold-Jr-721-export-208364.txt', `# as xRc @208364028\n${asciiWindow(208363700, 208364200)}\n`)

for (const n of [
  'function Ar(){',
  'function Ar(',
  'Ar=()=>',
  'function Ar(){return',
]) {
  const hits = findAll(n, 20)
  log(`${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits) {
    const near721 = i > 208300000 && i < 208370000
    log(`  @${i}${near721 ? ' NEAR721' : ''} ${asciiWindow(i, i + 200).replace(/\n/g, ' ')}`)
    if (near721 || hits.length <= 4) {
      const fn = extractFn(i)
      dump(
        `gold-Jr-Ar-${i}.txt`,
        `# ${n} @${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
      )
    }
  }
}

// functions named like host reader in _499
// find export block of _499
{
  const hits = findAll('_499.js', 8)
  log('_499 path hits ' + hits.join(','))
}

{
  const hits = findAll(' as kdb', 8)
  for (const i of hits) {
    dump(`gold-We-kdb-export-${i}.txt`, `# as kdb @${i}\n${asciiWindow(i - 400, i + 200)}\n`)
    // walk back to function that is exported
    const before = asciiWindow(i - 2000, i)
    log(`kdb-export-before @${i} tail=${before.slice(-400).replace(/\n/g, ' ')}`)
  }
}

// common host-reader shapes
for (const n of [
  'function ke(){return{storageV5',
  'function ke(){',
  'return{storageV5:A.of',
  'return{storageV5:e.of',
  'H().host',
  'H().storageV5',
  '.host).storageV5',
  'storageV5:q.of',
  'storageV5:Q.of',
  'of(H().host)',
  'of(e.host)',
]) {
  const hits = findAll(n, 10)
  log(`HOST2 ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 5)) {
    log(`  @${i} ${asciiWindow(i - 60, i + 140).replace(/\n/g, ' ')}`)
  }
}

// dump _499 module: search export{ near kdb definition
// typical bun: export{ke as kdb
{
  const hits = findAll(' as kdb}', 8).concat(findAll(' as kdb,', 8))
  log('as kdb punct ' + hits.join(','))
}

// look at _499 file start by finding // @bun before an export containing kdb
{
  const exp = buf.indexOf(Buffer.from(' as kdb'))
  log(`first as kdb @${exp}`)
  if (exp > 0) {
    // walk back to export{
    let s = exp
    while (s > exp - 5000 && asciiWindow(s, s + 7) !== 'export{') s--
    dump('gold-We-499-export.txt', `# walk export @${s} kdb@${exp}\n${asciiWindow(s, exp + 80)}\n`)
    log(`499 export walk @${s} ${asciiWindow(s, s + 200)}`)
  }
}

dump('gold-We-pass4-scan.txt', report.join('\n') + '\n')
