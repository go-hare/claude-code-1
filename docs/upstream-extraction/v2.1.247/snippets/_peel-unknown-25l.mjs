/**
 * Find Wr( and Vr( call sites + export aliases.
 */
import { readFileSync, writeFileSync } from 'fs'

const b247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

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

// dump 8k after Wr definition
writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-25-escape-after-Wr.txt',
  `# after Wr @207953868\n\n${asciiSlice(b247, 207953868, 207962000)}\n`,
)

const needles = [
  'Wr(',
  'Vr(',
  're(e.',
  'Io(e.',
  'At(e.',
  '.map(Wr)',
  '.map(re)',
  'return Wr(',
  'Wr(e)',
  'Wr(t)',
  'Wr(n)',
  'Vr(e)',
  'Vr(t)',
  'Vr(_',
]

for (const n of needles) {
  const hits = allHits(b247, n)
  console.log(hits.length, JSON.stringify(n), hits.slice(0, 12))
}

// export window after Ot
writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-25-escape-export-after-Ot.txt',
  `# around Ot end\n\n${asciiSlice(b247, 207954500, 207956200)}\n`,
)
