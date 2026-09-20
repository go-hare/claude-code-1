import { readFileSync, writeFileSync } from 'fs'

const b247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const b246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
)

function ascii(buf, start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

function hits(buf, n) {
  const nd = Buffer.from(n)
  const o = []
  let f = 0
  while (true) {
    const i = buf.indexOf(nd, f)
    if (i < 0) break
    o.push(i)
    f = i + nd.length
  }
  return o
}

function dump(buf, name, off, before, after) {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${off}\n\n${ascii(buf, Math.max(0, off - before), off + after)}\n`,
  )
  console.log('OK', name, off)
}

const needle = 'hostname!==""'
for (const [ver, buf] of [
  ['247', b247],
  ['246', b246],
]) {
  const h = hits(buf, needle)
  console.log(ver, 'hostname!==""', h.length, h.slice(0, 6).join(','))
}

const hn = hits(b247, needle)
for (let i = 0; i < Math.min(hn.length, 4); i++) {
  dump(b247, `gold-29-host-${i}.txt`, hn[i], 1500, 800)
}

const region = ascii(b247, 232840000, 232870000)
console.log('COe in bash region', region.indexOf('function COe'))
console.log('COe( in bash region', region.indexOf('COe('))
dump(b247, 'gold-3-xOe-helpers.txt', 232849000, 2000, 500)

for (const n of [
  'function COe(e){',
  'function COe(e,t){',
  'COe=e=>',
  'function COe(r)',
]) {
  const h = hits(b247, n)
  console.log(n, h.length, h.slice(0, 6).join(','))
}

let n = 0
let from = 0
const nd = Buffer.from('settings.json')
while (n < 15) {
  const i = b247.indexOf(nd, from)
  if (i < 0) break
  const w = ascii(b247, Math.max(0, i - 500), i + 500)
  if (
    w.includes('isSymbolicLink') ||
    w.includes('lstat') ||
    (w.includes('unlink') && w.includes('function'))
  ) {
    dump(b247, `gold-11-set-${n}.txt`, i, 900, 900)
    n++
  }
  from = i + nd.length
}
console.log('settings+symlink dumps', n)

const dFn = hits(b247, 'function d(a){try{let r=e(a),o=e(u(r))')
console.log('d(a) pathToFileURL', dFn)
if (dFn[0]) dump(b247, 'gold-29-d-full.txt', dFn[0], 400, 800)

for (const n2 of [
  'function e(a)',
  'isAutomount',
  'hasControl',
  'invisible',
  'file://',
]) {
  const a = hits(b246, n2).length
  const b = hits(b247, n2).length
  if (a !== b) console.log('DIFF', n2, a, '->', b)
}
