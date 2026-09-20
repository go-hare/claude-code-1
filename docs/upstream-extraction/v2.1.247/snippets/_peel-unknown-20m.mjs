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
    if (hits.length > 15) break
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

const modStart = 210484000
const modEnd = 210505200

for (const n of [
  'async function Ot(',
  'function Ot(',
  'async function Ot(e',
]) {
  console.log(JSON.stringify(n), allHits(buf247, n, modStart, modEnd))
}

const ot = buf247.indexOf(Buffer.from('async function Ot('), modStart)
const ot2 = buf247.indexOf(Buffer.from('function Ot('), modStart)
console.log({ ot, ot2 })
if (ot > 0 && ot < modEnd) dump('gold-20-ot.txt', ot, ot + 2500, 'Ot')
if (ot2 > 0 && ot2 < modEnd && ot2 !== ot)
  dump('gold-20-ot-sync.txt', ot2, ot2 + 2500, 'Ot sync')

// let S= near useReplBridge
dump('gold-20-let-S-0.txt', 232402452, 232402452 + 400, 'let S 0')
dump('gold-20-let-S-1.txt', 232423586, 232423586 + 800, 'let S 1')

// 247 remaining buildWorkspaceDiffResponse
for (const [idx, pos] of allHits(buf247, 'buildWorkspaceDiffResponse').entries()) {
  dump(`gold-20-bwd-${idx}.txt`, pos - 300, pos + 200, `bwd ${idx} @${pos}`)
}

// what is e in print? look at function that contains host:e.host
dump('gold-20-print-fn.txt', 230540000, 230542000, 'print fn window guess')

// search "host:" in print/useReplBridge more carefully
const hostAssign = allHits(buf247, 'S.host', 232400000, 232470000)
console.log('S.host hits', hostAssign)

// REPL host object: maybe from useAppState or createHost
for (const n of ['S=q(', 'S=Ue(', 'S=ke(', '({host:', 'host:S', 'e.host=']) {
  console.log(JSON.stringify(n), allHits(buf247, n, 232400000, 232470000))
}

// print function signature around 230560000-230575000
const pHost = allHits(buf247, 'host:e.host', 230500000, 230610000)
console.log('host:e.host', pHost)
for (const n of ['async function', 'function Pe(', 'function print']) {
  console.log(
    'print area',
    JSON.stringify(n),
    allHits(buf247, n, 230500000, 230598300).slice(-5),
  )
}
