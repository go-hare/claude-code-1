import { readFileSync, writeFileSync } from 'fs'

const b247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'

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

function allHits(buf, needle, from, to) {
  const n = Buffer.from(needle)
  const hits = []
  let i = from
  while (i < to) {
    const j = buf.indexOf(n, i)
    if (j < 0 || j >= to) break
    hits.push(j)
    i = j + n.length
  }
  return hits
}

function dump(name, text) {
  writeFileSync(`${outDir}/${name}`, text.endsWith('\n') ? text : `${text}\n`)
  console.log('WROTE', name, text.length)
}

// Pa convert: 210379646..210412693
// Zt def: 210375224..210375654
const ranges = [
  ['pa', 210379646, 210412693],
  ['pre-pa', 210375224, 210379646],
  ['wide', 210370000, 210440000],
]

const needles = [
  'Zt(',
  'kZ(',
  '.map(Zt)',
  'Zt(e)',
  'p=Zt',
  'Zt(ze',
  'Zt(_',
  'FZ()',
  'yN(',
  'VZ()',
  'ys(p)',
  'denyWrite:ys',
]

const lines = ['# gold-11-unk-calls Zt/kZ/FZ/yN/VZ in sandbox region', '']
for (const [tag, from, to] of ranges) {
  lines.push(`## ${tag} ${from}-${to}`)
  for (const needle of needles) {
    const hits = allHits(b247, needle, from, to)
    lines.push(`  ${JSON.stringify(needle)} ${hits.length} ${hits.slice(0, 12).join(',')}`)
    hits.slice(0, 4).forEach((i, idx) => {
      dump(
        `gold-11-unk-call-${tag}-${needle.replace(/[^A-Za-z0-9]+/g, '-')}-${idx}.txt`,
        `# ${tag} ${JSON.stringify(needle)} @${i}\n\n${asciiWindow(b247, i - 400, i + 600)}\n`,
      )
    })
  }
}
dump('gold-11-unk-calls.txt', lines.join('\n'))
console.log('DONE 11d')
