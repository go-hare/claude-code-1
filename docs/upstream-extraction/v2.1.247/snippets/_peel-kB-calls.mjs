import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
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
  return s.replace(/[.]{4,}/g, '...')
}

function findAllInRange(needle, start, end, limit = 40) {
  const n = Buffer.from(needle)
  const hits = []
  let from = start
  while (hits.length < limit) {
    const i = buf.indexOf(n, from)
    if (i < 0 || i >= end) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

function dump(name, i, before, after) {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i}\n\n${asciiWindow(buf, Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', name, i)
}

const modStart = 212803853
// next Version header after marketplace header
const versionNeedle = Buffer.from('// Version: 2.1.247\nimport{')
const nextHeader = buf.indexOf(versionNeedle, modStart + 10)
console.log('marketplace module', modStart, 'next', nextHeader, 'span', nextHeader - modStart)

const needles = ['kB(', 'kB(s)', 'kB(d.error', 'OSt()', 'OSt(']
for (const n of needles) {
  const hits = findAllInRange(n, modStart, nextHeader > 0 ? nextHeader : modStart + 8_000_000, 30)
  console.log(JSON.stringify(n), hits)
  for (const i of hits) {
    console.log(' ', i, asciiWindow(buf, Math.max(0, i - 50), i + 80).replace(/\n/g, ' '))
  }
}

// dump clean body gold
dump('gold-dig-kB-body.txt', 211619292, 0, 280)

// all Yib as consumers already known; dump n-def uniqueness in _512 only
dump('gold-dig-kB-n-def.txt', 211619292, 80, 320)

// xSt + RBo call sites
dump('gold-dig-kB-xSt-call.txt', 214530178, 40, 80)
const rboKb = buf.indexOf(Buffer.from('kB(d.error.telemetryCode)'), 214541395)
console.log('RBo kB call', rboKb)
if (rboKb >= 0) dump('gold-dig-kB-RBo-call.txt', rboKb, 80, 200)
