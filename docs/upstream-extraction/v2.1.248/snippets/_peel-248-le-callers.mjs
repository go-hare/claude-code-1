import { readFileSync, writeFileSync } from 'fs'

const b = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe',
)
const out = []

// Search for calls to le( - look for distinctive neighbor strings
for (const s of [
  'await le(',
  'void le(',
  'le(o,',
  'le(O(),',
  'le(t,',
  'le(n,',
  'le(i,',
  'le(s,',
  'le(d,',
  'return le(',
]) {
  const n = Buffer.from(s)
  let i = 0
  let c = 0
  while ((i = b.indexOf(n, i)) !== -1 && c < 12) {
    if (i > 200000000 && i < 210000000) {
      out.push(`\n## ${s} @${i}`)
      out.push(b.slice(i - 180, i + 220).toString('utf8'))
    }
    i++
    c++
  }
}

// inr/snr callers - who triggers restart message + le
for (const s of ['inr(', 'snr(', 'await le', 'kn(0,"other"']) {
  const n = Buffer.from(s)
  let i = 0
  let c = 0
  while ((i = b.indexOf(n, i)) !== -1 && c < 8) {
    if (i > 205000000 && i < 206000000) {
      out.push(`\n## near ${s} @${i}`)
      out.push(b.slice(i - 100, i + 150).toString('utf8'))
    }
    i++
    c++
  }
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-le-callers.txt',
  out.join('\n'),
)
console.log('lines', out.length)
