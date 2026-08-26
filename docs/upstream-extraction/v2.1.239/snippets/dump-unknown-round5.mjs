import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)

function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

function dumpAt(label, i, before = 80, after = 1100) {
  if (i < 0 || i == null) return `\n==== ${label} MISS ====\n`
  return (
    `\n==== ${label} ${i} ====\n` +
    printable(buf.slice(Math.max(0, i - before), i + after).toString('utf8')) +
    '\n'
  )
}

function findAll(needle, max = 10) {
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
for (const off of [
  310729984, 310730301, 310730751, 310731295, 310731441, 310733278, 310737749,
  310739018,
]) {
  out += dumpAt(`Cnt @${off}`, off, 200, 500)
}

for (const kw of [
  'function TLe(',
  'TLe=',
  'startsWith("/")?void 0',
  'e.startsWith("/")',
  'replace(/^\\/+/',
  'Voice mode is now available',
  'Ldo(',
  'voice?.enabled??',
  'spend limit',
  'out of credits',
  'out of extra usage',
  'usage credits exhausted',
]) {
  const hits = findAll(kw)
  out += `\n#### ${JSON.stringify(kw)} ${hits.length} [${hits.join(',')}] \n`
  if (hits[0] !== undefined) out += dumpAt(kw, hits[0], 80, 800)
}

writeFileSync(new URL('./gold-unknown-round5.txt', import.meta.url), out)
console.log('ok', out.length)
