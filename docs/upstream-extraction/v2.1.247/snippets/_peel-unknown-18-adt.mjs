import { readFileSync, writeFileSync } from 'fs'

const b247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const b246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
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

function dump(name, text) {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    text.endsWith('\n') ? text : `${text}\n`,
  )
  console.log('WROTE', name, text.length)
}

function allHits(buf, needle, max = 20) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (from < buf.length && hits.length < max) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

// Wide dump around ADt / LMt
dump(
  'gold-18-adt-wide-247.txt',
  `# ADt @216242459\n\n${asciiWindow(b247, 216241200, 216244200)}\n`,
)
dump(
  'gold-18-lmt-wide-246.txt',
  `# LMt @214862158\n\n${asciiWindow(b246, 214860900, 214863800)}\n`,
)

const needles = [
  'isAdopted',
  'skipAttachments:!0',
  'skipAttachments',
  'function dT(',
  'function Qv(',
  '?.isAdopted',
  'isAdopted:!0',
  'isAdopted:true',
  'isAdopted:!1',
]

const lines = ['# gold-18-adt-helpers counts', '']
for (const n of needles) {
  const a = allHits(b246, n)
  const b = allHits(b247, n)
  lines.push(
    `${a.length === b.length ? 'same' : 'DIFF'} 246=${a.length} 247=${b.length} ${JSON.stringify(n)} ${JSON.stringify({ a, b })}`,
  )
}
dump('gold-18-adt-helpers-counts.txt', lines.join('\n'))

for (const n of ['isAdopted', 'skipAttachments:!0', '?.isAdopted', 'isAdopted:!0']) {
  for (const [ver, buf] of [
    ['246', b246],
    ['247', b247],
  ]) {
    allHits(buf, n, 12).forEach((i, idx) => {
      dump(
        `gold-18-h-${ver}-${n.replace(/[^A-Za-z0-9]+/g, '-')}-${idx}.txt`,
        `# ver=${ver} offset=${i} needle=${JSON.stringify(n)}\n\n${asciiWindow(buf, i - 800, i + 1200)}\n`,
      )
    })
  }
}
