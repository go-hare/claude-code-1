import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)
function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

const needles = [
  'function QV(',
  'registeredName',
  'heldNames',
  'function Rve(',
  'function e3d',
  'a message to yourself',
  'You are sending to yourself',
  'message to yourself',
  'your own name',
  'function lQ(',
  'lQ(',
  'crash dump',
  'no longer exists',
  'Current working directory does not exist',
  'starting directory',
  'The startup directory',
  'cannot access the current',
  'process.cwd()',
  'FEFF',
  'stripBom',
  '\\uFEFF',
  'US-only-inference',
  '1.1',
  'data-residency',
  '15 * 60 * 1000',
  '900000',
  'posix_spawn ENOENT',
  'project root or home',
]

const chunks = []
for (const n of needles) {
  const hits = []
  let from = 0
  const needle = Buffer.from(n)
  while (hits.length < 5) {
    const i = buf.indexOf(needle, from)
    if (i < 0) break
    hits.push(i)
    from = i + needle.length
  }
  chunks.push(`#### ${JSON.stringify(n)} ${hits.length} [${hits.join(', ')}]`)
  for (const i of hits.slice(0, 3)) {
    chunks.push(`\n==== ${n} ${i} ====`)
    chunks.push(printable(buf.slice(Math.max(0, i - 80), i + 650).toString('utf8')))
  }
  chunks.push('')
}

writeFileSync(new URL('./gold-continue5.txt', import.meta.url), chunks.join('\n'))
console.log('wrote gold-continue5.txt')
