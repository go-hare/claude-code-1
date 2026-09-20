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

for (const n of [
  'function Ok(',
  'function Ok(e)',
  'Ok(t.installLocation)',
  'Ok(n)!==void 0',
]) {
  const hits = findAll(n, 8)
  console.log(n, hits)
  for (const i of hits) {
    console.log(' ', i, asciiWindow(buf, i, i + 220).replace(/\n/g, ' '))
  }
}

const hits = findAll('function Ok(e){', 8)
for (const i of hits) {
  const win = asciiWindow(buf, i, i + 500)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/gold-dig-Ok-${i}.txt`,
    `# offset=${i}\n\n${win}\n`,
  )
  console.log('DUMP', i, win.slice(0, 280))
}
