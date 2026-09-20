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

function hits(n, lim = 12) {
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
  return { start, end: start + 200, text: ascii(start, start + 200) }
}

const needles = [
  'draft product or model-behavior feedback report queue',
  'SendFeedback is not enabled in this session',
  'Feedback draft queued locally (max ',
  'Claude can draft a feedback report',
  'turn off with the feedbackDrafts',
  'function Wfs(',
  'function Rgr(',
  'function LKe(',
  'function _gr(',
  'function bgr(',
  'function FKe(',
  'var FKe=',
  'FKe=',
  'fitFeedbackPayloadToBudget: still',
  'bytes after trim (budget',
  'Draft too large. Shorten the details',
  'feedbackDrafts: draft write failed',
  'namespace:"feedbackDraft"',
  "namespace:'feedbackDraft'",
  'feedbackDraft',
  'failure_mode',
  'task_category',
  'area:',
]

let report = ''
for (const n of needles) {
  const h = hits(n)
  report += `=== ${JSON.stringify(n)} count=${h.length} hits=${h.slice(0, 6).join(',')}\n`
  for (const i of h.slice(0, 3)) {
    report += `--- @${i}\n${ascii(i - 120, i + 280)}\n\n`
  }
}

writeFileSync(`${outDir}/gold-sendfeedback-peel.txt`, report)
console.log('wrote peel', report.length)
