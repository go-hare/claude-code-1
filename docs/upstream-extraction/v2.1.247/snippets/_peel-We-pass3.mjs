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

function findAll(needle, limit = 50) {
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
    const c = buf[j]
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

// fix typo - use i not j
function extractFn2(start) {
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

log('# pass3')

// as We in plugin-UI band
{
  const hits = findAll(' as We', 50)
  const band = hits.filter((i) => i > 234000000 && i < 236100000)
  log(`as We in 234-236.1M count=${band.length} ${band.join(',')}`)
  for (const i of band) {
    log(`  @${i} ${asciiWindow(i - 80, i + 100).replace(/\n/g, ' ')}`)
  }
  const allNear = hits.filter((i) => i > 230000000 && i < 237000000)
  log(`as We in 230-237M count=${allNear.length}`)
  for (const i of allNear.slice(0, 20)) {
    log(`  @${i} ${asciiWindow(i - 80, i + 100).replace(/\n/g, ' ')}`)
  }
}

// We as export
{
  const hits = findAll('We as ', 40)
  const band = hits.filter((i) => i > 207000000 && i < 212000000)
  log(`We as  in 207-212M count=${band.length}`)
  for (const i of band.slice(0, 15)) {
    log(`  @${i} ${asciiWindow(i - 40, i + 80).replace(/\n/g, ' ')}`)
  }
}

// as Ue near REPL
{
  const hits = findAll(' as Ue', 40)
  const band = hits.filter((i) => i > 230000000 && i < 233000000)
  log(`as Ue in 230-233M count=${band.length}`)
  for (const i of band) {
    log(`  @${i} ${asciiWindow(i - 80, i + 100).replace(/\n/g, ' ')}`)
  }
}

// _721.js: find file, export xRc, getSecureStorage
for (const n of [
  'B:/~BUN/root/_721.js',
  'export{',
  'xRc as ',
  ' as xRc',
  'function g(',
  'getSecureStorage',
]) {
  const hits = findAll(n, 8)
  log(`721 ${JSON.stringify(n)} count=${hits.length} ${hits.slice(0, 5).join(',')}`)
}

// dump around store mutate @208358053
dump('gold-Jr-store-208358.txt', `# @208357800\n${asciiWindow(208357800, 208358400)}\n`)
dump('gold-Jr-store-208354.txt', `# @208353900\n${asciiWindow(208353900, 208355200)}\n`)
dump('gold-Jr-store-208361.txt', `# @208360900\n${asciiWindow(208360900, 208362400)}\n`)

// find _721 module start / export
{
  const hits = findAll('B:/~BUN/root/_721.js', 15)
  for (const i of hits) {
    log(`_721 path @${i} ${asciiWindow(i - 40, i + 80).replace(/\n/g, ' ')}`)
  }
}

// walk back from mutate(e,t){return w(j,e,t)} to function that returns this object
{
  const i = 208358131
  dump('gold-Jr-store-before-4k.txt', `# mutate@${i} before 4k\n${asciiWindow(i - 4000, i + 200)}\n`)
  // find function / return{ that contains this
  const before = asciiWindow(i - 4000, i)
  const fnStarts = [...before.matchAll(/function [A-Za-z0-9_$]+\(/g)]
  log(`store-before fns: ${fnStarts.map((m) => m[0] + '@' + (i - 4000 + m.index)).join(', ')}`)
}

// xRc export search in 208300000-208400000 (secure storage pack)
{
  const hits = findAll('xRc as ', 20)
  log(`xRc as count=${hits.length}`)
  for (const i of hits) {
    log(`  @${i} ${asciiWindow(i - 60, i + 120).replace(/\n/g, ' ')}`)
  }
}
{
  const hits = findAll(' as xRc', 20)
  log(`as xRc count=${hits.length}`)
  for (const i of hits) {
    log(`  @${i} ${asciiWindow(i - 80, i + 80).replace(/\n/g, ' ')}`)
  }
}

// We() assignment in plugin module: var We= / We=
{
  const zg = 236022714
  const win = asciiWindow(zg - 400000, zg)
  const assigns = [...win.matchAll(/[^A-Za-z0-9_$]We=/g)].slice(-10)
  log(`We= in 400k before Zg: ${assigns.map((m) => zg - 400000 + m.index).join(',')}`)
  const vars = [...win.matchAll(/var We[=,]/g)]
  log(`var We in 400k before Zg: ${vars.map((m) => zg - 400000 + m.index).join(',')}`)
  const fns = [...win.matchAll(/function We\(/g)]
  log(`function We( in 400k before Zg: ${fns.map((m) => zg - 400000 + m.index).join(',')}`)
}

// dump plugin-UI module header: first import{ before 235964173 (first We() in plugin UI)
{
  const firstWe = 235964173
  const needle = Buffer.from('import{')
  let last = -1
  let from = firstWe - 600000
  const weImports = []
  while (from < firstWe) {
    const i = buf.indexOf(needle, from)
    if (i < 0 || i >= firstWe) break
    last = i
    const w = asciiWindow(i, Math.min(i + 3000, firstWe))
    if (w.includes(' as We') || w.includes('We as ')) weImports.push(i)
    from = i + 7
  }
  log(`pluginUI last import{ @${last} weImports=${weImports.join(',')}`)
  for (const i of weImports.slice(-8)) {
    const w = asciiWindow(i, i + 2500)
    const m = [...w.matchAll(/[A-Za-z0-9_$]+ as We[,}]/g)]
    log(`  We-imp @${i} ${JSON.stringify(m.map((x) => x[0]))}`)
    dump(`gold-We-import-${i}.txt`, `# @${i}\n${w}\n`)
  }
}

// REPL Ue import
{
  const repl = 232452760
  const needle = Buffer.from('import{')
  let from = repl - 400000
  const ueImports = []
  while (from < repl) {
    const i = buf.indexOf(needle, from)
    if (i < 0 || i >= repl) break
    const w = asciiWindow(i, Math.min(i + 3000, repl))
    if (w.includes(' as Ue')) ueImports.push(i)
    from = i + 7
  }
  log(`REPL Ue imports=${ueImports.join(',')}`)
  for (const i of ueImports.slice(-6)) {
    const w = asciiWindow(i, i + 2000)
    const m = [...w.matchAll(/[A-Za-z0-9_$]+ as Ue[,}]/g)]
    log(`  Ue-imp @${i} ${JSON.stringify(m.map((x) => x[0]))}`)
    dump(`gold-We-Ue-import-${i}.txt`, `# @${i}\n${w}\n`)
  }
}

dump('gold-We-pass3-scan.txt', report.join('\n') + '\n')
