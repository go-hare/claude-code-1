import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
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

function findAll(needle, limit = 30) {
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

function extractFn(start) {
  let i = start
  while (i < buf.length && buf[i] !== 123) i++
  if (i >= buf.length) return { start, end: start, text: '' }
  let depth = 0
  let inS = 0
  let esc = false
  const begin = start
  for (; i < buf.length; i++) {
    const c = buf[i]
    if (inS) {
      if (esc) {
        esc = false
        continue
      }
      if (c === 92) {
        esc = true
        continue
      }
      if (c === inS) inS = 0
      continue
    }
    if (c === 34 || c === 39 || c === 96) {
      inS = c
      continue
    }
    if (c === 123) depth++
    else if (c === 125) {
      depth--
      if (depth === 0) {
        const end = i + 1
        return { start: begin, end, text: asciiWindow(buf, begin, end) }
      }
    }
  }
  return { start: begin, end: begin + 200, text: asciiWindow(buf, begin, begin + 200) }
}

function dump(name, content) {
  writeFileSync(`${outDir}/${name}`, content)
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

log('# vSt qfe/J8 peel')

dump(
  'gold-vSt-import-212808024.txt',
  `# Feb as qfe / Oeb as J8 @212808024\n${asciiWindow(buf, 212807900, 212809000)}\n`,
)

dump(
  'gold-vSt-fs-import.txt',
  `# fs/path import immediately before vSt\n${asciiWindow(buf, 214518250, 214518476)}\n`,
)

for (const n of [
  'Feb as qfe',
  'Oeb as J8',
  'function Feb(',
  'var Feb=',
  'Feb=',
  'Feb=".gcs-sha"',
  'ih as Feb',
  'Feb as ',
  'function Oeb(',
  'var Oeb=',
  'Oeb=',
  'Oeb as ',
  'function J8(e)',
  'J8(e,t)',
  'function ch(',
  'marketplaceCache',
  'sqd as WLn',
  'oeb as wle',
  'js as Z5',
  'ble as v1',
]) {
  const hits = findAll(n, 15)
  log(`X ${JSON.stringify(n)} count=${hits.length} hits=${hits.slice(0, 10).join(',')}`)
  for (const i of hits.slice(0, 5)) {
    log(`  @${i} ${asciiWindow(buf, i - 70, i + 160).replace(/\n/g, ' ')}`)
  }
}

// Feb / Oeb defs
for (const [label, needle] of [
  ['Feb', 'function Feb('],
  ['Feb-async', 'async function Feb('],
  ['Oeb', 'function Oeb('],
  ['Oeb-async', 'async function Oeb('],
]) {
  const hits = findAll(needle, 8)
  for (const [idx, i] of hits.entries()) {
    const fn = extractFn(i)
    dump(
      `gold-vSt-${label}-${idx}-${i}.txt`,
      `# ${needle} pos=${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
    )
    log(`DUMP ${label} @${i} len=${fn.end - i}`)
  }
}

// ih export
for (const n of ['ih as Feb', 'ih as qfe', 'ih as ', 'export{ih', ',ih,', 'ih=".gcs-sha"']) {
  const hits = findAll(n, 12)
  log(`IH ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 6)) {
    log(`  @${i} ${asciiWindow(buf, i - 50, i + 80).replace(/\n/g, ' ')}`)
  }
}

// Z5/J5 used by vSt — zip pair at 213632413
dump(
  'gold-vSt-Z5-213632413.txt',
  `# Z5 unzip @213632413\n${asciiWindow(buf, 213632413, 213633400)}\n`,
)

dump('gold-vSt-qfe-J8-scan.txt', report.join('\n') + '\n')
