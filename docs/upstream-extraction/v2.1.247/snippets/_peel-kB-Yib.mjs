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

function findAll(needle, limit = 40) {
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

dump('gold-dig-kB-import-Yib.txt', 212810240, 120, 200)

for (const n of [
  ' as Yib}',
  ' as Yib,',
  ',Yib as ',
  '{Yib as ',
  'function Yib(',
  'function Yib(e)',
  'Yib=function',
  'Yib=e=>',
  'B:/~BUN/root/_512.js',
  '_ib as OSt',
  ' as _ib}',
  ' as _ib,',
]) {
  const hits = findAll(n, 20)
  console.log(JSON.stringify(n), hits)
  for (const i of hits.slice(0, 6)) {
    console.log(' ', i, asciiWindow(buf, Math.max(0, i - 60), i + 180).replace(/\n/g, ' '))
  }
}
