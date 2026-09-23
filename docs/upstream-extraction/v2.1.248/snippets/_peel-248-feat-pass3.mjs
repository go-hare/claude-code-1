import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
mkdirSync(outDir, { recursive: true })
const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe',
)

function asciiSlice(src, start, end) {
  let s = ''
  const a = Math.max(0, start)
  const b = Math.min(src.length, end)
  for (let j = a; j < b; j++) {
    const c = src[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

function sha(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

function extractFnAt(src, i, maxLen = 8000) {
  const win = asciiSlice(src, i, i + maxLen)
  const paren = win.indexOf('(')
  if (paren < 0) return { i, missEnd: true }
  let depth = 0
  let inStr = null
  let esc = false
  let closeParen = -1
  for (let p = paren; p < win.length; p++) {
    const c = win[p]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) {
        closeParen = p
        break
      }
    }
  }
  if (closeParen < 0) return { i, missEnd: true, preview: win.slice(0, 220) }
  const bodyStart = win.indexOf('{', closeParen)
  if (bodyStart < 0) return { i, missEnd: true, preview: win.slice(0, 220) }
  depth = 0
  inStr = null
  esc = false
  for (let p = bodyStart; p < win.length; p++) {
    const c = win[p]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        const body = win.slice(0, p + 1)
        return { i, body, sha: sha(body), len: body.length }
      }
    }
  }
  return { i, missEnd: true, preview: win.slice(0, 280) }
}

const lines = [
  '# gold-248-feat-pass3  leftover unique fns',
  `bytes=${buf.length}`,
  `when=${new Date().toISOString()}`,
  '',
]

function dumpFn(label, i, maxLen = 4000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
}

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

const zur = buf.indexOf(Buffer.from('function Zur(){'))
dumpFn('#6 Zur', zur, 800)
const v_ = buf.indexOf(Buffer.from('function v_(){if(a.DISABLE_EXTRA_USAGE_COMMAND)'))
dumpFn('#6 v_', v_, 400)
const dn = buf.indexOf(
  Buffer.from(
    'var DN=new Set(["stripe_subscription","stripe_subscription_contracted","stripe_subscription_enterprise_self_serve","aws_marketplace"',
  ),
)
dumpAround('#6 DN', dn, 20, 420)

const cze = buf.indexOf(Buffer.from('function cZe(e){'))
dumpFn('#4 cZe', cze, 2500)
const ise = buf.indexOf(Buffer.from('function ISe(e={}){'))
dumpFn('#4 ISe', ise, 1500)
const yke = buf.indexOf(Buffer.from('function yKe(){'))
dumpFn('#4 yKe', yke, 800)
const zre = buf.indexOf(Buffer.from('function zre(){'))
dumpFn('#4 zre', zre, 400)

const wf = buf.indexOf(
  Buffer.from('i.includes("workflow")?"present":"missing"'),
)
dumpAround('#5 workflow-present-missing', wf, 250, 80)
// walk back to function
let i = wf
while (i > wf - 2000) {
  const slice = asciiSlice(buf, i, i + 20)
  if (slice.startsWith('function ')) {
    dumpFn('#5 workflow-scope-fn', i, 1500)
    break
  }
  i--
}

const jtt = buf.indexOf(Buffer.from('function jTt('))
dumpFn('#2 jTt agent override', jtt, 1500)

writeFileSync(`${outDir}/gold-248-feat-pass3.txt`, lines.join('\n'))
console.log('WROTE pass3', lines.join('\n').length)
