import { createHash } from 'crypto'
import { readFileSync, writeFileSync } from 'fs'

const exe =
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe'
const buf = readFileSync(exe)

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
  if (i < 0) return { miss: true }
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

function lastFnStart(before, names) {
  let best = -1
  let name = ''
  for (const n of names) {
    const needle = Buffer.from(n)
    let i = Math.max(0, before - 4000)
    while (i < before) {
      const k = buf.indexOf(needle, i)
      if (k < 0 || k >= before) break
      if (k > best) {
        best = k
        name = n
      }
      i = k + needle.length
    }
  }
  return { i: best, name }
}

const lines = [
  '# densable 2.1.248 SEA gold extracts (first knife)',
  `bytes=${buf.length}`,
  '',
]

function dumpAround(label, off, before, after) {
  lines.push(`## ${label} @${off}`)
  if (off < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, off - before, off + after))
  lines.push('')
}

function dumpFnNear(label, off, names, maxLen = 6000) {
  const found = lastFnStart(off, names)
  lines.push(`## ${label} near @${off} fn=${found.name || 'MISS'} @${found.i}`)
  if (found.i < 0) {
    lines.push(asciiSlice(buf, off - 200, off + 800))
    lines.push('')
    return
  }
  const ext = extractFnAt(buf, found.i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
}

dumpAround(
  '#1 restricted||= env',
  178178462,
  200,
  900,
)
dumpFnNear(
  '#1 O2 CLAUDE_CODE_RESTRICTED',
  178589387,
  ['function O2(', 'function hp(', 'function Me('],
  2500,
)
dumpAround('#1 O2/hp window', 178589387, 80, 500)
dumpAround(
  '#1 cannot be enforced',
  92346183,
  40,
  400,
)

dumpAround('#2 experimental cacheTtl schema', 184576834, 80, 500)
dumpAround('#2 agentCacheTtlOverride', 185198866, 80, 400)

dumpAround('#3 --client-label parse', 187911322, 80, 400)
dumpAround('#3 env clientLabel', 187904951, 80, 400)
dumpAround('#3 help text', 99558089, 40, 350)

dumpAround(
  '#10 desktopSessionCleanupPeriodDays schema',
  179088656,
  80,
  500,
)
dumpFnNear(
  '#10 Ae() cutoff',
  191903610,
  ['function Ae(', 'function tx('],
  2000,
)
dumpAround('#10 $te keys', 179440961, 40, 350)

dumpAround('#13 Keyless Console', 199068152, 120, 400)

dumpAround(
  '#37 unrecognized crossSessionInbound',
  92447605,
  40,
  280,
)

dumpFnNear(
  '#38 v_() DISABLE_EXTRA_USAGE_COMMAND',
  180726877,
  ['function v_(', 'function U_r('],
  1500,
)
dumpAround('#38 v_() window', 180726877, 40, 350)

dumpAround('#40 workflow-authoring export', 183512380, 80, 250)

dumpFnNear(
  '#47 Oht Anthropic telemetry',
  180153373,
  ['class Oht', 'function '],
  4000,
)
dumpAround('#47 xP prefix', 180153373, 80, 400)

dumpAround('#49 parent reply', 196264366, 200, 400)

dumpAround('#7 ListAgents .248', 181140565, 40, 400)

const out =
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-gold.txt'
writeFileSync(out, lines.join('\n'))
console.log(`WROTE ${out} lines=${lines.length}`)
