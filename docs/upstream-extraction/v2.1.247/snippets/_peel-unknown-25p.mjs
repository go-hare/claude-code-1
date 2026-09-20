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

function dump(name, i, before, after) {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# @${i}\n\n${asciiSlice(buf, i - before, i + after)}\n`,
  )
}

const buf = b247

for (const n of [
  'sKc as ',
  'vKc as ',
  'oKc as ',
  'pKc as ',
  'qKc as ',
  'uKc as ',
  'wKc as ',
]) {
  const hits = allHits(b247, n)
  console.log(hits.length, JSON.stringify(n), hits)
  for (const i of hits) dump(`gold-25-escape-import-${n.trim().replace(/\s/g, '-')}-${i}.txt`, i, 40, 220)
}

// who calls Wr locally in same module after definition - search "return Wr(" in 2079xxxxx-2082xxxxx
for (const n of ['return Wr(', '=Wr(', ' Wr(', ',Wr(', '(Wr(']) {
  const hits = allHits(b247, n).filter((i) => i > 207900000 && i < 209000000)
  console.log(n, hits)
}

// also marketplace plugin object after parse
for (const n of [
  'sanitizeMarketplace',
  'sanitizePlugin',
  'sanitizeDisplay',
  'unprintable plugin name',
]) {
  console.log(JSON.stringify(n), allHits(b247, n))
}
