import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function findAll(needle) {
  const n = Buffer.from(needle)
  const hits = []
  let i = 0
  while (true) {
    const j = buf.indexOf(n, i)
    if (j < 0) break
    hits.push(j)
    i = j + n.length
  }
  return hits
}

function asciiAround(off, before = 400, after = 800) {
  let s = ''
  const start = Math.max(0, off - before)
  const end = Math.min(buf.length, off + after)
  for (let i = start; i < end; i++) {
    const c = buf[i]
    s += c >= 32 && c <= 126 ? String.fromCharCode(c) : '.'
  }
  return s
}

const needles = [
  'tengu_bg_ptyhost_zombie',
  'has exited but is unreaped',
  '==="Z"',
  '==="X"',
  '/proc/',
  'GetExitCodeProcess',
  'STILL_ACTIVE',
  'pty host pid=',
]

let out = '# Di/wi peel\n\n'
for (const n of needles) {
  const hits = findAll(n)
  out += `## ${JSON.stringify(n)} hits=${hits.length} ${hits.slice(0, 8).join(',')}\n`
  for (const h of hits.slice(0, 3)) {
    out += `\n----- ${h} -----\n${asciiAround(h)}\n`
  }
  out += '\n'
}

writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-procstate.txt',
  out,
)
console.log(out.slice(0, 4000))
console.log('wrote gold-procstate.txt', out.length)
