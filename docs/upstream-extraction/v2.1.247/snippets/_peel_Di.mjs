import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

const failAt = buf.indexOf(Buffer.from('async failIfHostExited'))
console.log('failIfHostExited at', failAt)

function extractAscii(start, end) {
  let s = ''
  for (let i = start; i < end && i < buf.length; i++) {
    const c = buf[i]
    s += c >= 32 && c <= 126 ? String.fromCharCode(c) : '\n'
  }
  return s
}

const before = extractAscii(failAt - 25000, failAt)
writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-failIfHost-before.txt',
  before,
)

const needles = [
  'async function Di',
  'function Di(',
  'function wi(',
  '==="Z"||',
  '/proc/${',
  '/stat',
  'GetExitCode',
  'STILL_ACTIVE',
  'OpenProcess',
]
for (const n of needles) {
  const i = before.lastIndexOf(n)
  console.log(n, i)
}

// also search whole file for "function wi(" near host
const wi = []
let idx = 0
const needle = Buffer.from('function wi(')
while (true) {
  const j = buf.indexOf(needle, idx)
  if (j < 0) break
  wi.push(j)
  idx = j + 1
}
console.log('function wi( hits', wi)
for (const h of wi.slice(0, 5)) {
  console.log('---', h)
  console.log(extractAscii(h, h + 200))
}
