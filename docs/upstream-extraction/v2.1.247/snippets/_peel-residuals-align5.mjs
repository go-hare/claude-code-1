import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'

function ascii(start, end) {
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

function allHits(needle) {
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

writeFileSync(`${outDir}/gold-11-mod-head.txt`, ascii(210360000, 210371000))

for (const n of [
  'as Vm}',
  'as Vm,',
  'as Ji}',
  'as Ji,',
  'as Qi}',
  'as Qi,',
  'Vm as ',
  'Ji as ',
  'Qi as ',
]) {
  const hits = allHits(n).filter(h => h > 210350000 && h < 210380000)
  console.log(JSON.stringify(n), hits)
}

// Whe export from _35.js: Wd as Whe. Find function exported as Wd in that chunk
// Search async function Pi (getRelevantTips) — already have it.
// Confirm Wd === Pi by looking at _35 exports

writeFileSync(
  `${outDir}/gold-2-Pi-full.txt`,
  `# Pi @222293000\n\n${ascii(222292980, 222294400)}\n`,
)
