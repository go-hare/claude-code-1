import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)

function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

function dumpAt(label, i, before = 80, after = 1000) {
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
out += dumpAt('iYd STS', buf.indexOf(Buffer.from('function iYd(')))
out += dumpAt('async function iYd', buf.indexOf(Buffer.from('async function iYd(')))
out += dumpAt('chdir 301848844', 301848844, 200, 400)
out += dumpAt('chdir 303198708', 303198708, 200, 400)
out += dumpAt('chdir 313030487', 313030487, 200, 500)
out += dumpAt('NH chdir', buf.indexOf(Buffer.from('function NH(')))

for (const kw of [
  'function iYd(',
  'await iYd()',
  'the teammates on your team',
  'cannot message any session back',
  'this session (',
  'you —',
  ' (you)',
  'is you',
  'your name is',
  'this session is',
  'yourself',
  'sending to yourself',
  "this session's name",
  'Found ',
  'agent(s):',
  'pipe\\\\claude-code',
  '\\\\.\\\\pipe\\\\',
  'function xD(',
  'scheme:"other"',
  'untitled session',
]) {
  const hits = findAll(kw)
  out += `\n#### ${JSON.stringify(kw)} ${hits.length} [${hits.join(',')}] \n`
  const js = hits.find(h => h >= 300_000_000) ?? hits[0]
  if (js !== undefined) out += dumpAt(kw, js, 80, 700)
}

writeFileSync(new URL('./gold-continue2.txt', import.meta.url), out)
console.log('ok', out.length)
