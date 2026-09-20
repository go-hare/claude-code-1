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

function findAll(needle, limit = 12) {
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
  'function rme(',
  'async function rme(',
  'function Zfe(',
  'async function Zfe(',
  'function WFe(',
  'function Ok(',
  'function fb(',
  'Refusing to load marketplace',
]) {
  const hits = findAll(n, 8)
  console.log(n, hits)
  for (const i of hits) {
    if (n.startsWith('function') || n.startsWith('async')) {
      const win = asciiWindow(buf, i, i + 180)
      console.log(' ', i, win.slice(0, 160).replace(/\n/g, ' '))
    }
  }
}

const refuse = buf.indexOf(Buffer.from("Refusing to load marketplace"))
dump('gold-dig-rme-call.txt', refuse, 80, 200)

const zfeHits = findAll('async function Zfe(', 5)
if (zfeHits[0] != null) dump('gold-dig-Zfe-full.txt', zfeHits[0], 40, 3500)

const rmeHits = findAll('function rme(', 8)
for (const i of rmeHits) {
  const win = asciiWindow(buf, i, i + 400)
  if (win.includes('marketplace') || win.includes('installLocation') || win.includes('source')) {
    dump(`gold-dig-rme-${i}.txt`, i, 20, 1200)
  }
}
