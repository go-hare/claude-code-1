import { readFileSync, writeFileSync } from 'fs'

const buf247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
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
    if (hits.length > 20) break
  }
  return hits
}

function dump(name, start, end, extra = '') {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# ${extra}\n# start=${start} end=${end}\n\n${asciiWindow(buf247, start, end)}\n`,
  )
  console.log('OK', name, end - start)
}

const modEnd = 210505101
const modStart = buf247.lastIndexOf(Buffer.from('// Version: 2.1.247'), modEnd)
console.log('_464 module start', modStart)

for (const n of [
  'async function hi(',
  'function hi(',
  'async function gi(',
  'function gi(',
  'async function mi(',
  'function mi(',
  'function mi(e',
]) {
  const hits = allHits(buf247, n, modStart, modEnd + 50)
  console.log(JSON.stringify(n), hits)
}

// also search whole file in case names differ in 247 _464
for (const n of ['async function hi(', 'function gi(', 'function mi(']) {
  console.log('all', JSON.stringify(n), allHits(buf247, n).slice(0, 10))
}

const hi = buf247.indexOf(Buffer.from('async function hi('), modStart)
const gi = buf247.indexOf(Buffer.from('function gi('), modStart)
const giA = buf247.indexOf(Buffer.from('async function gi('), modStart)
const mi = buf247.indexOf(Buffer.from('function mi('), modStart)
console.log({ hi, gi, giA, mi })

if (hi > 0) dump('gold-20-hi.txt', hi, Math.min(hi + 4000, modEnd), 'hi Y2a')
if (gi > 0) dump('gold-20-gi.txt', gi, Math.min(gi + 1500, modEnd), 'gi $2a')
if (giA > 0) dump('gold-20-gi-async.txt', giA, Math.min(giA + 1500, modEnd), 'async gi')
if (mi > 0) dump('gold-20-mi.txt', mi, Math.min(mi + 800, modEnd), 'mi Z2a')

// S.host definition: search backwards from callsite for common patterns
const call = 232466399
for (const n of [
  'let S=',
  'const S=',
  'S=Ue',
  'S=use',
  'host:S.host',
  '.host=',
]) {
  console.log(
    'near useReplBridge',
    JSON.stringify(n),
    allHits(buf247, n, call - 80000, call + 100),
  )
}

// print.ts e.host
const printCall = 230598243
dump('gold-20-print-host.txt', printCall - 3000, printCall + 200, 'print e.host')

// search e.host assignment in print
for (const n of ['e.host', 'host:e.host', 'let e=', 'e={']) {
  console.log(
    'near print',
    JSON.stringify(n),
    allHits(buf247, n, printCall - 30000, printCall + 50).slice(0, 10),
  )
}

// 246 buildWorkspaceDiffResponse callers
const buf246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
)
console.log(
  '246 buildWorkspaceDiffResponse',
  allHits(buf246, 'buildWorkspaceDiffResponse'),
)
console.log(
  '247 buildWorkspaceDiffResponse',
  allHits(buf247, 'buildWorkspaceDiffResponse'),
)
console.log('247 Cf as ki', allHits(buf247, 'Cf as ki'))
