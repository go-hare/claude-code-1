import { readFileSync, writeFileSync } from 'fs'

const b247 = readFileSync(
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

function allHits(needle) {
  const n = Buffer.from(needle)
  const hits = []
  let i = 0
  while (true) {
    const j = b247.indexOf(n, i)
    if (j < 0) break
    hits.push(j)
    i = j + n.length
  }
  return hits
}

const needles = [
  'as Ae}',
  'as Ae,',
  '{Ae as',
  ',Ae,',
  'Ae as ',
  'as Ie}',
  'as Ie,',
  '{Ie as',
  'function Ae(){',
  'function Ie(){',
  'export{Ae',
  'export{Ie',
]

for (const n of needles) {
  const hits = allHits(n)
  console.log(hits.length, JSON.stringify(n), hits.slice(0, 6))
}

// dump Onboarding file start: 20000 before Yo
const yo = b247.indexOf(Buffer.from('function Yo({host:i,onDone:s})'))
writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-22-yo-filehead.txt',
  `# yo=${yo}\n\n${asciiWindow(b247, Math.max(0, yo - 20000), yo + 80)}\n`,
)
console.log('wrote yo-filehead', yo)
