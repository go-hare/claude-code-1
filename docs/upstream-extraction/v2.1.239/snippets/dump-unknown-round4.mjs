import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)

function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

function dumpAt(label, i, before = 80, after = 1400) {
  if (i < 0 || i == null) return `\n==== ${label} MISS ====\n`
  return (
    `\n==== ${label} ${i} ====\n` +
    printable(buf.slice(Math.max(0, i - before), i + after).toString('utf8')) +
    '\n'
  )
}

function findAll(needle, max = 12) {
  const hits = []
  let i = 0
  const n = Buffer.from(needle)
  while (hits.length < max) {
    i = buf.indexOf(n, i)
    if (i < 0) break
    hits.push(i)
    i += n.length
  }
  return hits
}

let out = ''
out += dumpAt('gdc keepDotPrefix', buf.indexOf(Buffer.from('keepDotPrefix')))
out += dumpAt('function gdc', buf.indexOf(Buffer.from('async function gdc(')))
out += dumpAt('untitled @313568778', 313568778, 200, 800)
out += dumpAt('untitled @314389869', 314389869, 120, 500)
out += dumpAt('startsWith / @313617404', 313617404, 200, 800)
out += dumpAt('Ldo voice', buf.indexOf(Buffer.from('function Ldo(')))
out += dumpAt('voice?.enabled', buf.indexOf(Buffer.from('voice?.enabled')))

for (const kw of [
  'keepDotPrefix:!0',
  'keepDotPrefix:true',
  'keepDotPrefix:i',
  'i=!0',
  'function Cnt(',
  'Cnt()',
  'org_spend_cap_reached',
  'out_of_credits',
  'Zle=',
  'Zle.has',
  'this session',
  'your name is',
  'listed as',
  'sanitizeSessionTitle',
  'slash title',
  'leading slash',
]) {
  const hits = findAll(kw)
  out += `\n#### ${JSON.stringify(kw)} ${hits.length} [${hits.join(',')}] \n`
  if (hits[0] !== undefined) out += dumpAt(kw, hits[0], 60, 700)
}

writeFileSync(new URL('./gold-unknown-round4.txt', import.meta.url), out)
console.log('ok', out.length)
