import { readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const b247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const b246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
)

function asciiSlice(buf, start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
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
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    text.endsWith('\n') ? text : `${text}\n`,
  )
  console.log('WROTE', name, text.length)
}

function sha(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

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
      const keep = new Set([
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
      out += keep.has(id) ? id : 'ID'
      i = j
      continue
    }
    out += c
    i++
  }
  return out
}

function extractBraced(src, bracePos) {
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

function extractFromAssign(buf, assignNeedle, after = 25000) {
  const i = first(buf, assignNeedle)
  if (i < 0) return { miss: assignNeedle }
  const s = asciiSlice(buf, i, i + after)
  return { offset: i, src: s, sha: sha(s) }
}

const lines = ['# gold-1-sameness SendFeedback 247 vs 246', '']

const stringNeedles = [
  'Queue a draft feedback report about Claude Code (the product OR the model\'s own behavior in this session) for the user to review and send later. Nothing is sent anywhere by this tool: it writes a local draft the user can review, edit, and explicitly submit (or discard) via /feedback.',
  'Use this tool to draft feedback about Claude Code when you hit a high-signal moment. That includes both PRODUCT issues and MODEL-BEHAVIOR issues:',
  'Drafted by Claude via the SendFeedback tool; reviewed and approved by the user before sending.',
  'Drafted by Claude via the SendFeedback tool; approved by the user from the above-prompt card without full review.',
  'Model-drafted feedback (the SendFeedback tool). "notify" (default) shows a one-line notice when a draft is queued; "quiet" shows only the footer counter; "off" disables the tool entirely so drafts are never queued.',
  'title:e().describe("Sanitized one-line summary from the SendFeedback tool call.")',
  'Emitted by the SendFeedback tool after it writes a local draft',
  'var xgr="SendFeedback"',
  'var Dpr="SendFeedback"',
  'CLAUDE_CODE_SEND_FEEDBACK',
  'tengu_juniper_relay',
  'feedback_draft_queued',
  'Claude-drafted feedback',
]

lines.push('## exact string presence')
for (const n of stringNeedles) {
  const a = allHits(b246, n).length
  const b = allHits(b247, n).length
  lines.push(`${a === b ? 'same' : 'DIFF'} 246=${a} 247=${b} ${JSON.stringify(n).slice(0, 120)}`)
}

const toolAssign247 = first(b247, 'var xgr="SendFeedback"')
const toolAssign246 = first(b246, 'var Dpr="SendFeedback"')
lines.push('', `toolAssign 246=${toolAssign246} 247=${toolAssign247}`)

function extractToolModule(buf, assignAt) {
  if (assignAt < 0) return null
  const start = assignAt
  const raw = asciiSlice(buf, start, start + 40000)
  const endMark = raw.indexOf('function jfs(')
  const endMark2 = raw.indexOf('function yls(')
  const cut = endMark >= 0 ? endMark : endMark2 >= 0 ? endMark2 : 8000
  return raw.slice(0, cut)
}

const tool247 = extractToolModule(b247, toolAssign247)
const tool246 = extractToolModule(b246, toolAssign246)
if (tool247 && tool246) {
  dump('gold-1-tool-assign-247.txt', `# 247 @${toolAssign247} len=${tool247.length} sha=${sha(tool247)}\n\n${tool247}\n`)
  dump('gold-1-tool-assign-246.txt', `# 246 @${toolAssign246} len=${tool246.length} sha=${sha(tool246)}\n\n${tool246}\n`)
  const n247 = normalizeJs(tool247)
  const n246 = normalizeJs(tool246)
  lines.push(`tool-module raw sha 246=${sha(tool246)} 247=${sha(tool247)} equal=${tool246 === tool247}`)
  lines.push(`tool-module norm sha 246=${sha(n246)} 247=${sha(n247)} equal=${n246 === n247}`)
  lines.push(`tool-module raw len 246=${tool246.length} 247=${tool247.length}`)
  if (n246 !== n247) {
    dump('gold-1-tool-norm-247.txt', n247)
    dump('gold-1-tool-norm-246.txt', n246)
  }
}

const gate247 = first(b247, 'CLAUDE_CODE_SEND_FEEDBACK')
const gate246 = first(b246, 'CLAUDE_CODE_SEND_FEEDBACK')
function gateWindow(buf, hit) {
  const hits = allHits(buf, 'CLAUDE_CODE_SEND_FEEDBACK')
  return hits.map((i) => {
    const s = asciiSlice(buf, i - 400, i + 500)
    return { i, s, sha: sha(s), norm: sha(normalizeJs(s)) }
  })
}
const g247 = gateWindow(b247, gate247)
const g246 = gateWindow(b246, gate246)
lines.push('', '## CLAUDE_CODE_SEND_FEEDBACK windows')
lines.push(`246 hits=${g246.length} 247 hits=${g247.length}`)
g246.forEach((g, i) => lines.push(`  246#${i} @${g.i} sha=${g.sha} norm=${g.norm}`))
g247.forEach((g, i) => lines.push(`  247#${i} @${g.i} sha=${g.sha} norm=${g.norm}`))
if (g247[0] && g246[0]) {
  dump('gold-1-gate-247.txt', `# 247 @${g247[0].i}\n\n${g247[0].s}\n`)
  dump('gold-1-gate-246.txt', `# 246 @${g246[0].i}\n\n${g246[0].s}\n`)
}

function schemaField(buf, verName) {
  const needle =
    'feedbackDrafts:m(["notify","quiet","off"]).optional().describe(\'Model-drafted feedback (the SendFeedback tool).'
  const i = first(buf, needle)
  if (i < 0) {
    const alt = first(buf, 'feedbackDrafts:m(["notify","quiet","off"])')
    return { i: alt, s: alt < 0 ? '' : asciiSlice(buf, alt, alt + 420) }
  }
  return { i, s: asciiSlice(buf, i, i + 420) }
}
const sch247 = schemaField(b247, '247')
const sch246 = schemaField(b246, '246')
lines.push('', '## feedbackDrafts schema field')
lines.push(`246 @${sch246.i} sha=${sha(sch246.s)}`)
lines.push(`247 @${sch247.i} sha=${sha(sch247.s)} equal=${sch246.s === sch247.s}`)
dump('gold-1-schema-247.txt', `# 247 @${sch247.i}\n\n${sch247.s}\n`)
dump('gold-1-schema-246.txt', `# 246 @${sch246.i}\n\n${sch246.s}\n`)

function loadFn(name) {
  return readFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    'utf8',
  )
    .split('\n')
    .slice(2)
    .join('\n')
}

const pairs = [
  ['gold-1-fn-246-Ds-206395082.txt', 'gold-1-fn-247-Ls-207996006.txt', 'schema-Ls-Ds'],
  ['gold-1-fn-246-pa-224017492.txt', 'gold-1-fn-247-pa-225091429.txt', 'config-pa'],
  ['gold-1-fn-246-uu-233729822.txt', 'gold-1-fn-247-mu-235799399.txt', 'mu-uu'],
  ['gold-1-fn-246-lls-215139056.txt', 'gold-1-fn-247-Mfs-216520641.txt', 'list-Mfs'],
  ['gold-1-fn-246-vpr-215141832.txt', 'gold-1-fn-247-bgr-216523417.txt', 'write-bgr'],
  ['gold-1-fn-246-mls-215147649.txt', 'gold-1-fn-247-Ffs-216529234.txt', 'get-Ffs'],
  ['gold-1-fn-246-ipc-215148087.txt', 'gold-1-fn-247-Ewc-216529672.txt', 'set-Ewc'],
  ['gold-1-fn-246-yqe-230877278.txt', 'gold-1-fn-247-vqe-233009201.txt', 'prompt-vqe'],
  ['gold-1-fn-246-xne-230877349.txt', 'gold-1-fn-247-ore-233009272.txt', 'decline-ore'],
]

lines.push('', '## normalized pair compare')
for (const [a, b, label] of pairs) {
  const sa = loadFn(a)
  const sb = loadFn(b)
  const na = normalizeJs(sa)
  const nb = normalizeJs(sb)
  const rawEq = sa === sb
  const normEq = na === nb
  lines.push(
    `${normEq ? 'NORM-SAME' : 'NORM-DIFF'} ${label} rawEq=${rawEq} rawLen=${sa.length}/${sb.length} normLen=${na.length}/${nb.length} normSha=${sha(na)}/${sha(nb)}`,
  )
  if (!normEq) {
    dump(`gold-1-norm-${label}-246.txt`, na)
    dump(`gold-1-norm-${label}-247.txt`, nb)
    let firstDiff = -1
    const lim = Math.min(na.length, nb.length)
    for (let i = 0; i < lim; i++) {
      if (na[i] !== nb[i]) {
        firstDiff = i
        break
      }
    }
    lines.push(
      `  firstDiff=${firstDiff} 246[+${Math.max(0, na.length - nb.length)}] 247[+${Math.max(0, nb.length - na.length)}]`,
    )
    if (firstDiff >= 0) {
      dump(
        `gold-1-norm-${label}-diffwin.txt`,
        `# firstDiff=${firstDiff}\n\n---246---\n${na.slice(Math.max(0, firstDiff - 200), firstDiff + 400)}\n\n---247---\n${nb.slice(Math.max(0, firstDiff - 200), firstDiff + 400)}\n`,
      )
    }
  }
}

const implNeedles = [
  'async function',
  'name:xgr',
  'name:Dpr',
  'name: xgr',
]

function findToolCall(buf, assignAt) {
  const window = asciiSlice(buf, assignAt, assignAt + 30000)
  const markers = [
    'name:xgr',
    'name:Dpr',
    'call:async',
    'async call(',
    'async(e,t)',
    'isEnabled:',
    'isEnabled()',
  ]
  const found = {}
  for (const m of markers) {
    found[m] = window.indexOf(m)
  }
  return { found, window: window.slice(0, 12000) }
}

lines.push('', '## tool object after assign')
if (toolAssign247 >= 0 && toolAssign246 >= 0) {
  const t247 = findToolCall(b247, toolAssign247)
  const t246 = findToolCall(b246, toolAssign246)
  lines.push(`247 markers ${JSON.stringify(t247.found)}`)
  lines.push(`246 markers ${JSON.stringify(t246.found)}`)
}

const unique247 = []
const probe = [
  'SendFeedback tool',
  'feedbackDrafts setting',
  'turn off with the feedbackDrafts',
  'Claude can draft a feedback report',
  'review and send from /feedback',
]
lines.push('', '## changelog-index strings unique to 247?')
for (const n of probe) {
  const a = allHits(b246, n).length
  const b = allHits(b247, n).length
  lines.push(`${a === b ? 'same' : 'DIFF'} 246=${a} 247=${b} ${JSON.stringify(n)}`)
  if (b > a) unique247.push(n)
}

dump('gold-1-sameness.txt', lines.join('\n'))
console.log('unique247 changelog probes', unique247)

function extractCall(buf, assignNeedle) {
  const i = buf.indexOf(Buffer.from(assignNeedle))
  if (i < 0) return { i, miss: true }
  const win = asciiSlice(buf, i, i + 20000)
  const k = win.indexOf('async call(')
  if (k < 0) return { i, missCall: true, preview: win.slice(5500, 7500) }
  const src = win.slice(k)
  let depth = 0
  let inStr = null
  let esc = false
  let end = -1
  for (let p = 0; p < src.length; p++) {
    const c = src[p]
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
        end = p + 1
        break
      }
    }
  }
  const body = end > 0 ? src.slice(0, end) : src.slice(0, 4000)
  return { i, k, end, body, sha: sha(body), len: body.length }
}

const call246 = extractCall(b246, 'var Dpr="SendFeedback"')
const call247 = extractCall(b247, 'var xgr="SendFeedback"')
dump(
  'gold-1-call-246.txt',
  `# 246 assign=${call246.i} rel=${call246.k} len=${call246.len} sha=${call246.sha}\n\n${call246.body || call246.preview || ''}\n`,
)
dump(
  'gold-1-call-247.txt',
  `# 247 assign=${call247.i} rel=${call247.k} len=${call247.len} sha=${call247.sha}\n\n${call247.body || call247.preview || ''}\n`,
)
if (call246.body && call247.body) {
  const na = normalizeJs(call246.body)
  const nb = normalizeJs(call247.body)
  console.log('call rawEq', call246.body === call247.body, call246.len, call247.len)
  console.log('call normEq', na === nb, sha(na), sha(nb))
  dump(
    'gold-1-call-compare.txt',
    `# call 246 sha=${call246.sha} len=${call246.len}\n# call 247 sha=${call247.sha} len=${call247.len}\n# rawEq=${call246.body === call247.body}\n# normEq=${na === nb}\n# normSha 246=${sha(na)} 247=${sha(nb)}\n`,
  )
}
