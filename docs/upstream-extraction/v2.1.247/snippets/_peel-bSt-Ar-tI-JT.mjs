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

function findAll(needle, limit = 16) {
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

function dump(name, i, before, after) {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i}\n\n${asciiWindow(buf, Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', name, i)
}

for (const n of [
  'plugin marketplace remove',
  'function Ar(e,t){',
  'function Ar(e,t){return',
  'class tI',
  'instanceof tI',
  'class ye ',
  'class ye{',
  'function ye(',
]) {
  const hits = findAll(n, 8)
  console.log(n, hits)
  for (const i of hits.slice(0, 4)) {
    console.log(' ', i, asciiWindow(buf, Math.max(0, i - 40), i + 220).replace(/\n/g, ' '))
  }
}

const remove = buf.indexOf(Buffer.from('JT("plugin marketplace remove"'))
console.log('JT call', remove)
if (remove >= 0) dump('gold-dig-JT-call.txt', remove, 80, 200)

// walk back from first Ar(Error(`Marketplace in bSt
const arCall = buf.indexOf(Buffer.from('throw Ar(Error(`Marketplace \''))
console.log('Ar call', arCall)

// find function Ar(e,t){throw or similar near plugin bundle
for (const i of findAll('function Ar(e,t){', 16)) {
  const win = asciiWindow(buf, i, i + 180)
  if (
    win.includes('telemetry') ||
    win.includes('Error') ||
    win.includes('cause') ||
    win.includes('message')
  ) {
    console.log('Ar cand', i, win.replace(/\n/g, ' '))
    dump(`gold-dig-Ar-${i}.txt`, i, 20, 400)
  }
}
