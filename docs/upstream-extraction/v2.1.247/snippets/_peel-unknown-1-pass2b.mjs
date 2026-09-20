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

function first(buf, needle) {
  return buf.indexOf(Buffer.from(needle))
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

const lines = ['# gold-1-pass2b getAllBaseTools / feature / CORE_TOOLS', '']

const mid247 = first(b247, 'J7,$gr,oee,g2e,...[]')
const mid246 = first(b246, 'A7,Upr,D7,lGe,...[]')
lines.push(`list-mid needle 246=@${mid246} 247=@${mid247}`)

function extractArrayFn(buf, mid) {
  if (mid < 0) return { miss: true }
  const before = 12000
  const after = 4000
  const start = Math.max(0, mid - before)
  const win = asciiSlice(buf, start, mid + after)
  const rel = mid - start
  let fnAt = -1
  for (let i = rel; i >= 0; i--) {
    if (win.startsWith('function ', i) || win.startsWith('function(', i)) {
      fnAt = i
      break
    }
  }
  const slice = fnAt >= 0 ? win.slice(fnAt) : win
  // walk to matching end of function if we found it
  let body = slice
  if (fnAt >= 0) {
    const brace = slice.indexOf('{')
    let depth = 0
    let inStr = null
    let esc = false
    for (let p = brace; p < slice.length; p++) {
      const c = slice[p]
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
          body = slice.slice(0, p + 1)
          break
        }
      }
    }
  }
  return { mid, fnAt, body, sha: sha(body), len: body.length, win }
}

const fn247 = extractArrayFn(b247, mid247)
const fn246 = extractArrayFn(b246, mid246)
const n247 = normalizeJs(fn247.body || '')
const n246 = normalizeJs(fn246.body || '')
lines.push(
  `getAllBaseTools-ish rawLen 246=${fn246.len} 247=${fn247.len} rawEq=${fn246.body === fn247.body}`,
)
lines.push(
  `normEq=${n246 === n247} normLen=${n246.length}/${n247.length} sha246=${sha(n246)} sha247=${sha(n247)}`,
)

if (n246 !== n247) {
  let firstDiff = -1
  const lim = Math.min(n246.length, n247.length)
  for (let i = 0; i < lim; i++) {
    if (n246[i] !== n247[i]) {
      firstDiff = i
      break
    }
  }
  lines.push(`norm firstDiff=${firstDiff} dLen=${n247.length - n246.length}`)
  dump(
    'gold-1-pass2-toolsfn-diffwin.txt',
    `# firstDiff=${firstDiff}\n\n---246---\n${n246.slice(Math.max(0, firstDiff - 250), firstDiff + 450)}\n\n---247---\n${n247.slice(Math.max(0, firstDiff - 250), firstDiff + 450)}\n`,
  )
}

dump(
  'gold-1-pass2-toolsfn-247.txt',
  `# 247 mid=@${mid247} fnAt=${fn247.fnAt} len=${fn247.len} sha=${fn247.sha}\n\n${fn247.body || ''}\n`,
)
dump(
  'gold-1-pass2-toolsfn-246.txt',
  `# 246 mid=@${mid246} fnAt=${fn246.fnAt} len=${fn246.len} sha=${fn246.sha}\n\n${fn246.body || ''}\n`,
)

// Slot context: is $gr / Upr feature-ternary or unconditional?
function slot(win, ident) {
  const i = win.indexOf(`,${ident},`)
  if (i < 0) return { miss: true }
  return {
    around: win.slice(Math.max(0, i - 180), i + ident.length + 180),
    ternaryBefore: win.slice(Math.max(0, i - 80), i).includes('?'),
    spreadConditional: new RegExp(`\\.\\.\\.[^,]{0,40}\\?\\[${ident}\\]`).test(
      win,
    ),
    featureNear: win.slice(Math.max(0, i - 200), i + 200).includes('feature('),
  }
}
const s247 = slot(fn247.body || fn247.win || '', '$gr')
const s246 = slot(fn246.body || fn246.win || '', 'Upr')
lines.push('', '## slot')
lines.push(`247 ${JSON.stringify({ ...s247, around: undefined })}`)
lines.push(`246 ${JSON.stringify({ ...s246, around: undefined })}`)
dump(
  'gold-1-pass2-slot-247.txt',
  `# 247\n\n${s247.around || 'MISS'}\n`,
)
dump(
  'gold-1-pass2-slot-246.txt',
  `# 246\n\n${s246.around || 'MISS'}\n`,
)

// Feature-flag / settings-name probes that pass1 did not treat as changelog-index
lines.push('', '## feature / alwaysLoad name probes (new angle, not pass1 needles)')
const probes = [
  'SEND_FEEDBACK',
  'FEATURE_SEND_FEEDBACK',
  'alwaysLoad:!0',
  'alwaysLoad:true',
  'alwaysLoad:!1',
  'alwaysLoad:false',
  'feedbackDrafts:"notify"',
  "feedbackDrafts:'notify'",
  'feedbackDrafts:"off"',
  'juniper_relay',
  'allow_product_feedback',
]
for (const n of probes) {
  const a = allHits(b246, n).length
  const b = allHits(b247, n).length
  lines.push(`${a === b ? 'same' : 'DIFF'} 246=${a} 247=${b} ${JSON.stringify(n)}`)
}

// CORE_TOOLS-ish name table: expand both quoted windows and compare neighbors
const t247 = first(b247, '"SendFeedback"')
const t246 = first(b246, '"SendFeedback"')
const tbl247 = asciiSlice(b247, t247 - 800, t247 + 400)
const tbl246 = asciiSlice(b246, t246 - 800, t246 + 400)
const nt247 = normalizeJs(tbl247)
const nt246 = normalizeJs(tbl246)
lines.push('', '## CORE_TOOLS-ish quoted table')
lines.push(`tbl rawEq=${tbl247 === tbl246} normEq=${nt247 === nt246}`)
lines.push(`tbl sha246=${sha(tbl246)} sha247=${sha(tbl247)}`)
dump('gold-1-pass2-nametable-247.txt', `# 247 @${t247}\n\n${tbl247}\n`)
dump('gold-1-pass2-nametable-246.txt', `# 246 @${t246}\n\n${tbl246}\n`)

// Confirm local has no SendFeedback tool in tools.ts / builtin-tools
lines.push('', '## leftover pins (constraint only; not a SendFeedback body)')
lines.push('empty qb / no auto qF / blu !== Slu — not used as SendFeedback evidence')

dump('gold-1-pass2b-verdict.txt', lines.join('\n'))
console.log(lines.join('\n'))
