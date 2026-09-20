import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function asciiWindow(start, end) {
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

function findAll(needle, limit = 20) {
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

log('# HP/pendingUsage pass6 — dm(f.pluginInfo.repository) bind')

for (const n of [
  'dm(f.pluginInfo.repository)',
  'dm(s.pluginInfo.repository)',
  'dm(p.pluginInfo.repository)',
  'dm(e.pluginInfo.repository)',
  'pluginInfo)dm(',
  'pluginInfo)qe(',
  'B_(e.pluginInfo.repository',
  'B_(f.pluginInfo.repository',
  'Y$ as dm',
  ' as dm}from"B:/~BUN/root/_448.js"',
  'dm as Y$',
]) {
  const hits = findAll(n, 10)
  log(`${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits) {
    log(`  @${i} ${asciiWindow(i - 120, i + n.length + 80).replace(/\n/g, ' ')}`)
  }
}

// module header before 216056716
const bun = Buffer.from('// @bun')
let last = -1
let from = 215000000
while (from < 216056716) {
  const i = buf.indexOf(bun, from)
  if (i < 0 || i > 216056716) break
  last = i
  from = i + 4
}
log(`bun-header before dm(f.pluginInfo @216056716 last=${last} dist=${216056716 - last}`)
if (last > 0) {
  log(`header@${last} ${asciiWindow(last, last + 800).replace(/\n/g, ' ')}`)
  writeFileSync(
    `${outDir}/gold-HP-dm-f-pluginInfo-mod.txt`,
    `# bun@${last} call@216056716\n${asciiWindow(last, last + 2500)}\n`,
  )
}

// imports containing dm near that module
const win = asciiWindow(last > 0 ? last : 216050000, 216056716)
let idx = 0
const imps = []
while (true) {
  const j = win.indexOf('import{', idx)
  if (j < 0) break
  imps.push((last > 0 ? last : 216050000) + j)
  idx = j + 7
}
log(`imports before call count=${imps.length}`)
for (const i of imps.slice(0, 20)) {
  const line = asciiWindow(i, i + 350)
  if (line.includes('dm') || line.includes('Y$') || line.includes('_448')) {
    log(`  IMP@${i} ${line.replace(/\n/g, ' ')}`)
  }
}

writeFileSync(`${outDir}/gold-HP-pendingUsage-pass6.txt`, report.join('\n') + '\n')
log('WROTE gold-HP-pendingUsage-pass6.txt')
