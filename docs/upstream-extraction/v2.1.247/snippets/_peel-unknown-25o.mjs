import { readFileSync, writeFileSync } from 'fs'

const b247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const b246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
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

function dump(name, buf, i, before, after) {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# @${i}\n\n${asciiSlice(buf, i - before, i + after)}\n`,
  )
}

const aliases = ['sKc', 'vKc', 'oKc', 'pKc', 'qKc', 'rKc', 'uKc', 'wKc']
for (const a of aliases) {
  for (const [label, buf] of [
    ['247', b247],
    ['246', b246],
  ]) {
    const hits = allHits(buf, a + '(')
    console.log(label, `${a}(`, hits.length, hits.slice(0, 12))
    for (const i of hits.slice(0, 4)) {
      dump(`gold-25-escape-${label}-${a}-call-${i}.txt`, buf, i, 80, 180)
    }
  }
}

for (const a of ['sKc', 'vKc']) {
  const hits = allHits(b247, `import{${a}`)
  console.log('import{', a, hits)
  const hits2 = allHits(b247, `as ${a}`)
  console.log('as', a, hits2.slice(0, 8))
}

// import lines containing sKc
for (const n of ['sKc as ', ' as sKc', '{sKc', ',sKc,', ',sKc}']) {
  console.log(JSON.stringify(n), allHits(b247, n).slice(0, 8))
}
