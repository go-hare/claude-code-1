import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)

function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

function dumpAt(label, i, before = 120, after = 900) {
  if (i < 0 || i == null) return `\n==== ${label} MISS ====\n`
  return (
    `\n==== ${label} ${i} ====\n` +
    printable(buf.slice(Math.max(0, i - before), i + after).toString('utf8')) +
    '\n'
  )
}

function findAll(needle, max = 8) {
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
for (const kw of [
  'function Rew(',
  'extra usage is required',
  'function ALe(',
  'function ELe(',
  'Ldo(e)',
  'Ldo(',
]) {
  const hits = findAll(kw)
  out += `\n#### ${JSON.stringify(kw)} ${hits.length} [${hits.join(',')}] \n`
  for (const h of hits.slice(0, 4)) out += dumpAt(kw, h, 80, 700)
}

out += dumpAt('Ldo caller 316295632', 316295632, 200, 400)
out += dumpAt('Ldo caller 322499528', 322499528, 250, 500)
out += dumpAt('Ldo caller 322499735', 322499735, 250, 500)
out += dumpAt('shouldRetry extra usage', buf.indexOf(Buffer.from('extra usage is required')), 400, 600)

writeFileSync(new URL('./gold-rew.txt', import.meta.url), out)
console.log('ok')
