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

function findAll(needle, limit = 40) {
  const n = typeof needle === 'string' ? Buffer.from(needle) : needle
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

log('# We/Jr pass2')

// Walk back from Zg to module import header
const zg = 236022714
for (const back of [20000, 80000, 200000, 500000]) {
  const win = asciiWindow(zg - back, zg - back + 4000)
  const hasImport = win.includes('import{') || win.includes(' as We')
  log(`ZG-BACK ${back} hasImport=${hasImport} head=${win.slice(0, 120).replace(/\n/g, ' ')}`)
}

// Find last import{ before Zg
{
  const needle = Buffer.from('import{')
  let last = -1
  let from = zg - 800000
  while (from < zg) {
    const i = buf.indexOf(needle, from)
    if (i < 0 || i >= zg) break
    last = i
    from = i + 7
  }
  log(`ZG last import{ @${last}`)
  if (last > 0) {
    dump('gold-We-Zg-mod-imports.txt', `# last import{ before Zg @${last}\n${asciiWindow(last, last + 12000)}\n`)
    const win = asciiWindow(last, last + 12000)
    const we = [...win.matchAll(/[A-Za-z0-9_$]+ as We[,}]/g)]
    log(`ZG import as We: ${JSON.stringify(we.map((m) => m[0]))}`)
  }
}

// }=We() all
for (const n of ['}=We()', '}=Ue()', '}=Oe()', '}=Ce()', '}=Sr()', '}=j()', '}=Te()']) {
  const hits = findAll(n, 15)
  log(`READER ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 8)) {
    log(`  @${i} ${asciiWindow(i - 80, i + 80).replace(/\n/g, ' ')}`)
  }
}

// 0-arg return {storageV5 ... credentials
for (const n of [
  'return{storageV5:',
  'return{storageV5:t',
  'return{storageV5:n',
  'return{storageV5:e',
  'storageV5:t.of',
  'storageV5:n.of',
  'storageV5:e.of',
  'credentials:t.of',
  'credentials:n.of',
  'credentials:e.of',
  '.of(e).storageV5',
  'storageV5:this.',
]) {
  const hits = findAll(n, 12)
  log(`BODY ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 5)) {
    log(`  @${i} ${asciiWindow(i - 100, i + 160).replace(/\n/g, ' ')}`)
  }
}

// nPe module: last import{ before nPe, search as Jr
const nPe = 213644976
{
  const needle = Buffer.from('import{')
  let last = -1
  let from = nPe - 900000
  const jrHits = []
  while (from < nPe) {
    const i = buf.indexOf(needle, from)
    if (i < 0 || i >= nPe) break
    last = i
    const win = asciiWindow(i, Math.min(i + 8000, nPe))
    if (win.includes(' as Jr') || win.includes('as Jr,')) jrHits.push(i)
    from = i + 7
  }
  log(`nPe last import{ @${last} jrImportHits=${jrHits.join(',')}`)
  for (const i of jrHits.slice(-6)) {
    const win = asciiWindow(i, i + 4000)
    const m = [...win.matchAll(/[A-Za-z0-9_$]+ as Jr[,}]/g)]
    log(`  Jr-import @${i} ${JSON.stringify(m.map((x) => x[0]))} ${asciiWindow(i, i + 200).replace(/\n/g, ' ')}`)
    dump(`gold-Jr-import-${i}.txt`, `# import @${i}\n${win}\n`)
  }
}

// also search ` as Jr` in 212800000-213650000
{
  const hits = findAll(' as Jr', 40)
  const near = hits.filter((i) => i > 212000000 && i < 214000000)
  log(`as Jr near nPe-mod count=${near.length} allNear=${near.join(',')}`)
  for (const i of near) {
    log(`  @${i} ${asciiWindow(i - 80, i + 80).replace(/\n/g, ' ')}`)
  }
}

// getSecureStorage / mutate definition
for (const n of [
  'function getSecureStorage',
  'getSecureStorage',
  '.mutate=async',
  'mutate(e,t){',
  'async mutate(',
  'readAsync(e){',
  'async readAsync(',
  'pluginSecrets',
]) {
  const hits = findAll(n, 8)
  log(`SEC ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 4)) {
    log(`  @${i} ${asciiWindow(i - 40, i + 140).replace(/\n/g, ' ')}`)
  }
}

// WeakMap host bags for storage/credentials
for (const n of [
  'class Xt{',
  'storageV5=void 0',
  'this.storageV5',
  'credentials=void 0',
  'this.credentials',
  'new WeakMap',
  'new ye(()=>',
]) {
  const hits = findAll(n, 12)
  log(`WM ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 5)) {
    const win = asciiWindow(i, i + 180)
    if (
      win.includes('storageV5') ||
      win.includes('credentials') ||
      n === 'class Xt{' ||
      n === 'storageV5=void 0'
    ) {
      log(`  @${i} ${win.replace(/\n/g, ' ')}`)
    }
  }
}

// CLI pin window + REPL Ue
dump('gold-We-cli-pin-206274.txt', `# @206274000\n${asciiWindow(206273800, 206276800)}\n`)
dump('gold-We-cli-pin-206267.txt', `# @206267000\n${asciiWindow(206266900, 206268400)}\n`)
dump('gold-We-repl-Ue-232452.txt', `# @232452700\n${asciiWindow(232452400, 232453400)}\n`)

// X/ce credentialsStoreFor full
{
  const i = 210986780
  dump('gold-Jr-X-ce-210986.txt', `# @${i}\n${asciiWindow(i, i + 800)}\n`)
  log(`X/ce @${i} ${asciiWindow(i, i + 400)}`)
}

// ay confirm Rs
dump(
  'gold-nPe-callees-ay-Rs.txt',
  `# ay = bHc as ay from _705 @212841889
# _705 export Rs as bHc @208321748
# body Rs@208311609
${extractFn(208311609).text}
`,
)

dump('gold-We-pass2-scan.txt', report.join('\n') + '\n')
