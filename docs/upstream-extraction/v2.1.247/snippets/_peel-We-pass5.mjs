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

function findAll(needle, limit = 20) {
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

// _499 full module around b/kdb
dump('gold-We-499-module-210899.txt', `# _499 around b as kdb @210899819\n${asciiWindow(210898200, 210899900)}\n`)

// find function b(){return i(e)} unique?
{
  const hits = findAll('function b(){return i(e)}', 8)
  log(`function b(){return i(e)} count=${hits.length} ${hits.join(',')}`)
  for (const i of hits) {
    const fn = extractFn(i)
    dump(`gold-We-b-${i}.txt`, `# b@${i} end=${fn.end}\n${fn.text}\n`)
    log(`  @${i} ${fn.text}`)
  }
}

// Provider function z before b
{
  const hits = findAll('function z(', 20)
  const near = hits.filter((i) => i > 210897000 && i < 210899900)
  log(`function z( near499 ${near.join(',')}`)
  for (const i of near) {
    const fn = extractFn(i)
    dump(`gold-We-z-provider-${i}.txt`, `# z@${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`)
    log(`  z@${i} len=${fn.end - i} ${fn.text.slice(0, 300)}`)
  }
}

// Ar @208363721 full + neighbors
{
  const i = 208363721
  const fn = extractFn(i)
  dump('gold-Jr-Ar-208363721.txt', `# Ar@${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`)
  dump('gold-Jr-Ar-before-2k.txt', `# Ar@${i} before 2k\n${asciiWindow(i - 2000, fn.end + 200)}\n`)
  log(`Ar len=${fn.end - i} ${fn.text}`)
}

// Se(ne,j) wrapper
{
  const hits = findAll('function Se(', 15)
  const near = hits.filter((i) => i > 208350000 && i < 208364000)
  log(`Se near721 ${near.join(',')}`)
  for (const i of near) {
    const fn = extractFn(i)
    dump(`gold-Jr-Se-${i}.txt`, `# Se@${i}\n${fn.text}\n`)
    log(`  Se@${i} ${fn.text.slice(0, 250)}`)
  }
}

// st() gate near Ar
{
  const hits = findAll('function st(){', 15)
  const near = hits.filter((i) => i > 208350000 && i < 208365000)
  log(`st() near721 ${near.join(',')}`)
  for (const i of near) {
    const fn = extractFn(i)
    log(`  st@${i} ${fn.text}`)
    dump(`gold-Jr-st-${i}.txt`, `# st@${i}\n${fn.text}\n`)
  }
}

// t3 unique dump
{
  const i = 213643845
  const fn = extractFn(i)
  dump('gold-nPe-callees-t3.txt', `# t3@${i} end=${fn.end} UNIQUE count=1\n${fn.text}\n`)
}

// ay Rs dump
{
  const i = 208311609
  const fn = extractFn(i)
  dump(
    'gold-nPe-callees-ay.txt',
    `# ay = nPe import bHc as ay from _705 @212841889
# _705 export Rs as bHc @208321748
# Rs@${i} = updateSettingsForSource value-merge
${fn.text}

# ii@208311653
${extractFn(208311653).text}
`,
  )
}

// nPe body already locked — copy-adjacent callee table
dump(
  'gold-nPe-callees-lock.txt',
  `# nPe callees official-247. Invent-ban. Unique via nPe/Zg strings not name alone.

nPe @213644976 LOCKED (gold-gza-nPe-full.txt)
  ay("userSettings",{pluginConfigs:o},void 0,t)  @213645080 UNIQUE
  Jr().mutate(..., n)                           @213645246
  t3()                                          after catch

ay  LOCKED  updateSettingsForSource (value merge)
  nPe-mod import: bHc as ay from _705 @212841889
  _705 export: Rs as bHc @208321748
  function Rs(e,t,n,r){return ii(e,()=>t,n,r)} @208311609
  same pack as wB=cHc=ii transform form
  gold-nPe-callees-ay.txt

Jr  LOCKED  getSecureStorage getter
  nPe-mod import: xRc as Jr from _721 @212844280
  _721 export: Ar as xRc @208364028
  function Ar(){if(oe)return oe;if(st())return Se(ne,j);return j} @208363721
  j has readAsync/mutate/update/delete (plaintext+keychain)
  mutate(e,t){return w(j,e,t)}  t = credentials handle (nPe 3rd)
  gold-Jr-Ar-208363721.txt

t3  LOCKED  optionValues cache clear
  function t3(){Xn().optionValues.clear()} @213643845 UNIQUE count=1
  also called at end of evi
  gold-nPe-callees-t3.txt
`,
)

dump('gold-We-pass5-scan.txt', report.join('\n') + '\n')
