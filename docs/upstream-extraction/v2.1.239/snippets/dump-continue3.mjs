import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)

function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

function dumpAt(label, i, before = 60, after = 1100) {
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
  'function NMt(',
  'async function NMt(',
  'function LMt(',
  'function Gmt(',
  'function qY(',
  'kind:"main"',
  'kind:"teammate"',
  'function GCe(',
  'var dL=',
  'dL=',
  'sending to this session',
  'that is you',
  'this is you',
  'you are this',
  'cannot SendMessage to yourself',
  'to yourself',
  'var iYb=',
  'var sYb=',
  'var aYb=',
  'iYb=',
  'sYb=',
  'aYb=',
]) {
  const hits = findAll(kw)
  out += `\n#### ${JSON.stringify(kw)} ${hits.length} [${hits.join(',')}] \n`
  const js = hits.find(h => h >= 300_000_000) ?? hits[0]
  if (js !== undefined) out += dumpAt(kw, js, 80, 900)
}

writeFileSync(new URL('./gold-continue3.txt', import.meta.url), out)
console.log('ok', out.length)
