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

const needles = [
  'Wfs=ae(',
  'function Wfs(',
  'var Wfs=',
  'Mgr=',
  'Ogr=',
  'function j_e(',
  'var xgr=',
  'xgr="',
  'SendFeedback',
  'function Fe(',
  'function P(',
  'var F=',
  'var De=',
  'function z(',
  'function Me(',
  'function G(',
  'function ygr(',
  'function hgr(',
  'function UKe(',
  'function Ufs(',
  'function Ns(',
  'function vgr(',
  'function c7(',
  'function zdt(',
  'NE.feedbackNotice',
  'feedbackNotice',
  'Use `failure_mode` ONLY when',
  'Use `task_category` to name',
  'kept ${e.keptMessageCount}',
  'KiB of the raw session log',
]

let report = ''
for (const n of needles) {
  const h = hits(n)
  report += `=== ${JSON.stringify(n)} count=${h.length} hits=${h.slice(0, 6).join(',')}\n`
  for (const i of h.slice(0, 2)) {
    report += `--- @${i}\n${ascii(i - 80, i + 420)}\n\n`
  }
}

// extract Wfs / _gr / Fe / ygr / Ufs / j_e
const named = {
  Wfs: hits('Wfs=ae(')[0],
  _gr: hits('function _gr(')[0],
  Fe: hits('function Fe(e){let s=[];if(e.keptMessageCount')[0],
  ygr: hits('function ygr(')[0],
  hgr: hits('function hgr(')[0],
  UKe: hits('function UKe(')[0],
  Ufs: hits('function Ufs(')[0],
  Ffs: hits('function Ffs(')[0],
  LKe: hits('function LKe(')[0],
  j_e: hits('function j_e(')[0],
  Rgr: hits('function Rgr(')[0],
  bgr: hits('async function bgr(')[0],
  Le: hits('function Le(e,s="panel")')[0],
  Ps: hits('function Ps(')[0],
}

report += '\n===== EXTRACTS =====\n'
for (const [name, i] of Object.entries(named)) {
  report += `\n##### ${name} @${i}\n`
  if (i == null) {
    report += 'MISSING\n'
    continue
  }
  const ex = extractFn(i)
  report += `len=${ex.end - ex.start}\n${ex.text}\n`
}

writeFileSync(`${outDir}/gold-sendfeedback-peel2.txt`, report)
console.log('wrote peel2', report.length)
