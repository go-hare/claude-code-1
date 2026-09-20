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

function extractFunction(buf, name) {
  const needle = `function ${name}(`
  const i = first(buf, needle)
  if (i < 0) return { miss: name }
  const win = asciiSlice(buf, i, i + 8000)
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

function extractCallExpr(src, startNeedle) {
  const k = src.indexOf(startNeedle)
  if (k < 0) return null
  const from = src.indexOf('(', k)
  if (from < 0) return null
  let depth = 0
  let inStr = null
  let esc = false
  for (let p = from; p < src.length; p++) {
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
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return src.slice(k, p + 1)
    }
    if (c === '{') {
      let bd = 1
      p++
      while (p < src.length && bd > 0) {
        const d = src[p]
        if (inStr) {
          if (esc) esc = false
          else if (d === '\\') esc = true
          else if (d === inStr) inStr = null
        } else if (d === '"' || d === "'" || d === '`') inStr = d
        else if (d === '{') bd++
        else if (d === '}') bd--
        if (bd > 0) p++
      }
    }
  }
  return null
}

function toolKeys(src) {
  const keys = []
  const re =
    /(?:^|[,{])\s*(async\s+)?(get\s+)?([A-Za-z_$][\w$]*)\s*(\(|:)/g
  let m
  while ((m = re.exec(src))) {
    keys.push((m[1] || '') + (m[2] || '') + m[3])
  }
  return keys
}

const lines = ['# gold-1-pass2 send-feedback registry / wiring', '']

// --- 1. isEnabled wrappers + session gates ---
const aLt = extractFunction(b247, 'aLt')
const gDt = extractFunction(b246, 'gDt')
const Ufs = extractFunction(b247, 'Ufs')
const gls = extractFunction(b246, 'gls')
const Ffs = extractFunction(b247, 'Ffs')
const mls = extractFunction(b246, 'mls')

function pair(label, a, b) {
  const aBody = a.body || ''
  const bBody = b.body || ''
  const na = normalizeJs(aBody)
  const nb = normalizeJs(bBody)
  lines.push(
    `${na === nb ? 'NORM-SAME' : 'NORM-DIFF'} ${label} rawEq=${aBody === bBody} rawLen=${aBody.length}/${bBody.length} normSha=${sha(na)}/${sha(nb)} miss=${!!a.miss || !!b.miss}`,
  )
  return { a, b, na, nb, normEq: na === nb }
}

lines.push('## 1. isEnabled / settings-default / session gate')
const pEnabled = pair('isEnabled-wrapper aLt/gDt', aLt, gDt)
const pGet = pair('get-feedbackDrafts Ffs/mls', Ffs, mls)
const pGate = pair('session-gate Ufs/gls', Ufs, gls)
dump(
  'gold-1-pass2-aLt-247.txt',
  `# 247 aLt @${aLt.i} sha=${aLt.sha}\n\n${aLt.body || ''}\n`,
)
dump(
  'gold-1-pass2-gDt-246.txt',
  `# 246 gDt @${gDt.i} sha=${gDt.sha}\n\n${gDt.body || ''}\n`,
)
dump(
  'gold-1-pass2-Ufs-247.txt',
  `# 247 Ufs @${Ufs.i} sha=${Ufs.sha}\n\n${Ufs.body || ''}\n`,
)
dump(
  'gold-1-pass2-gls-246.txt',
  `# 246 gls @${gls.i} sha=${gls.sha}\n\n${gls.body || ''}\n`,
)

// --- 2. full Gt/Ht tool object keys ---
const hint = 'searchHint:"draft product or model-behavior feedback report queue"'
const h247 = first(b247, hint)
const h246 = first(b246, hint)
function extractToolObj(buf, hintAt) {
  const back = asciiSlice(buf, hintAt - 80, hintAt + 12000)
  const assign = back.search(/[A-Za-z_$][\w$]*=[A-Za-z_$][\w$]*\(\{name:/)
  const src = assign >= 0 ? back.slice(assign) : back
  const call = extractCallExpr(src, src.slice(0, 20).includes('=') ? src.match(/^[A-Za-z_$][\w$]*=/)[0] : 'Gt(')
  // simpler: from first `={` after name
  const nameAt = src.indexOf('{name:')
  if (nameAt < 0) return { miss: true, src: src.slice(0, 200) }
  let depth = 0
  let inStr = null
  let esc = false
  for (let p = nameAt; p < src.length; p++) {
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
        const obj = src.slice(nameAt, p + 1)
        const head = src.slice(0, nameAt)
        return { head, obj, sha: sha(obj), len: obj.length }
      }
    }
  }
  return { missEnd: true, src: src.slice(0, 300) }
}
const obj247 = extractToolObj(b247, h247)
const obj246 = extractToolObj(b246, h246)
const nObj247 = obj247.obj ? normalizeJs(obj247.obj) : ''
const nObj246 = obj246.obj ? normalizeJs(obj246.obj) : ''
lines.push('', '## 2. tool object keys (Gt/Ht)')
lines.push(`hint 246=@${h246} 247=@${h247}`)
lines.push(`obj rawLen 246=${obj246.len} 247=${obj247.len} rawEq=${obj246.obj === obj247.obj}`)
lines.push(`obj normEq=${nObj246 === nObj247} normSha 246=${sha(nObj246)} 247=${sha(nObj247)}`)
const keys247 = obj247.obj ? toolKeys(obj247.obj) : []
const keys246 = obj246.obj ? toolKeys(obj246.obj) : []
lines.push(`keys247 ${JSON.stringify(keys247)}`)
lines.push(`keys246 ${JSON.stringify(keys246)}`)
const keySet247 = new Set(keys247)
const keySet246 = new Set(keys246)
const only247 = [...keySet247].filter((k) => !keySet246.has(k))
const only246 = [...keySet246].filter((k) => !keySet247.has(k))
lines.push(`keys-only-247 ${JSON.stringify(only247)}`)
lines.push(`keys-only-246 ${JSON.stringify(only246)}`)
const gateKeys = [
  'alwaysLoad',
  'shouldDefer',
  'isDeferredTool',
  'isEnabled',
  'feature',
]
for (const k of gateKeys) {
  lines.push(
    `key ${k} 246=${obj246.obj?.includes(k) ? 1 : 0} 247=${obj247.obj?.includes(k) ? 1 : 0}`,
  )
}
dump(
  'gold-1-pass2-toolobj-247.txt',
  `# 247 hint@${h247} len=${obj247.len} sha=${obj247.sha} head=${obj247.head}\n\n${obj247.obj || ''}\n`,
)
dump(
  'gold-1-pass2-toolobj-246.txt',
  `# 246 hint@${h246} len=${obj246.len} sha=${obj246.sha} head=${obj246.head}\n\n${obj246.obj || ''}\n`,
)

// --- 3. alwaysLoad / feature() near SendFeedback (not global recount) ---
lines.push('', '## 3. alwaysLoad / feature / defer near SendFeedback assign')
function nearAssign(buf, assignNeedle, radius) {
  const i = first(buf, assignNeedle)
  if (i < 0) return { i, miss: true }
  const s = asciiSlice(buf, i, i + radius)
  return {
    i,
    alwaysLoad: (s.match(/alwaysLoad/g) || []).length,
    shouldDefer: (s.match(/shouldDefer/g) || []).length,
    featureCall: (s.match(/feature\(/g) || []).length,
    FEATURE: (s.match(/FEATURE_/g) || []).length,
    isDeferred: (s.match(/isDeferred/g) || []).length,
  }
}
const near247 = nearAssign(b247, 'var xgr="SendFeedback"', 20000)
const near246 = nearAssign(b246, 'var Dpr="SendFeedback"', 20000)
lines.push(`near-assign-20k 246=${JSON.stringify(near246)}`)
lines.push(`near-assign-20k 247=${JSON.stringify(near247)}`)

// --- 4. tool-var registry wiring ---
// 247 tool var is $gr ; 246 is Upr
function identHits(buf, ident) {
  const hits = allHits(buf, ident)
  const out = []
  for (const i of hits) {
    const prev = i > 0 ? buf[i - 1] : 0
    const next = buf[i + ident.length] || 0
    const isId = (c) =>
      (c >= 65 && c <= 90) ||
      (c >= 97 && c <= 122) ||
      (c >= 48 && c <= 57) ||
      c === 36 ||
      c === 95
    if (isId(prev) || isId(next)) continue
    const win = asciiSlice(buf, Math.max(0, i - 80), i + ident.length + 80)
    const js =
      win.includes('function') ||
      win.includes('return') ||
      win.includes('=>') ||
      win.includes('var ') ||
      win.includes(',')
    out.push({ i, win, js })
  }
  return out
}

const hitsGr = identHits(b247, '$gr')
const hitsUpr = identHits(b246, 'Upr')
lines.push('', '## 4. tool-var identifier hits ($gr / Upr)')
lines.push(`$gr ident hits=${hitsGr.length} js=${hitsGr.filter((h) => h.js).length}`)
lines.push(`Upr ident hits=${hitsUpr.length} js=${hitsUpr.filter((h) => h.js).length}`)

function classify(win) {
  if (win.includes('=Gt(') || win.includes('=Ht(')) return 'assign-factory'
  if (win.includes('{name:')) return 'assign-object'
  if (/\[\s*\$gr\s*\]|\[\s*Upr\s*\]/.test(win)) return 'array-spread-or-index'
  if (win.includes(',$gr,') || win.includes(',Upr,')) return 'list-mid'
  if (win.includes('$gr,') || win.includes('Upr,')) return 'list-or-arg'
  if (win.includes('return $gr') || win.includes('return Upr')) return 'return'
  return 'other'
}

const class247 = {}
const class246 = {}
hitsGr.forEach((h) => {
  const c = classify(h.win)
  class247[c] = (class247[c] || 0) + 1
})
hitsUpr.forEach((h) => {
  const c = classify(h.win)
  class246[c] = (class246[c] || 0) + 1
})
lines.push(`$gr classes ${JSON.stringify(class247)}`)
lines.push(`Upr classes ${JSON.stringify(class246)}`)

const interesting247 = hitsGr.filter((h) => classify(h.win) !== 'assign-factory')
const interesting246 = hitsUpr.filter((h) => classify(h.win) !== 'assign-factory')
let wiringTxt = ['# gold-1-pass2 tool-var wiring windows', '']
wiringTxt.push('## 247 $gr')
interesting247.slice(0, 40).forEach((h, n) => {
  wiringTxt.push(`--- 247#${n} @${h.i} class=${classify(h.win)} ---`)
  wiringTxt.push(h.win.replace(/\n/g, ' '))
  wiringTxt.push('')
})
wiringTxt.push('## 246 Upr')
interesting246.slice(0, 40).forEach((h, n) => {
  wiringTxt.push(`--- 246#${n} @${h.i} class=${classify(h.win)} ---`)
  wiringTxt.push(h.win.replace(/\n/g, ' '))
  wiringTxt.push('')
})
dump('gold-1-pass2-toolvar-windows.txt', wiringTxt.join('\n'))

// Look for getAllBaseTools-style lists containing the tool var.
function findListWindows(buf, ident) {
  const hits = identHits(buf, ident)
  const lists = []
  for (const h of hits) {
    const big = asciiSlice(buf, Math.max(0, h.i - 1500), h.i + 800)
    if (
      big.includes('AgentTool') ||
      big.includes('BashTool') ||
      big.includes('getAllBaseTools') ||
      big.includes('FileRead') ||
      /return\s*\[/.test(big) ||
      big.includes('...[')
    ) {
      lists.push({ i: h.i, s: big })
    }
  }
  return lists
}
const list247 = findListWindows(b247, '$gr')
const list246 = findListWindows(b246, 'Upr')
lines.push(`registry-list-windows 246=${list246.length} 247=${list247.length}`)
if (list247[0]) {
  dump(
    'gold-1-pass2-registry-247.txt',
    `# 247 $gr @${list247[0].i}\n\n${list247[0].s}\n`,
  )
}
if (list246[0]) {
  dump(
    'gold-1-pass2-registry-246.txt',
    `# 246 Upr @${list246[0].i}\n\n${list246[0].s}\n`,
  )
}

// --- 5. quoted "SendFeedback" tbl/export (not the var assign) ---
lines.push('', '## 5. quoted SendFeedback sites besides var assign')
function quotedWindows(buf, ver) {
  const hits = allHits(buf, '"SendFeedback"')
  return hits.map((i) => {
    const s = asciiSlice(buf, Math.max(0, i - 400), i + 200)
    const js = s.includes('var ') || s.includes('function') || s.includes('=Gt')
    return { i, js, s }
  })
}
const q247 = quotedWindows(b247, '247')
const q246 = quotedWindows(b246, '246')
lines.push(`quoted SendFeedback 246=${q246.length} 247=${q247.length}`)
q246.forEach((q, i) =>
  lines.push(`  246#${i} @${q.i} js=${q.js} sha=${sha(q.s)}`),
)
q247.forEach((q, i) =>
  lines.push(`  247#${i} @${q.i} js=${q.js} sha=${sha(q.s)}`),
)
q247.forEach((q, i) =>
  dump(`gold-1-pass2-quoted-247-${i}.txt`, `# 247 @${q.i} js=${q.js}\n\n${q.s}\n`),
)
q246.forEach((q, i) =>
  dump(`gold-1-pass2-quoted-246-${i}.txt`, `# 246 @${q.i} js=${q.js}\n\n${q.s}\n`),
)

// normalize non-assign quoted windows
const nq247 = q247.filter((q) => !q.js).map((q) => normalizeJs(q.s))
const nq246 = q246.filter((q) => !q.js).map((q) => normalizeJs(q.s))
if (nq247[0] && nq246[0]) {
  lines.push(
    `quoted-tbl normEq=${nq247[0] === nq246[0]} sha246=${sha(nq246[0])} sha247=${sha(nq247[0])}`,
  )
}

// --- 6. settings default still notify; off disables ---
lines.push('', '## 6. settings default / off-disable (already pass1, confirm)')
lines.push(`Ffs body ${JSON.stringify(Ffs.body)}`)
lines.push(`mls body ${JSON.stringify(mls.body)}`)
lines.push(`aLt body ${JSON.stringify(aLt.body)}`)
lines.push(`gDt body ${JSON.stringify(gDt.body)}`)

// --- 7. leftover pins untouched ---
lines.push('', '## 7. leftover pins (qb / qF / blu / Slu) — not SendFeedback')
for (const n of ['function qb(', 'function qF(', 'function blu(', 'function Slu(']) {
  lines.push(
    `pin ${JSON.stringify(n)} 246=${allHits(b246, n).length} 247=${allHits(b247, n).length}`,
  )
}

dump('gold-1-pass2-verdict.txt', lines.join('\n'))
console.log(lines.join('\n'))
