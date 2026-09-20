/**
 * #8 pass2c — lock Ws/Zvb (247 extra 1e4) uses vs 246;
 * persist callee 4-arg; bg-agent error attach templates.
 */
import { readFileSync, writeFileSync } from 'fs'

const buf247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const buf246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
)
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'

function asciiWindow(buf, start, end) {
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

function allHits(buf, needle, from = 0, to = buf.length) {
  const n = Buffer.from(needle)
  const hits = []
  let i = from
  while (i < to) {
    const j = buf.indexOf(n, i)
    if (j < 0 || j >= to) break
    hits.push(j)
    i = j + n.length
    if (hits.length > 120) break
  }
  return hits
}

function dump(name, text) {
  const body = text.endsWith('\n') ? text : `${text}\n`
  writeFileSync(`${outDir}/${name}`, body)
  console.log('WROTE', name, body.length)
}

function isIdentChar(c) {
  return (
    (c >= 65 && c <= 90) ||
    (c >= 97 && c <= 122) ||
    (c >= 48 && c <= 57) ||
    c === 36 ||
    c === 95
  )
}

function identHits(buf, ident) {
  const n = Buffer.from(ident)
  const hits = []
  let i = 0
  while (true) {
    const j = buf.indexOf(n, i)
    if (j < 0) break
    const prev = j > 0 ? buf[j - 1] : 0
    const next = buf[j + n.length]
    if (!isIdentChar(prev) && !isIdentChar(next)) hits.push(j)
    i = j + n.length
    if (hits.length > 80) break
  }
  return hits
}

function dumpIdent(buf, ident, ver, tag, max = 20) {
  const hits = identHits(buf, ident)
  console.log(ver, ident, 'identHits', hits.length)
  const lines = [`# ${ident} ver=${ver} hits=${hits.length}`]
  let dumped = 0
  hits.forEach((off, i) => {
    const s = asciiWindow(buf, Math.max(0, off - 100), off + 180)
    const ratio = (s.match(/[\t\n\r\x20-\x7e]/g) || []).length / s.length
    lines.push(`# h${i} off=${off} ratio=${ratio.toFixed(3)} ${JSON.stringify(s.replace(/\s+/g, ' ').slice(0, 160))}`)
    if (ratio >= 0.8 && dumped < max) {
      dump(
        `gold-8-pass2-${tag}-h${i}-${ver}.txt`,
        `# off=${off} ident=${ident}\n\n${s}\n`,
      )
      dumped++
    }
  })
  dump(`gold-8-pass2-${tag}-index-${ver}.txt`, lines.join('\n') + '\n')
}

// Import aliases of Ws
dumpIdent(buf247, 'Zvb', 247, 'Zvb')
dumpIdent(buf247, 'Ws', 247, 'Ws')

// Who imports Zvb / Ws as what?
for (const n of ['Zvb as ', 'as Zvb', 'Ws as ', ',Ws,', 'threshold:r=Ws', 'threshold:r=Zvb']) {
  const hits = allHits(buf247, n)
  console.log('247', JSON.stringify(n), hits.length, hits.slice(0, 6))
  hits.slice(0, 4).forEach((off, i) => {
    dump(
      `gold-8-pass2-use-${n.replace(/[^A-Za-z0-9]+/g, '')}-h${i}-247.txt`,
      `# off=${off} needle=${JSON.stringify(n)}\n\n${asciiWindow(buf247, Math.max(0, off - 150), off + 250)}\n`,
    )
  })
}

// 246 sibling: no Ws. Confirm Ds=50 was last-but-one, Bs=1e4 last.
// Is there a 246 twin of Ws?
for (const n of ['Ws=1e4', 'zs=1e4', 'Bs=1e4', ',Ws=1e4', 'var Ws=']) {
  console.log(
    JSON.stringify(n),
    '246',
    allHits(buf246, n).length,
    '247',
    allHits(buf247, n).length,
  )
}

// Complete family line
const fam247 = buf247.indexOf(Buffer.from('var We=50000,Ns=500000,Ds=4,Bs=400000,Us=200000,Hs=50,zs=1e4,Ws=1e4'))
const fam246 = buf246.indexOf(Buffer.from('var ze=50000,Ls=500000,Ms=4,Is=400000,Ns=200000,Ds=50,Bs=1e4'))
dump(
  'gold-8-pass2-family-line-247.txt',
  `# off=${fam247}\n\n${asciiWindow(buf247, fam247, fam247 + 220)}\n`,
)
dump(
  'gold-8-pass2-family-line-246.txt',
  `# off=${fam246}\n\n${asciiWindow(buf246, fam246, fam246 + 180)}\n`,
)

// Persist callee: search `async function VP(e,t,n` near lre, not the 1-arg VP
const lreOff = 218251306
const rneOff = 216793606
for (const n of [
  'async function VP(e,t,n',
  'function VP(e,t,n',
  'async function VP(e,t,n,r)',
  'async function AP(e,t,n,r)',
]) {
  console.log(
    JSON.stringify(n),
    '247',
    allHits(buf247, n),
    '246',
    allHits(buf246, n),
  )
}

function extractAfterParen(buf, off, maxLen = 8000) {
  const src = asciiWindow(buf, off, off + maxLen)
  const paren = src.indexOf('(')
  let depth = 0
  let i = paren
  let inStr = null
  let esc = false
  for (; i < src.length; i++) {
    const c = src[i]
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
        i++
        break
      }
    }
  }
  const brace = src.indexOf('{', i)
  depth = 0
  inStr = null
  esc = false
  for (let j = brace; j < src.length; j++) {
    const c = src[j]
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
      if (depth === 0) return src.slice(0, j + 1)
    }
  }
  return src.slice(0, 200)
}

const vp4 = allHits(buf247, 'async function VP(e,t,n')
const ap4 = allHits(buf246, 'async function AP(e,t,n')
console.log('vp4', vp4, 'ap4', ap4)
if (vp4[0] != null) {
  dump(
    'gold-8-pass2-VP4-247.txt',
    `# off=${vp4[0]}\n\n${extractAfterParen(buf247, vp4[0], 8000)}\n`,
  )
}
if (ap4[0] != null) {
  dump(
    'gold-8-pass2-AP4-246.txt',
    `# off=${ap4[0]}\n\n${extractAfterParen(buf246, ap4[0], 8000)}\n`,
  )
}

// Also try imported persist: maybe VP is imported
for (const n of ['VP as ', ' as VP', 'AP as ', ' as AP']) {
  console.log(
    JSON.stringify(n),
    '247',
    allHits(buf247, n).length,
    '246',
    allHits(buf246, n).length,
  )
}

// bg-agent conversation attach: look at unique "truncated at" and agent error
const uniqNeedles = [
  'truncated at ${r}',
  'truncated at ${',
  'output truncated',
  'slice(0,r)',
  'slice(0,Zvb',
  'slice(0,Ws',
  'length<=Zvb',
  'length<=Ws',
  'length>Zvb',
  'length>Ws',
  'threshold:r=Zvb',
  'threshold:r=Ws',
]
console.log('\n=== Zvb/Ws cap needles ===')
for (const n of uniqNeedles) {
  const a = allHits(buf246, n).length
  const b = allHits(buf247, n).length
  console.log(`${a}\t${b}\t${JSON.stringify(n)}${a !== b ? ' DIFF' : ''}`)
}

// Dump JS-looking Zvb / threshold uses already via ident dumps.

// Agent error templates — expand
for (const [ver, buf] of [
  [247, buf247],
  [246, buf246],
]) {
  for (const n of ['agent error:', 'Agent failed']) {
    const hits = allHits(buf, n)
    hits.forEach((off, i) => {
      dump(
        `gold-8-pass2-agerr-wide-${n.replace(/[^A-Za-z0-9]+/g, '-')}-h${i}-${ver}.txt`,
        `# off=${off}\n\n${asciiWindow(buf, Math.max(0, off - 800), off + 900)}\n`,
      )
    })
  }
}

// Local missing persist strings
console.log('\n=== persist event ===')
for (const n of [
  'tengu_hook_output_persisted',
  'persist-to-disk failed',
  'Hook ${n} truncated',
  'truncatedFallback',
]) {
  console.log(JSON.stringify(n), '246', allHits(buf246, n).length, '247', allHits(buf247, n).length)
}

// Confirm 247 family extra Ws is the ONLY added binding in that var list
dump(
  'gold-8-pass2-family-cmp.txt',
  [
    '# 247 complete initializer (extracted)',
    'var We=50000,Ns=500000,Ds=4,Bs=400000,Us=200000,Hs=50,zs=1e4,Ws=1e4',
    '# 246 complete initializer (extracted)',
    'var ze=50000,Ls=500000,Ms=4,Is=400000,Ns=200000,Ds=50,Bs=1e4',
    '# mapping (name-normalized by position):',
    '50000 500000 4 400000 200000 50 1e4 | 247 extra 1e4 (Ws)',
    `# offs 247=${fam247} 246=${fam246}`,
    '# JWr chain: zs=1e4 → export zs as Yvb → import Yvb as JWr → lre threshold default',
    '# BBr chain: Bs=1e4 → export Bs as lHb → import lHb as BBr → Rne threshold default',
    '# Persist default is 1e4 in BOTH. Extra 247 Ws=1e4 is a second binding.',
  ].join('\n') + '\n',
)

void lreOff
void rneOff
console.log('DONE pass2c')
