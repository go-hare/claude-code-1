import { readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const b247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function asciiSlice(buf, start, end) {
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
  return s
}

function sha(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

function allHits(buf, needle) {
  const n = Buffer.from(needle)
  const hits = []
  let i = 0
  while (i < buf.length) {
    const k = buf.indexOf(n, i)
    if (k < 0) break
    hits.push(k)
    i = k + n.length
  }
  return hits
}

function extractFnAt(buf, i, maxLen = 8000) {
  if (i < 0) return { miss: true }
  const win = asciiSlice(buf, i, i + maxLen)
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
    let i = 0
    while (i < before) {
      const k = b247.indexOf(needle, i)
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

const lines = ['# gold-1-ye-Ht-Jt-DE-pass2 247', '']

function dumpHits(label, needle, around = 100, cap = 12) {
  const hits = allHits(b247, needle)
  lines.push(`## ${label} hits=${hits.length}`)
  for (const [idx, i] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${idx} @${i} ${asciiSlice(b247, i - around, i + needle.length + around)}`,
    )
  }
  lines.push('')
  return hits
}

function dumpFn(label, i, maxLen = 4000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(b247, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
  return ext
}

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(b247, i - before, i + after))
  lines.push('')
}

function dumpFnContaining(label, needle, maxLookback = 2500, maxLen = 5000) {
  const hits = allHits(b247, needle)
  lines.push(`## ${label} containing "${needle}" hits=${hits.length}`)
  for (const [idx, i] of hits.slice(0, 8).entries()) {
    const found = lastFnStart(i + 1, [
      'function ',
      'async function ',
    ])
    lines.push(`- #${idx} @${i} lastFn=${found.name}@${found.i}`)
    dumpAround(`${label}#${idx}-win`, i, 200, 200)
    if (found.i >= 0 && i - found.i < maxLookback) {
      dumpFn(`${label}#${idx}-fn`, found.i, maxLen)
    }
  }
  lines.push('')
}

// ye-like filters
dumpFnContaining('sidechain-2216', 'n.isSidechain===!0||n.isMeta===!0')
dumpFnContaining(
  'sidechain-2220',
  'e.isSidechain===!0||!e.message)continue;if(u.has(e.uuid)',
)
dumpFnContaining(
  'sidechain-2320',
  't.isSidechain===!0||!t.message)continue;s.push(t.type==="user"',
)

dumpHits('function kb(e){let', 'function kb(e){let')
dumpHits('function kb(e){return', 'function kb(e){return')
dumpHits('kb=function', 'kb=function')
dumpHits('var kb=', 'var kb=')
dumpHits('kb=e=>', 'kb=e=>')
dumpHits('isCompactSummary===!0&&{isCompactSummary', 'isCompactSummary===!0&&{isCompactSummary')

// leftover barrel: who exports kb into _448
dumpAround('kb-as-xSa-import-back', 219710851, 2500, 80)
dumpHits('from chunk near kb', 'kb as xSa')
dumpHits('export{kb,', 'export{kb,')
dumpHits(' kb as ', ' kb as ')
dumpHits('as kb,', 'as kb,')
dumpHits('as kb}', 'as kb}')

// _158 module identity
dumpHits('_158.js token', 'B:/~BUN/root/_158.js', 80, 20)
dumpHits('OsPsQs', 'OsPsQs')
dumpHits('PsQsOs', 'PsQsOs')
dumpHits('export{Os,Ps,Qs', 'export{Os,Ps,Qs')
dumpHits('export{Os as', 'export{Os as')
dumpHits('export{Ps as', 'export{Ps as')
dumpHits('export{Qs as', 'export{Qs as')

// availability Ps vs _158 Ps
dumpFn('avail-Ps-222029808', 222029808, 2500)
dumpAround('avail-Ps-export', 222029808, 40, 1200)

// Jt survey
dumpHits('surveyFeedbackSource:K', 'surveyFeedbackSource:K')
dumpHits('function Qs(){', 'function Qs(){')
dumpHits('Qs=()=>', 'Qs=()=>')
dumpHits('getSurvey', 'getSurvey')
dumpHits('surveySource', 'surveySource')
dumpHits('survey_feedback', 'survey_feedback')

// Ht boolean-ish near feedback
dumpHits('&&!Ht()', '&&!Ht()')
dumpHits('function Ht(', 'function Ht(')
dumpHits('Ht=()=>', 'Ht=()=>')

// DE as key rejector — Poe wrapper + imports
dumpFnContaining('Poe-wrapper', 'function Poe(e){return DE(e)===void 0')
dumpHits('function Poe(', 'function Poe(')
dumpHits('DE(e)===void 0', 'DE(e)===void 0')
dumpHits(' as DE}', ' as DE}')
dumpHits(' as DE,', ' as DE,')
dumpHits('DE as ', 'DE as ')
dumpHits('function DE(e)', 'function DE(e)')
dumpHits('function DE(e){', 'function DE(e){')

// ol segment used by Lfs — 1-arg
dumpFn('ol-len-Kb', 211019077, 800)
dumpAround('ol-len-Kb-ctx', 211019077, 400, 200)
dumpHits('isValidStoragePathSegment', 'isValidStoragePathSegment')
dumpHits('Kb.test(e)', 'Kb.test(e)')

// storage key error leftover names
dumpHits('invalid storage key', 'invalid storage key')
dumpHits('keyError', 'keyError')
dumpHits('function _r(', 'function _r(')

writeFileSync(`${outDir}/gold-1-ye-Ht-Jt-DE-pass2.txt`, lines.join('\n'))
console.log('WROTE', lines.join('\n').length)
