import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function asciiWindow(buf, start, end) {
  let s = ''
  const a = Math.max(0, start)
  const b = Math.min(buf.length, end)
  for (let j = a; j < b; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

function findAll(needle, limit = 25) {
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

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

const lo = 212808000
const hi = 214518476

for (const n of [
  ' as Ne,',
  ' as Ne}',
  'function Ne(){',
  'sqd as WLn',
  'function sqd(',
  'async function sqd(',
  'WLn as ',
  'oeb as wle',
  'function oeb',
]) {
  const hits = findAll(n, 20)
  const inMod = hits.filter((i) => i >= lo && i <= hi)
  log(`${JSON.stringify(n)} all=${hits.length} inMod=${inMod.join(',') || '-'} hits=${hits.slice(0, 8).join(',')}`)
  for (const i of [...inMod, ...hits.filter((x) => !inMod.includes(x))].slice(0, 6)) {
    log(`  @${i} ${asciiWindow(buf, i - 40, i + 140).replace(/\n/g, ' ')}`)
  }
}

writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-vSt-Ne-WLn-scan.txt',
  report.join('\n') + '\n',
)
