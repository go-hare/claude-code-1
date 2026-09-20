/**
 * Pass 3: bindHost callers + host object literal + uk() vs screen.session.
 */
import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

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

function asciiWindow(start, end) {
  let s = ''
  const a = Math.max(0, start)
  const z = Math.min(buf.length, end)
  for (let j = a; j < z; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

function dump(name, content) {
  const body = content.endsWith('\n') ? content : `${content}\n`
  writeFileSync(`${outDir}/${name}`, body)
  console.log('WROTE', name, body.length)
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

log(`# peel-8-host-Ghe pass3 size=${buf.length}`)

const needles = [
  '.bindHost(',
  'bindHost({',
  '.bindHost({',
  'turn.bindHost',
  'TurnController',
  'session,theme:',
  'session:e,theme:',
  'theme:t,scope:',
  'xod as uk',
  'tod as ',
  'Li as tod',
  'as tod,',
  'Mm(e){re=e}',
  'function Mm(e){',
  're=e}',
  're=e,',
  'host.session.host',
  '.session.host',
  'S.host',
  'e.session.host',
]
for (const n of needles) {
  const hits = findAll(n, 25)
  log(`STR ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 8)) {
    log(`  @${i} ${asciiWindow(i - 70, i + n.length + 150).replace(/\n/g, ' ')}`)
  }
}

const bindCalls = findAll('.bindHost(', 20)
log(`\n.bindHost( dumps ${bindCalls.length}`)
for (const i of bindCalls) {
  dump(
    `gold-bindHost-call-${i}.txt`,
    `# .bindHost( @${i}\n${asciiWindow(i - 500, i + 600)}\n`,
  )
  log(`  CALL @${i} ${asciiWindow(i - 100, i + 180).replace(/\n/g, ' ')}`)
}

// host object shape: session + theme + setAppState together
const hostShape = [
  'session:e,theme:',
  'session:t,theme:',
  'session:n,theme:',
  'session:r,theme:',
  'session:s,theme:',
  ',theme:t,scope:',
  'storageV5:s,credentials:a',
]
for (const n of hostShape) {
  const hits = findAll(n, 15)
  log(`SHAPE ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits) {
    log(`  @${i} ${asciiWindow(i - 80, i + 200).replace(/\n/g, ' ')}`)
    dump(
      `gold-host-shape-${i}.txt`,
      `# ${n} @${i}\n${asciiWindow(i - 400, i + 500)}\n`,
    )
  }
}

// uk import in TurnController / Ghe module (~2320xxxxx)
const ukImp = findAll('xod as uk', 5)
for (const i of ukImp) {
  dump(`gold-uk-import-${i}.txt`, `# xod as uk @${i}\n${asciiWindow(i - 80, i + 200)}\n`)
}

// tod import (Li session ctor export)
const todImp = findAll('tod as ', 15)
log(`tod as  count=${todImp.length}`)
for (const i of todImp.slice(0, 10)) {
  log(`  @${i} ${asciiWindow(i - 40, i + 80).replace(/\n/g, ' ')}`)
}

dump('gold-8-host-Ghe-scan3.txt', report.join('\n') + '\n')
console.log('DONE pass3', report.length)
