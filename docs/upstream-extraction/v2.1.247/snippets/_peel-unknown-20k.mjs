import { readFileSync, writeFileSync } from 'fs'

const buf247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const buf246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
)

function asciiWindow(buf, start, end) {
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

function allHits(buf, needle, from = 0, to = buf.length) {
  const n = Buffer.from(needle)
  const hits = []
  let i = from
  while (true) {
    const j = buf.indexOf(n, i)
    if (j < 0 || j >= to) break
    hits.push(j)
    i = j + n.length
    if (hits.length > 40) break
  }
  return hits
}

function dump(name, buf, start, end, extra = '') {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# ${extra}\n# start=${start} end=${end}\n\n${asciiWindow(buf, start, end)}\n`,
  )
  console.log('OK', name, end - start)
}

const timeout = 'get_workspace_diff timed out: the workspace diff is still being computed; retry shortly'
const hits = allHits(buf247, timeout)
console.log('timeout hits', hits)
for (const [idx, pos] of hits.entries()) {
  dump(`gold-20-timeout-hit-${idx}.txt`, buf247, pos - 1500, pos + 300, `timeout hit ${idx}`)
}

// jn module locals
const jnStart = 210624043
const jnCase = 210639111
dump('gold-20-jn-before-case.txt', buf247, jnStart, jnCase, 'full jn module to case')

for (const n of ['var ht=', 'var kt=', 'ht=', 'kt=', 'var bt=', 'var St=']) {
  console.log(
    'jn',
    JSON.stringify(n),
    allHits(buf247, n, jnStart, jnCase + 2000),
  )
}

// _838 ye mmd
const mmd = allHits(buf247, 'export{')
// find module _838
const yeExp = buf247.indexOf(Buffer.from('mmd as ye'))
console.log('mmd as ye import', yeExp)
const exp838 = allHits(buf247, ' as mmd')
console.log('as mmd', exp838)
for (const pos of exp838.slice(0, 5)) {
  dump(
    `gold-20-mmd-${pos}.txt`,
    buf247,
    pos - 800,
    pos + 200,
    'as mmd',
  )
}

// _464 exports $2a Y2a Z2a
for (const n of [' as $2a', ' as Y2a', ' as Z2a', 'export{$2a', '$2a as']) {
  console.log(JSON.stringify(n), allHits(buf247, n).slice(0, 8))
}

// find export list of _464
const exp464 = buf247.indexOf(Buffer.from('$2a as A'))
console.log('$2a as A import site', exp464)
dump('gold-20-464-import.txt', buf247, exp464 - 100, exp464 + 400)

// search export{$2a or $2a as Name} at definition
const defHits = allHits(buf247, 'export{')
// better: find "as $2a" in export
const asDollar = allHits(buf247, 'as $2a')
console.log('as $2a', asDollar)
for (const [idx, pos] of asDollar.entries()) {
  dump(`gold-20-as-dollar2a-${idx}.txt`, buf247, pos - 600, pos + 200)
}

const asY2a = allHits(buf247, 'as Y2a')
console.log('as Y2a', asY2a)
for (const [idx, pos] of asY2a.entries()) {
  dump(`gold-20-as-Y2a-${idx}.txt`, buf247, pos - 800, pos + 200)
}

const asZ2a = allHits(buf247, 'as Z2a')
console.log('as Z2a', asZ2a)
for (const [idx, pos] of asZ2a.entries()) {
  dump(`gold-20-as-Z2a-${idx}.txt`, buf247, pos - 400, pos + 200)
}

// 246 Yt export
dump('gold-20-246-yt-export.txt', buf246, 233208100, 233208300)
dump('gold-20-246-yt-fn.txt', buf246, 233205996, 233208200)

// 246 who imports the 246 export — read export alias first after dump

// S.host in useReplBridge — what is S?
const sHost = buf247.indexOf(Buffer.from('host:S.host,workspaceDiffComputeBudget:Pt'))
console.log('S.host callsite', sHost)
// search let S= or S= nearby backwards in a smaller window
dump('gold-20-S-host-back.txt', buf247, sHost - 25000, sHost - 20000)
