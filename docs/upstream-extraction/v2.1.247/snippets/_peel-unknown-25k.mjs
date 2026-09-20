/**
 * Find Wr/re call sites for marketplace entry sanitizer.
 */
import { readFileSync, writeFileSync } from 'fs'

const b247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function allHits(buf, needle) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (from < buf.length) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

function asciiSlice(buf, start, end) {
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

const needles = [
  'keywords?.map(re)',
  'description,Io)',
  'author.name),email',
  'unprintable plugin name',
  'e.map(ke)',
  'displayName:se(',
]

const lines = []
for (const n of needles) {
  const hits = allHits(b247, n)
  lines.push(`${hits.length} ${JSON.stringify(n)} @${hits}`)
  hits.forEach((i, idx) => {
    writeFileSync(
      `docs/upstream-extraction/v2.1.247/snippets/gold-25-escape-call-${n.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 30)}-${idx}.txt`,
      `# @${i}\n\n${asciiSlice(b247, Math.max(0, i - 400), i + 500)}\n`,
    )
  })
}
writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-25-escape-calls.txt',
  lines.join('\n') + '\n',
)
console.log(lines.join('\n'))
