import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function extractJsRuns(start, end, minLen = 40) {
  const runs = []
  let cur = ''
  let curStart = 0
  for (let i = start; i < end && i < buf.length; i++) {
    const c = buf[i]
    if (c >= 32 && c <= 126) {
      if (!cur) curStart = i
      cur += String.fromCharCode(c)
    } else {
      if (cur.length >= minLen) runs.push({ start: curStart, s: cur })
      cur = ''
    }
  }
  if (cur.length >= minLen) runs.push({ start: curStart, s: cur })
  return runs
}

function findAll(needle) {
  const n = Buffer.from(needle)
  const hits = []
  let i = 0
  while (true) {
    const j = buf.indexOf(n, i)
    if (j < 0) break
    hits.push(j)
    i = j + n.length
  }
  return hits
}

const needles = [
  'failIfHostExited',
  'hostExited',
  'HostExited',
  'ehostdead',
  'job_attach_host_dead',
  'terminal host process died',
  'press Enter to restart',
  'conversation is saved',
]

for (const n of needles) {
  console.log(n, findAll(n))
}

const failHits = findAll('failIfHostExited')
for (const h of failHits) {
  const runs = extractJsRuns(h - 6000, h + 8000, 50)
  let out = `# failIfHostExited @ ${h}\n\n`
  for (const r of runs) {
    if (
      /failIfHost|EHOSTDEAD|ehostdead|host process|hostExited|function |async |detail|patch|settle|exec|attach|pid|kill/.test(
        r.s,
      )
    ) {
      out += `\n----- ${r.start} len=${r.s.length} -----\n${r.s}\n`
    }
  }
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/gold-failIfHost-${h}.txt`,
    out,
  )
  console.log('wrote failIfHost', h, out.length)
}

// also search nearby "HostExited" camel variants in minified
const more = ['IfHost', 'hostPid', 'hostDied', 'host_dead', 'hostDead']
for (const n of more) console.log(n, findAll(n).slice(0, 10))
