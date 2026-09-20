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

const lines = ['# gold-1-ye-Ht-Jt-DE-pass4 247', '']

function dumpHits(label, needle, around = 90, cap = 12) {
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

// --- DE = qcd from _812 ---
dumpHits('_812.js', 'B:/~BUN/root/_812.js', 80, 12)
dumpHits('qcd as', 'qcd as')
dumpHits('export{qcd', 'export{qcd')
dumpHits(' as qcd}', ' as qcd}')
dumpHits(' as qcd,', ' as qcd,')
dumpHits('function z(e)', 'function z(e)')
dumpHits('function Ua(', 'function Ua(')
dumpHits('expected a key object', 'expected a key object')
dumpHits('is not a storage namespace', 'is not a storage namespace')

const keyObj = b247.indexOf(Buffer.from('expected a key object'))
dumpAround('key-object-win', keyObj, 80, 400)
const zNear = lastFnStart(keyObj + 1, ['function z(', 'function Ua(', 'function DE(', 'function qcd('])
dumpAround('key-object-lastFn', zNear.i, 20, 40)
if (zNear.i >= 0) dumpFn(`key-validator ${zNear.name}`, zNear.i, 2500)

// --- _448 export kb / xSa ---
dumpHits('export from _448 kb', 'kb as xSa')
dumpHits('_448.js token', 'B:/~BUN/root/_448.js', 60, 8)
// find _448 module that EXPORTS kb — look at bun table names before _448.js
dumpHits('xSa in table', 'xSakb')
dumpHits('kbxSa', 'kbxSa')

// search live-array ye: for-of without split jsonl
dumpHits(
  'array-filter-sidechain',
  'isSidechain===!0||!e.message)continue',
)
dumpHits(
  'for of messages ye',
  'e.type!=="user"&&e.type!=="assistant")continue;if(typeof e.uuid',
)

// leftover barrel original of kb: search `kb` export in modules that also export zI (next alias ySa)
dumpHits('zI as ySa', 'zI as ySa')
dumpHits('function zI(', 'function zI(')
dumpHits('zI=', 'zI=')

// --- _158 Ps/Qs module body ---
// Find unique _158 exports Os,Ps,Qs together in source
dumpHits('Yne(', 'Yne(')
dumpHits('Yne=', 'Yne=')
dumpAround('Os-as-Yne-use', 232030386, 200, 400)

// Search _158 source file header: modules that export Os and Ps
dumpHits('function Os(){let s=Ce()', 'function Os(){let s=Ce()')
const osFeedback = 222032646
dumpFn('Os-feedback-222032646', osFeedback, 2000)
dumpAround('Os-feedback-neighbors', osFeedback, 200, 80)

// _158 might be a tiny re-export file. Search Version header near unique Os/Ps/Qs
dumpHits('export{Os,Ps', 'export{Os,Ps')
dumpHits('export{Ps,Qs', 'export{Ps,Qs')
dumpHits('export{Qs,Os', 'export{Qs,Os')
dumpHits('export{Os as Os', 'export{Os')
dumpHits(',Ps,Qs,', ',Ps,Qs,')
dumpHits('Ps,Qs,Os', 'Ps,Qs,Os')
dumpHits('Qs,Os,Ps', 'Qs,Os,Ps')

// survey source function near Feedback
dumpHits('surveyFeedbackSource:', 'surveyFeedbackSource:')
dumpHits('tengu_survey', 'tengu_survey')
dumpHits('feedback_survey', 'feedback_survey')
dumpHits('getFeedbackSurvey', 'getFeedbackSurvey')

writeFileSync(`${outDir}/gold-1-ye-Ht-Jt-DE-pass4.txt`, lines.join('\n'))
console.log('WROTE', lines.join('\n').length)
