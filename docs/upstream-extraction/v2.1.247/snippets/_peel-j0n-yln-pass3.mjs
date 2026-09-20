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

function dump(name, content) {
  writeFileSync(`${outDir}/${name}`, content)
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

log('# j0n/yln pass3 export/import bind')

const needles = [
  ' as Fs}',
  ' as Fs,',
  '{Fs as ',
  'Fs as ',
  'function Fs(){',
  'function Fs(){return',
  '_0n as ',
  ' as _0n',
  'ame as ',
  ' as ame',
  'dPe as ',
  ' as dPe',
  'yln as ',
  ' as yln',
  'j0n as ',
  'N0n as ',
  'IR as ',
  'TB as ',
  'export{_0n',
  'export{ame',
  'export{TB',
  'export{IR',
  'export{N0n',
  'export{j0n',
  'export{yln',
  'export{dPe',
]

for (const n of needles) {
  const hits = findAll(n, 15)
  log(`A ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 8)) {
    log(`  @${i} ${asciiWindow(i - 80, i + n.length + 100).replace(/\n/g, ' ')}`)
  }
}

// scan import{ in a wider window before sme @214568775
const sme = 214568775
dump(
  'gold-j0n-sme-before-4k.txt',
  `# sme@${sme} before 4k\n${asciiWindow(sme - 4000, sme + 200)}\n`,
)

// find bun module closer / export after _0n @214579796
const _0n = 214579796
dump(
  'gold-j0n-_0n-after-20k.txt',
  `# _0n@${_0n} after 8k looking for export\n${asciiWindow(_0n, _0n + 8000)}\n`,
)

// search export{ between 214568775 and 214800000
let from = 214568775
const exp = []
while (exp.length < 8) {
  const i = buf.indexOf(Buffer.from('export{'), from)
  if (i < 0 || i > 215200000) break
  exp.push(i)
  from = i + 7
}
log(`EXPORT 214568775-215200000 ${exp.join(',')}`)
for (const i of exp) {
  log(`  @${i} ${asciiWindow(i, i + 500).replace(/\n/g, ' ')}`)
}

// yln/dPe export after dPe
from = 213653071
const exp2 = []
while (exp2.length < 8) {
  const i = buf.indexOf(Buffer.from('export{'), from)
  if (i < 0 || i > 214000000) break
  exp2.push(i)
  from = i + 7
}
log(`EXPORT 213653071-214000000 ${exp2.join(',')}`)
for (const i of exp2) {
  log(`  @${i} ${asciiWindow(i, i + 500).replace(/\n/g, ' ')}`)
}

// gza import of _0n — gza @214549449
dump(
  'gold-j0n-gza-imports.txt',
  `# gza@214549449 before 3k\n${asciiWindow(214549449 - 3000, 214549449)}\n`,
)

dump('gold-j0n-yln-pass3.txt', report.join('\n') + '\n')
