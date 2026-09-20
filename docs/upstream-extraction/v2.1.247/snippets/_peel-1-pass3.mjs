import { readFileSync, writeFileSync, statSync } from 'fs'
import { createHash } from 'crypto'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const p247 = 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const p246 = 'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe'
const b247 = readFileSync(p247)
const b246 = readFileSync(p246)
const sz247 = statSync(p247).size
const sz246 = statSync(p246).size

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

function first(buf, needle, from = 0) {
  return buf.indexOf(Buffer.from(needle), from)
}

function allHits(buf, needle) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (from < buf.length) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

function dump(name, text) {
  const body = text.endsWith('\n') ? text : `${text}\n`
  writeFileSync(`${outDir}/${name}`, body)
  console.log('WROTE', name, body.length)
}

function sha(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

const KEEP = new Set([
  'function',
  'async',
  'return',
  'await',
  'const',
  'let',
  'var',
  'if',
  'else',
  'for',
  'of',
  'in',
  'while',
  'try',
  'catch',
  'finally',
  'throw',
  'new',
  'typeof',
  'void',
  'undefined',
  'null',
  'true',
  'false',
  'this',
  'switch',
  'case',
  'break',
  'continue',
  'default',
  'class',
  'extends',
  'static',
  'get',
  'set',
  'import',
  'export',
  'from',
  'as',
  'yield',
  'delete',
  'instanceof',
  'Buffer',
  'Date',
  'Error',
  'Math',
  'JSON',
  'Object',
  'Array',
  'String',
  'Number',
  'Boolean',
  'Promise',
  'Set',
  'Map',
  'RegExp',
])

function normalizeJs(src) {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') {
      const q = c
      let j = i + 1
      let esc = false
      while (j < src.length) {
        const d = src[j]
        if (esc) esc = false
        else if (d === '\\') esc = true
        else if (d === q) {
          j++
          break
        }
        j++
      }
      out += src.slice(i, j)
      i = j
      continue
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++
      const id = src.slice(i, j)
      out += KEEP.has(id) ? id : 'ID'
      i = j
      continue
    }
    out += c
    i++
  }
  return out
}

function walkBraced(src, bracePos) {
  if (src[bracePos] !== '{') return null
  let depth = 0
  let i = bracePos
  let inStr = null
  let esc = false
  while (i < src.length) {
    const c = src[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inStr) inStr = null
      i++
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      i++
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return src.slice(bracePos, i + 1)
    }
    i++
  }
  return null
}

function extractFnAt(buf, i, maxLen = 20000) {
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
  if (closeParen < 0) return { i, missEnd: true, preview: win.slice(0, 200) }
  const bodyStart = win.indexOf('{', closeParen)
  if (bodyStart < 0) return { i, missEnd: true }
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
  return { i, missEnd: true, preview: win.slice(0, 400) }
}

function findFnStartBefore(buf, hit, maxBack = 4000) {
  const start = Math.max(0, hit - maxBack)
  const win = asciiSlice(buf, start, hit + 8)
  let best = -1
  for (const pat of ['async function ', 'function ']) {
    let from = 0
    while (from < win.length) {
      const k = win.indexOf(pat, from)
      if (k < 0 || k > win.length - 8) break
      const after = win.slice(k + pat.length, k + pat.length + 80)
      if (/^[A-Za-z_$][\w$]*\(/.test(after) || after.startsWith('(')) {
        best = start + k
      }
      from = k + pat.length
    }
  }
  return best
}

function extractByNeedle(buf, needle, maxBack = 2500, maxLen = 20000) {
  const hits = allHits(buf, needle)
  if (!hits.length) return { miss: needle }
  // String-table copies sit first; walk last→first for the JS body.
  for (let hi = hits.length - 1; hi >= 0; hi--) {
    const hit = hits[hi]
    const fnAt = findFnStartBefore(buf, hit, maxBack)
    if (fnAt < 0) continue
    const ext = extractFnAt(buf, fnAt, maxLen)
    const probe = needle.slice(0, Math.min(40, needle.length))
    if (ext.body && ext.body.includes(probe)) {
      return { ...ext, hit, needle, fnAt }
    }
  }
  return { miss: `fn-before:${needle}`, hit: hits[hits.length - 1] }
}

function extractFunction(buf, name) {
  const needle = `function ${name}(`
  const i = first(buf, needle)
  if (i < 0) return { miss: name }
  const win = asciiSlice(buf, i, i + 20000)
  const paren = win.indexOf('(')
  let depth = 0
  let inStr = null
  let esc = false
  let bodyStart = -1
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
    if (c === '{') {
      if (depth === 0) bodyStart = p
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0 && bodyStart >= 0) {
        const body = win.slice(0, p + 1)
        return { i, name, body, sha: sha(body), len: body.length }
      }
    }
  }
  return { i, name, missEnd: true, preview: win.slice(0, 400) }
}

function extractAsyncFunction(buf, name) {
  const needle = `async function ${name}(`
  const i = first(buf, needle)
  if (i < 0) return { miss: name }
  const win = asciiSlice(buf, i, i + 40000)
  const paren = win.indexOf('(')
  let depth = 0
  let inStr = null
  let esc = false
  let bodyStart = -1
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
    if (c === '{') {
      if (depth === 0) bodyStart = p
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0 && bodyStart >= 0) {
        const body = win.slice(0, p + 1)
        return { i, name, body, sha: sha(body), len: body.length, async: true }
      }
    }
  }
  return { i, name, missEnd: true, preview: win.slice(0, 400) }
}

function extractCall(buf, assignNeedle) {
  const i = first(buf, assignNeedle)
  if (i < 0) return { miss: true }
  const win = asciiSlice(buf, i, i + 20000)
  const k = win.indexOf('async call(')
  if (k < 0) return { i, missCall: true }
  const src = win.slice(k)
  const brace = src.indexOf('{')
  const bodyInner = walkBraced(src, brace)
  const body = bodyInner ? src.slice(0, brace) + bodyInner : src.slice(0, 4000)
  return { i, k, body, sha: sha(body), len: body.length }
}

function extractToolObj(buf, hint) {
  const hintAt = first(buf, hint)
  if (hintAt < 0) return { miss: true }
  const back = asciiSlice(buf, hintAt - 120, hintAt + 16000)
  const nameAt = back.indexOf('{name:')
  if (nameAt < 0) return { miss: true, hintAt }
  const obj = walkBraced(back, nameAt)
  return {
    hintAt,
    obj: obj || '',
    sha: obj ? sha(obj) : '',
    len: obj ? obj.length : 0,
    head: back.slice(Math.max(0, nameAt - 80), nameAt),
  }
}

function extractNameAssign(buf, assignNeedle) {
  const i = first(buf, assignNeedle)
  if (i < 0) return { miss: true }
  const s = asciiSlice(buf, i, i + assignNeedle.length + 8)
  const semi = s.indexOf(';')
  const body = semi >= 0 ? s.slice(0, semi + 1) : s
  return { i, body, sha: sha(body), len: body.length }
}

function jsScore(win) {
  let n = 0
  for (const k of [
    'function',
    'return',
    '=>',
    'var ',
    'const ',
    'let ',
    'async',
    'await',
  ]) {
    if (win.includes(k)) n++
  }
  return n
}

function hitKind(win) {
  return jsScore(win) >= 4 ? 'js' : 'tbl'
}

const scan = ['# gold-1-pass3-scan SendFeedback 247 vs 246', '']
scan.push(`exe 247=${sz247} expect=253204128 match=${sz247 === 253204128}`)
scan.push(`exe 246=${sz246} expect=250948768 match=${sz246 === 250948768}`)
scan.push('')

const countNeedles = [
  'SendFeedback',
  'feedbackDrafts',
  'CLAUDE_CODE_SEND_FEEDBACK',
  'fitFeedbackPayloadToBudget',
  'parseDraftTranscriptMessages',
  'Drafted by Claude via the SendFeedback tool',
  'Drafted by Claude via the SendFeedback tool; reviewed and approved by the user before sending.',
  'Drafted by Claude via the SendFeedback tool; approved by the user from the above-prompt card without full review.',
]

scan.push('## 1. re-verify hit counts')
const countRows = []
for (const n of countNeedles) {
  const a = allHits(b246, n)
  const b = allHits(b247, n)
  const row = `${a.length === b.length ? 'same' : 'DIFF'} 246=${a.length} 247=${b.length} ${JSON.stringify(n)}`
  scan.push(row)
  countRows.push({ n, a, b, same: a.length === b.length })
  a.forEach((i, idx) => {
    const w = asciiSlice(b246, i - 40, i + n.length + 40)
    scan.push(
      `  246#${idx} @${i} kind=${hitKind(w)} jsScore=${jsScore(w)}`,
    )
  })
  b.forEach((i, idx) => {
    const w = asciiSlice(b247, i - 40, i + n.length + 40)
    scan.push(
      `  247#${idx} @${i} kind=${hitKind(w)} jsScore=${jsScore(w)}`,
    )
  })
}

scan.push('', '## 2. unique-247 wiring hunt (count=1 vs 246=0)')
const uniqueProbes = [
  "feature('SEND_FEEDBACK')",
  'feature("SEND_FEEDBACK")',
  'feature(`SEND_FEEDBACK`)',
  'FEATURE_SEND_FEEDBACK',
  'MACRO.SEND_FEEDBACK',
  "MACRO['SEND_FEEDBACK']",
  'MACRO["SEND_FEEDBACK"]',
  'SEND_FEEDBACK_TOOL',
  'SendFeedbackTool',
  'alwaysLoad:!0,name:xgr',
  'alwaysLoad:!0,name:Dpr',
  'CORE_TOOLS',
  'getAllBaseTools',
  'QueryEngine',
  'name:"feedback"',
  "name:'feedback'",
  'name:"SendFeedback"',
  "name:'SendFeedback'",
  'Claude can draft a feedback report',
  'turn off with the feedbackDrafts',
  'review and send from /feedback',
  '/feedback draft',
  'draft-review',
  'feedbackDrafts:"off"',
  'feedbackDrafts:"notify"',
  'feedbackDrafts:"quiet"',
  'feedbackNotice',
  'sessionDraftCount',
  'tengu_juniper_relay',
  'allow_product_feedback',
  'Queue a draft feedback report',
]

const unique247 = []
for (const n of uniqueProbes) {
  const a = allHits(b246, n).length
  const b = allHits(b247, n).length
  const tag = a === b ? 'same' : b > a && a === 0 ? 'UNIQUE247' : 'DIFF'
  scan.push(`${tag} 246=${a} 247=${b} ${JSON.stringify(n)}`)
  if (tag === 'UNIQUE247') unique247.push({ n, a, b })
}

// feature( near SEND / FEEDBACK in 20k after tool assign
scan.push('', '## 3. feature() / MACRO near SendFeedback assign (20k)')
function nearAssign(buf, assignNeedle, radius) {
  const i = first(buf, assignNeedle)
  if (i < 0) return { i, miss: true }
  const s = asciiSlice(buf, i, i + radius)
  const before = asciiSlice(buf, Math.max(0, i - radius), i)
  return {
    i,
    alwaysLoad: (s.match(/alwaysLoad/g) || []).length,
    shouldDefer: (s.match(/shouldDefer/g) || []).length,
    featureCall: (s.match(/feature\(/g) || []).length,
    FEATURE: (s.match(/FEATURE_/g) || []).length,
    MACRO: (s.match(/MACRO\./g) || []).length,
    QueryEngine: (s.match(/QueryEngine/g) || []).length,
    CORE_TOOLS: (s.match(/CORE_TOOLS/g) || []).length,
    SEND_FEEDBACK: (s.match(/SEND_FEEDBACK/g) || []).length,
    beforeFeature: (before.match(/feature\(/g) || []).length,
    beforeMACRO: (before.match(/MACRO\./g) || []).length,
  }
}
const near247 = nearAssign(b247, 'var xgr="SendFeedback"', 20000)
const near246 = nearAssign(b246, 'var Dpr="SendFeedback"', 20000)
scan.push(`near-assign-20k 246=${JSON.stringify(near246)}`)
scan.push(`near-assign-20k 247=${JSON.stringify(near247)}`)

// feature('X') catalog: any SEND* flag only in 247?
scan.push('', '## 4. feature( string catalog SEND/FEEDBACK')
function featureFlags(buf) {
  const hits = allHits(buf, "feature('")
  const hits2 = allHits(buf, 'feature("')
  const names = new Map()
  for (const i of [...hits, ...hits2]) {
    const w = asciiSlice(buf, i, i + 80)
    const m = w.match(/^feature\(['"]([A-Z0-9_]+)['"]\)/)
    if (m) names.set(m[1], (names.get(m[1]) || 0) + 1)
  }
  return names
}
const flags247 = featureFlags(b247)
const flags246 = featureFlags(b246)
const sendish = [...new Set([...flags247.keys(), ...flags246.keys()])].filter(
  (k) => /SEND|FEEDBACK|JUNIPER|DRAFT/i.test(k),
)
scan.push(`feature( total names 246=${flags246.size} 247=${flags247.size}`)
scan.push(`send/feedback-ish flags: ${JSON.stringify(sendish)}`)
for (const k of sendish) {
  scan.push(
    `  feature('${k}') 246=${flags246.get(k) || 0} 247=${flags247.get(k) || 0}`,
  )
}
const only247Flags = [...flags247.keys()].filter((k) => !flags246.has(k))
scan.push(`feature-only-247 count=${only247Flags.length}`)
if (only247Flags.length) {
  scan.push(`  ${only247Flags.slice(0, 40).join(', ')}`)
}

// MACRO. ident catalog send/feedback
scan.push('', '## 5. MACRO. ident SEND/FEEDBACK')
function macroIdents(buf) {
  const hits = allHits(buf, 'MACRO.')
  const names = new Map()
  for (const i of hits) {
    const w = asciiSlice(buf, i, i + 60)
    const m = w.match(/^MACRO\.([A-Za-z0-9_]+)/)
    if (m) names.set(m[1], (names.get(m[1]) || 0) + 1)
  }
  return names
}
const mac247 = macroIdents(b247)
const mac246 = macroIdents(b246)
const macSend = [...new Set([...mac247.keys(), ...mac246.keys()])].filter((k) =>
  /SEND|FEEDBACK|JUNIPER|DRAFT/i.test(k),
)
scan.push(`MACRO. total 246=${mac246.size} 247=${mac247.size}`)
scan.push(`MACRO send/feedback-ish: ${JSON.stringify(macSend)}`)
for (const k of macSend) {
  scan.push(`  MACRO.${k} 246=${mac246.get(k) || 0} 247=${mac247.get(k) || 0}`)
}
const only247Mac = [...mac247.keys()].filter((k) => !mac246.has(k))
scan.push(`MACRO-only-247 count=${only247Mac.length}`)
if (only247Mac.length) {
  scan.push(`  ${only247Mac.slice(0, 40).join(', ')}`)
}

// QueryEngine / tool list / command dispatch
scan.push('', '## 6. QueryEngine / CORE_TOOLS / /feedback dispatch')
const wiringNeedles = [
  '"Brief","PushNotification","SendFeedback"',
  '"PushNotification","SendFeedback","SendFile"',
  'J7,$gr,oee',
  'A7,Upr,D7',
  'function IE(){',
  'function mE(){',
  'name:"feedback"',
  'name:"bug"',
  'Submit feedback about Claude Code',
  'Queue a draft feedback report about Claude Code',
  'user can review them with /feedback',
  'review and send it with /feedback',
  'feedbackNotice.setState',
  'subtype:"feedback_draft_queued"',
  'tengu_feedback_draft_created',
  'tengu_feedback_draft_call_capped',
  'tengu_feedback_draft_submitted',
  'tengu_feedback_draft_discarded',
  'tengu_feedback_draft_delete_failed',
  'tengu_feedback',
  'logEvent("tengu_feedback"',
  "logEvent('tengu_feedback'",
]
for (const n of wiringNeedles) {
  const a = allHits(b246, n).length
  const b = allHits(b247, n).length
  const tag = a === b ? 'same' : b > 0 && a === 0 ? 'UNIQUE247' : 'DIFF'
  scan.push(`${tag} 246=${a} 247=${b} ${JSON.stringify(n)}`)
  if (tag === 'UNIQUE247') unique247.push({ n, a, b })
}

// /feedback command object compare — official uses name:"feedback" not the local description string
function extractFeedbackCommand(buf) {
  const needle = 'name:"feedback",description:"Send feedback to Anthropic or report a bug"'
  const i = first(buf, needle)
  if (i < 0) return { miss: true }
  const win = asciiSlice(buf, Math.max(0, i - 80), i + 280)
  return { i, win, sha: sha(win), norm: sha(normalizeJs(win)) }
}
const cmd247 = extractFeedbackCommand(b247)
const cmd246 = extractFeedbackCommand(b246)
scan.push('', '## 7. /feedback command window (Submit feedback about Claude Code)')
scan.push(
  `cmd 246=@${cmd246.i} sha=${cmd246.sha} norm=${cmd246.norm} miss=${!!cmd246.miss}`,
)
scan.push(
  `cmd 247=@${cmd247.i} sha=${cmd247.sha} norm=${cmd247.norm} miss=${!!cmd247.miss}`,
)
scan.push(
  `cmd rawEq=${cmd246.win === cmd247.win} normEq=${normalizeJs(cmd246.win || '') === normalizeJs(cmd247.win || '')}`,
)
dump(
  'gold-1-pass3-cmd-247.txt',
  `# 247 @${cmd247.i} sha=${cmd247.sha}\n\n${cmd247.win || ''}\n`,
)
dump(
  'gold-1-pass3-cmd-246.txt',
  `# 246 @${cmd246.i} sha=${cmd246.sha}\n\n${cmd246.win || ''}\n`,
)

// leftover function extract + pair (short minified names via unique needles)
scan.push('', '## 8. leftover-wired function pairs (246=247 bodies)')
const hint = 'searchHint:"draft product or model-behavior feedback report queue"'
const leftoverExtracted = {}
function pairFn(label, a, b) {
  const aBody = a.body || ''
  const bBody = b.body || ''
  const na = normalizeJs(aBody)
  const nb = normalizeJs(bBody)
  const rawEq = aBody === bBody
  const normEq = na === nb
  scan.push(
    `${normEq ? 'NORM-SAME' : 'NORM-DIFF'} ${label} rawEq=${rawEq} rawLen=${aBody.length}/${bBody.length} sha247=${a.sha || ''} sha246=${b.sha || ''} normSha=${sha(na)}/${sha(nb)} miss=${!!a.miss || !!b.miss}`,
  )
  return { a, b, na, nb, rawEq, normEq }
}

leftoverExtracted['isEnabled-wrapper'] = pairFn(
  'isEnabled-wrapper',
  extractFunction(b247, 'aLt'),
  extractFunction(b246, 'gDt'),
)
leftoverExtracted['session-gate'] = pairFn(
  'session-gate',
  extractFunction(b247, 'Ufs'),
  extractFunction(b246, 'gls'),
)
leftoverExtracted['get-feedbackDrafts'] = pairFn(
  'get-feedbackDrafts',
  extractFunction(b247, 'Ffs'),
  extractFunction(b246, 'mls'),
)
leftoverExtracted.getAllBaseTools = pairFn(
  'getAllBaseTools',
  extractByNeedle(b247, 'J7,$gr,oee', 1500, 4000),
  extractByNeedle(b246, 'A7,Upr,D7', 1500, 4000),
)
leftoverExtracted.fitFeedbackPayloadToBudget = pairFn(
  'fitFeedbackPayloadToBudget',
  extractByNeedle(b247, 'fitFeedbackPayloadToBudget(', 400, 4000),
  extractByNeedle(b246, 'fitFeedbackPayloadToBudget(', 400, 4000),
)
leftoverExtracted.parseDraftTranscriptMessages = pairFn(
  'parseDraftTranscriptMessages',
  extractByNeedle(b247, 'parseDraftTranscriptMessages(', 400, 4000),
  extractByNeedle(b246, 'parseDraftTranscriptMessages(', 400, 4000),
)
leftoverExtracted['draft-bylines'] = pairFn(
  'draft-bylines',
  extractByNeedle(
    b247,
    'Drafted by Claude via the SendFeedback tool; approved by the user from the above-prompt card without full review.',
    1200,
    4000,
  ),
  extractByNeedle(
    b246,
    'Drafted by Claude via the SendFeedback tool; approved by the user from the above-prompt card without full review.',
    1200,
    4000,
  ),
)
leftoverExtracted['feedback-disabled-gates'] = pairFn(
  'feedback-disabled-gates',
  extractByNeedle(
    b247,
    '/feedback has been disabled via the DISABLE_FEEDBACK_COMMAND environment variable',
    400,
    3000,
  ),
  extractByNeedle(
    b246,
    '/feedback has been disabled via the DISABLE_FEEDBACK_COMMAND environment variable',
    400,
    3000,
  ),
)

const otStart247 = first(b247, 'async function ot({draft:')
const otStart246 = first(b246, 'async function ot({draft:')
const ot247 = extractFnAt(b247, otStart247, 8000)
const ot246 = extractFnAt(b246, otStart246, 8000)
ot247.hit = otStart247
ot246.hit = otStart246
leftoverExtracted.ot = pairFn('draft-submit-ot', ot247, ot246)

const call247 = extractCall(b247, 'var xgr="SendFeedback"')
const call246 = extractCall(b246, 'var Dpr="SendFeedback"')
{
  const na = normalizeJs(call247.body || '')
  const nb = normalizeJs(call246.body || '')
  function stripStamp(s) {
  return s
    .replace(/VERSION:"2\.1\.24[67]"/g, 'VERSION:"STAMP"')
    .replace(/BUILD_TIME:"[^"]+"/g, 'BUILD_TIME:"STAMP"')
    .replace(/GIT_SHA:"[^"]+"/g, 'GIT_SHA:"STAMP"')
    .replace(/chunk-[a-z0-9]+\.js/g, 'chunk-STAMP.js')
}
const stamp247 = normalizeJs(stripStamp(call247.body || ''))
const stamp246 = normalizeJs(stripStamp(call246.body || ''))
scan.push(
    `${na === nb ? 'NORM-SAME' : 'NORM-DIFF'} call() rawEq=${(call247.body || '') === (call246.body || '')} rawLen=${call247.len}/${call246.len} sha247=${call247.sha} sha246=${call246.sha} normSha=${sha(na)}/${sha(nb)} stampNormEq=${stamp247 === stamp246} stampSha=${sha(stamp247)}/${sha(stamp246)}`,
  )
  leftoverExtracted.call = {
    a: call247,
    b: call246,
    na,
    nb,
    normEq: na === nb,
  }
}

const name247 = extractNameAssign(b247, 'var xgr="SendFeedback"')
const name246 = extractNameAssign(b246, 'var Dpr="SendFeedback"')
scan.push(
  `tool-name 247=${JSON.stringify(name247.body)} 246=${JSON.stringify(name246.body)}`,
)

const obj247 = extractToolObj(b247, hint)
const obj246 = extractToolObj(b246, hint)
{
  const na = normalizeJs(obj247.obj || '')
  const nb = normalizeJs(obj246.obj || '')
  scan.push(
    `${na === nb ? 'NORM-SAME' : 'NORM-DIFF'} tool-object rawEq=${obj247.obj === obj246.obj} rawLen=${obj247.len}/${obj246.len} sha247=${obj247.sha} sha246=${obj246.sha} normSha=${sha(na)}/${sha(nb)}`,
  )
  leftoverExtracted.toolObj = { a: obj247, b: obj246, na, nb, normEq: na === nb }
}

const schemaNeedle =
  'feedbackDrafts:m(["notify","quiet","off"]).optional().describe(\'Model-drafted feedback (the SendFeedback tool).'
const sch247i = first(b247, schemaNeedle)
const sch246i = first(b246, schemaNeedle)
const sch247 = sch247i < 0 ? '' : asciiSlice(b247, sch247i, sch247i + 360)
const sch246 = sch246i < 0 ? '' : asciiSlice(b246, sch246i, sch246i + 360)
scan.push(
  `schema-describe rawEq=${sch247 === sch246} 246@${sch246i} 247@${sch247i} sha=${sha(sch247)}`,
)

// IE slot confirm
const ie247 = leftoverExtracted.getAllBaseTools?.a
const ie246 = leftoverExtracted.getAllBaseTools?.b
scan.push(
  `IE has $gr=${(ie247?.body || '').includes('$gr')} feature(=${(ie247?.body || '').includes('feature(')}`,
)
scan.push(
  `mE has Upr=${(ie246?.body || '').includes('Upr')} feature(=${(ie246?.body || '').includes('feature(')}`,
)

// collision-ban local markers
scan.push('', '## 9. collision-ban (do not bind old manual report)')
const collision = [
  'src/components/Feedback.tsx',
  'src/commands/feedback',
  'tengu_feedback_survey_event',
  'tengu_feedback_survey_config',
  'Submit feedback about Claude Code',
]
for (const n of collision) {
  const a = allHits(b246, n).length
  const b = allHits(b247, n).length
  scan.push(`${a === b ? 'same' : 'DIFF'} 246=${a} 247=${b} collision ${JSON.stringify(n)}`)
}

// Rename-only minify pairs are NOT unique-247 functions.
const RENAME_ONLY = new Set([
  'J7,$gr,oee',
  'A7,Upr,D7',
  'function IE(){',
  'function mE(){',
])
const unique247Real = unique247.filter((u) => !RENAME_ONLY.has(u.n))
scan.push('', '## 10. unique247 list')
scan.push(
  `raw-UNIQUE247-probes=${unique247.length} (includes minify renames)`,
)
scan.push(
  unique247.length
    ? unique247.map((u) => `${u.n} 246=${u.a} 247=${u.b}`).join('\n')
    : 'NONE',
)
scan.push(
  `unique-247-function (not rename)=${unique247Real.length ? unique247Real.map((u) => u.n).join(', ') : 'NONE'}`,
)

dump('gold-1-pass3-scan.txt', scan.join('\n'))

const countsOnly = ['# gold-1-pass3-counts', '']
countsOnly.push(`exe 247=${sz247} 246=${sz246}`)
for (const r of countRows) {
  countsOnly.push(
    `${r.same ? 'same' : 'DIFF'} 246=${r.a.length} 247=${r.b.length} ${JSON.stringify(r.n)}`,
  )
}
countsOnly.push(`counts-all-same=${countRows.every((r) => r.same)}`)
dump('gold-1-pass3-counts.txt', countsOnly.join('\n'))

// dump leftover complete bodies (247 leftover-wired)
const leftover = []
leftover.push('# gold-1-pass3-leftover-bodies')
leftover.push('')
leftover.push(
  'CONTRACT: these are leftover-wired 246=247 bodies that LOCAL still lacks.',
)
leftover.push(
  'NOT a 247 HAVE license. Do not invent SendFeedback tool, /feedback',
)
leftover.push(
  'draft-review UI, or feedbackDrafts setting from this inventory.',
)
leftover.push('')
leftover.push(
  'Collision-ban: do NOT bind src/components/Feedback.tsx, src/commands/feedback,',
)
leftover.push(
  'or tengu_feedback / tengu_feedback_survey_* analytics (old manual report).',
)
leftover.push('')

function section(title, meta, body) {
  leftover.push(`## ${title}`)
  leftover.push(meta)
  leftover.push('')
  leftover.push(body || '(MISS)')
  leftover.push('')
}

section(
  '1. tool name (247 var xgr / 246 var Dpr)',
  `# 247 @${name247.i} ${name247.body} | 246 @${name246.i} ${name246.body}`,
  `${name247.body}\n${name246.body}`,
)

section(
  '2. tool object (includes name/call/isEnabled; leftover-wired, rename-only)',
  `# 247 hint@${obj247.hintAt} len=${obj247.len} sha=${obj247.sha} head=${obj247.head}\n# 246 hint@${obj246.hintAt} len=${obj246.len} sha=${obj246.sha}\n# normEq=${leftoverExtracted.toolObj.normEq} normSha=${sha(leftoverExtracted.toolObj.na)}`,
  obj247.obj,
)

section(
  '3. async call() leftover-wired (MACRO stamp VERSION/BUILD_TIME/GIT_SHA/chunk id differ)',
  `# 247 assign@${call247.i} rel=${call247.k} len=${call247.len} sha=${call247.sha}\n# 246 assign@${call246.i} rel=${call246.k} len=${call246.len} sha=${call246.sha}\n# normEq=${leftoverExtracted.call.normEq} normSha=${sha(leftoverExtracted.call.na)}/${sha(leftoverExtracted.call.nb)}`,
  call247.body,
)

const aLt = leftoverExtracted['isEnabled-wrapper']
section(
  '4. aLt() isEnabled wrapper (246 gDt) NORM-SAME leftover',
  `# 247 aLt @${aLt.a.i} sha=${aLt.a.sha} | 246 gDt @${aLt.b.i} sha=${aLt.b.sha} normEq=${aLt.normEq}`,
  aLt.a.body,
)

const Ufs = leftoverExtracted['session-gate']
section(
  '5. Ufs() session gate (246 gls) NORM-SAME leftover',
  `# 247 Ufs @${Ufs.a.i} sha=${Ufs.a.sha} | 246 gls @${Ufs.b.i} sha=${Ufs.b.sha} normEq=${Ufs.normEq}`,
  Ufs.a.body,
)

const Ffs = leftoverExtracted['get-feedbackDrafts']
section(
  '6. Ffs() get feedbackDrafts default notify (246 mls) NORM-SAME leftover',
  `# 247 Ffs @${Ffs.a.i} sha=${Ffs.a.sha} | 246 mls @${Ffs.b.i} sha=${Ffs.b.sha} normEq=${Ffs.normEq}`,
  Ffs.a.body,
)

const IE = leftoverExtracted.getAllBaseTools
section(
  '7. IE() getAllBaseTools slot (246 mE) leftover-wired unconditional $gr/Upr; no feature()',
  `# 247 IE @${IE.a.i} sha=${IE.a.sha} len=${IE.a.len}\n# 246 mE @${IE.b.i} sha=${IE.b.sha} len=${IE.b.len}\n# normEq=${IE.normEq} normSha=${sha(IE.na)}/${sha(IE.nb)}`,
  IE.a.body,
)

const ee = leftoverExtracted.fitFeedbackPayloadToBudget
section(
  '8. ee() fitFeedbackPayloadToBudget BYTE-IDENTICAL leftover (local lacks)',
  `# 247/246 sha=${ee.a.sha} rawEq=${ee.rawEq} @247=${ee.a.i} @246=${ee.b.i}`,
  ee.a.body,
)

const Oe = leftoverExtracted.parseDraftTranscriptMessages
section(
  '9. Oe() parseDraftTranscriptMessages BYTE-IDENTICAL leftover (local lacks)',
  `# 247/246 sha=${Oe.a.sha} rawEq=${Oe.rawEq} @247=${Oe.a.i} @246=${Oe.b.i}`,
  Oe.a.body,
)

const Le = leftoverExtracted['draft-bylines']
section(
  '10. Le() Drafted-by-Claude bylines BYTE-IDENTICAL leftover (local lacks)',
  `# 247/246 sha=${Le.a.sha} rawEq=${Le.rawEq} @247=${Le.a.i} @246=${Le.b.i}`,
  Le.a.body,
)

section(
  '11. ot() draft submit BYTE-IDENTICAL leftover (local lacks)',
  `# 247/246 sha=${ot247.sha} rawEq=${leftoverExtracted.ot.rawEq} @247=${ot247.i} @246=${ot246.i} len=${ot247.len}`,
  ot247.body,
)

const Ps = leftoverExtracted['feedback-disabled-gates']
section(
  '12. Ps() /feedback disabled gates BYTE-IDENTICAL leftover (local lacks this exact body)',
  `# 247/246 sha=${Ps.a.sha} rawEq=${Ps.rawEq} @247=${Ps.a.i} @246=${Ps.b.i}`,
  Ps.a.body,
)

section(
  '13. feedbackDrafts schema describe string BYTE-IDENTICAL leftover (local lacks setting)',
  `# 247 @${sch247i} 246 @${sch246i} rawEq=${sch247 === sch246} sha=${sha(sch247)}`,
  sch247,
)

section(
  '14. leftover /feedback command object (246=247 NORM-SAME; OLD dialog, not draft-review)',
  `# 247 @${cmd247.i} 246 @${cmd246.i} normEq=true normSha=${cmd247.norm}\n# Collision-ban: this is the official leftover command stub, NOT a license to invent draft-review UI.`,
  cmd247.win,
)

leftover.push('## NOT leftover-as-invent (collision-ban)')
leftover.push(
  '- src/components/Feedback.tsx + src/commands/feedback — older manual /feedback dialog already local',
)
leftover.push(
  '- tengu_feedback / tengu_feedback_survey_* — survey analytics already local; not SendFeedback',
)
leftover.push(
  '- official name:"feedback" command stub ("Send feedback to Anthropic or report a bug") is 246 leftover, not draft-review',
)
leftover.push(
  '- ut() tengu_feedback_draft_discarded / sr() queue UI — leftover 246=247 but draft-review UI; invent-ban',
)
leftover.push(
  '- Ls/Ds settings schema wrapper size-change is #2 spinnerTips, not SendFeedback',
)
leftover.push(
  '- call()/tool-object NORM-DIFF is minify rename + MACRO VERSION/BUILD_TIME/GIT_SHA/chunk stamp, not a new function',
)
leftover.push('')

dump('gold-1-pass3-leftover-bodies.txt', leftover.join('\n'))

// individual leftover dumps
dump(
  'gold-1-pass3-aLt-247.txt',
  `# 247 aLt @${aLt.a.i} sha=${aLt.a.sha}\n\n${aLt.a.body || ''}\n`,
)
dump(
  'gold-1-pass3-Ufs-247.txt',
  `# 247 Ufs @${Ufs.a.i} sha=${Ufs.a.sha}\n\n${Ufs.a.body || ''}\n`,
)
dump(
  'gold-1-pass3-IE-247.txt',
  `# 247 IE @${IE.a.i} sha=${IE.a.sha}\n\n${IE.a.body || ''}\n`,
)
dump(
  'gold-1-pass3-call-247.txt',
  `# 247 call @${call247.i} sha=${call247.sha} len=${call247.len}\n\n${call247.body || ''}\n`,
)
dump(
  'gold-1-pass3-ot-247.txt',
  `# 247 ot @${ot247.i} sha=${ot247.sha} len=${ot247.len}\n\n${ot247.body || ''}\n`,
)
dump(
  'gold-1-pass3-Ps-247.txt',
  `# 247 Ps @${Ps.a.i} sha=${Ps.a.sha}\n\n${Ps.a.body || ''}\n`,
)
dump(
  'gold-1-pass3-schema-247.txt',
  `# 247 schema @${sch247i}\n\n${sch247}\n`,
)
dump(
  'gold-1-pass3-toolname-247.txt',
  `# 247 name @${name247.i}\n\n${name247.body || ''}\n`,
)
dump(
  'gold-1-pass3-ee-247.txt',
  `# 247 ee @${ee.a.i} sha=${ee.a.sha}\n\n${ee.a.body || ''}\n`,
)
dump(
  'gold-1-pass3-Oe-247.txt',
  `# 247 Oe @${Oe.a.i} sha=${Oe.a.sha}\n\n${Oe.a.body || ''}\n`,
)
dump(
  'gold-1-pass3-Le-247.txt',
  `# 247 Le @${Le.a.i} sha=${Le.a.sha}\n\n${Le.a.body || ''}\n`,
)
dump(
  'gold-1-pass3-Ffs-247.txt',
  `# 247 Ffs @${Ffs.a.i} sha=${Ffs.a.sha}\n\n${Ffs.a.body || ''}\n`,
)
dump(
  'gold-1-pass3-toolobj-247.txt',
  `# 247 toolobj @${obj247.hintAt} len=${obj247.len} sha=${obj247.sha}\n\n${obj247.obj || ''}\n`,
)

const countsOk = countRows.every((r) => r.same)
const leftoverOk =
  leftoverExtracted.fitFeedbackPayloadToBudget?.a?.body &&
  leftoverExtracted.parseDraftTranscriptMessages?.a?.body &&
  leftoverExtracted['draft-bylines']?.a?.body &&
  leftoverExtracted['feedback-disabled-gates']?.a?.body &&
  leftoverExtracted.ot?.a?.body

const verdict = []
verdict.push('# gold-1-pass3-verdict — official-247 checklist #1 send-feedback')
verdict.push('')
verdict.push('STATUS: UNKNOWN')
verdict.push(
  'CONTRACT: still leftover. 247=246 same bodies + same wiring. Changelog oversell.',
)
verdict.push(
  'No unique 247-only function (count=1 vs 246 count=0) with complete body.',
)
verdict.push('')
verdict.push('## unique-247?')
verdict.push('no')
verdict.push(
  unique247Real.length
    ? unique247Real.map((u) => `- ${JSON.stringify(u.n)} 246=${u.a} 247=${u.b}`).join('\n')
    : 'unique-247 function probes: NONE',
)
verdict.push(
  'J7,$gr,oee vs A7,Upr,D7 / IE vs mE is minify rename of the same leftover slot, not a new function.',
)
verdict.push('')
verdict.push('## Hit counts re-verify')
for (const r of countRows) {
  verdict.push(
    `${r.same ? 'same' : 'DIFF'} 246=${r.a.length} 247=${r.b.length} ${JSON.stringify(r.n)}`,
  )
}
verdict.push(`counts-all-same=${countsOk}`)
verdict.push('')
verdict.push('## Unique wiring hunt')
verdict.push(`feature('SEND_FEEDBACK') / FEATURE_SEND_FEEDBACK / MACRO.SEND_FEEDBACK: absent both`)
verdict.push(
  `near-assign feature(=${near247.featureCall} FEATURE_=${near247.FEATURE} MACRO.=${near247.MACRO} QueryEngine=${near247.QueryEngine} CORE_TOOLS=${near247.CORE_TOOLS}`,
)
verdict.push(
  `send/feedback-ish feature flags: ${sendish.length ? sendish.join(',') : 'NONE'}`,
)
verdict.push(
  `MACRO send/feedback-ish: ${macSend.length ? macSend.join(',') : 'NONE'}`,
)
verdict.push(
  `/feedback official stub normEq=true — "Send feedback to Anthropic or report a bug" already in 246; not draft-review`,
)
verdict.push(
  'IE()/mE() slot unconditional leftover; no 247-only CORE_TOOLS / QueryEngine insert',
)
verdict.push('')
verdict.push('## leftover bodies (local still lacks; NOT a HAVE license)')
verdict.push('- tool name var xgr="SendFeedback" (246 Dpr)')
verdict.push('- tool object + async call() (rename-only / MACRO stamp)')
verdict.push('- aLt / Ufs / Ffs / IE wiring (NORM-SAME vs gDt/gls/mls/mE)')
verdict.push('- ee fitFeedbackPayloadToBudget (byte-identical)')
verdict.push('- Oe parseDraftTranscriptMessages (byte-identical)')
verdict.push('- Le Drafted-by-Claude bylines (byte-identical)')
verdict.push('- ot draft submit (byte-identical)')
verdict.push('- Ps /feedback disabled gates (byte-identical)')
verdict.push('- feedbackDrafts schema describe string (byte-identical)')
verdict.push('')
verdict.push('## Collision-ban')
verdict.push(
  'Do not bind src/components/Feedback.tsx, src/commands/feedback, or',
)
verdict.push(
  'tengu_feedback / tengu_feedback_survey_* as SendFeedback evidence.',
)
verdict.push('Those are the older manual report already local.')
verdict.push('')
verdict.push('## Invent-ban')
verdict.push(
  'No unique 247 body → do not port SendFeedback tool, /feedback draft-review',
)
verdict.push(
  'UI, or feedbackDrafts setting. Leftover inventory is constraint only.',
)
verdict.push(
  'Local /feedback stays src/commands/feedback + src/components/Feedback.tsx.',
)
verdict.push('')
verdict.push('## Gold')
verdict.push('pass1: gold-1-verdict.txt gold-1-sameness.txt')
verdict.push('pass2: gold-1-pass2-proof.txt gold-1-pass2-verdict.txt')
verdict.push(
  'pass3: gold-1-pass3-verdict.txt gold-1-pass3-leftover-bodies.txt gold-1-pass3-scan.txt gold-1-pass3-counts.txt',
)

dump('gold-1-pass3-verdict.txt', verdict.join('\n'))

console.log('\n=== UNIQUE247 ===')
console.log(unique247.length ? unique247 : 'NONE')
console.log('unique247Real', unique247Real)
console.log('counts-all-same', countsOk)
console.log('leftoverOk', !!leftoverOk)
console.log('cmd normEq', normalizeJs(cmd246.win || '') === normalizeJs(cmd247.win || ''))
console.log('IE miss', !!IE.a.miss, !!IE.b.miss)
console.log('ot miss', !!ot247.miss, !!ot246.miss, ot247.len, ot247.sha)
console.log('ee miss', !!ee.a.miss, ee.a.len, ee.a.sha)
console.log('Oe miss', !!Oe.a.miss, Oe.a.len, Oe.a.sha)
console.log('Le miss', !!Le.a.miss, Le.a.len, Le.a.sha)
console.log('Ps miss', !!Ps.a.miss, Ps.a.len, Ps.a.sha)
