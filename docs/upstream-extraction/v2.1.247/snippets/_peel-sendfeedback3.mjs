import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function ascii(start, end) {
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

function hits(n, lim = 8) {
  const nd = Buffer.from(n)
  const o = []
  let f = 0
  while (o.length < lim) {
    const i = buf.indexOf(nd, f)
    if (i < 0) break
    o.push(i)
    f = i + nd.length
  }
  return o
}

function extractFn(start) {
  let i = start
  while (i < buf.length && buf[i] !== 123) i++
  if (i >= buf.length) return { start, end: start, text: '' }
  let depth = 0
  let inS = 0
  let esc = false
  for (; i < buf.length; i++) {
    const c = buf[i]
    if (inS) {
      if (esc) {
        esc = false
        continue
      }
      if (c === 92) {
        esc = true
        continue
      }
      if (c === inS) inS = 0
      continue
    }
    if (c === 34 || c === 39 || c === 96) {
      inS = c
      continue
    }
    if (c === 123) depth++
    else if (c === 125) {
      depth--
      if (depth === 0) {
        return { start, end: i + 1, text: ascii(start, i + 1) }
      }
    }
  }
  return { start, end: start + 400, text: ascii(start, start + 400) }
}

let report = ''

const windows = [
  ['ee-mod', 232013700, 232016200],
  ['Ogr-full', 216531690, 216535700],
  ['enums', 216518800, 216522200],
  ['Ufs-mod', 216527800, 216531400],
  ['Ps-mod', 222029700, 222031200],
  ['Sgr', hits('async function Sgr(')[0], null],
  ['wgr', hits('async function wgr(')[0], null],
  ['zdt', hits('function zdt(')[0] ?? hits('zdt=')[0], null],
  ['vgr', hits('function vgr(')[0] ?? hits('vgr=')[0], null],
  ['Ns-near-Ufs', 216528800, 216529400],
  ['Ms-labels', hits('Amazon Bedrock (Mantle)')[0], null],
  ['Bfs', hits('var Bfs=')[0] ?? hits(',Bfs=')[0], null],
  ['oLt', hits('var oLt=')[0] ?? hits('oLt=')[0], null],
  ['rLt', hits('var rLt=')[0] ?? hits('rLt=[')[0], null],
  ['zKe', hits('var zKe=')[0] ?? hits('zKe=[')[0], null],
  ['HKe', hits('var HKe=')[0] ?? hits('HKe=[')[0], null],
]

for (const [name, a, b] of windows) {
  report += `\n##### ${name} ${a} ${b}\n`
  if (a == null) {
    report += 'MISSING\n'
    continue
  }
  if (b == null) {
    report += extractFn(a).text + '\n'
    continue
  }
  report += ascii(a, b) + '\n'
}

writeFileSync(`${outDir}/gold-sendfeedback-peel3.txt`, report)
console.log('wrote peel3', report.length)
