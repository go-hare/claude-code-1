/**
 * #8 pass2b — extract zs (247) / Bs (246) complete initializers
 * and the real persist callee (4-arg), plus bg-agent error attach.
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
    if (hits.length > 200) break
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

function identEqHits(buf, ident, from, to) {
  const n = Buffer.from(`${ident}=`)
  const hits = []
  let i = from
  while (i < to) {
    const j = buf.indexOf(n, i)
    if (j < 0 || j >= to) break
    const prev = j > 0 ? buf[j - 1] : 0
    if (!isIdentChar(prev)) hits.push(j)
    i = j + n.length
    if (hits.length > 80) break
  }
  return hits
}

// Defining modules
const expYvb = buf247.indexOf(Buffer.from('zs as Yvb'))
const expLhb = buf246.indexOf(Buffer.from('Bs as lHb'))
const mod247 = buf247.lastIndexOf(Buffer.from('// Version: 2.1.247'), expYvb)
const mod246 = buf246.lastIndexOf(Buffer.from('// Version: 2.1.246'), expLhb)
console.log({ expYvb, expLhb, mod247, mod246, span247: expYvb - mod247, span246: expLhb - mod246 })

dump(
  'gold-8-pass2-defmod-head-247.txt',
  `# mod=${mod247} export=${expYvb}\n\n${asciiWindow(buf247, mod247, mod247 + 1500)}\n`,
)
dump(
  'gold-8-pass2-defmod-head-246.txt',
  `# mod=${mod246} export=${expLhb}\n\n${asciiWindow(buf246, mod246, mod246 + 1500)}\n`,
)

// Dump complete export lists
dump(
  'gold-8-pass2-export-zs-Yvb-247.txt',
  `# off=${expYvb}\n\n${asciiWindow(buf247, expYvb - 400, expYvb + 200)}\n`,
)
dump(
  'gold-8-pass2-export-Bs-lHb-246.txt',
  `# off=${expLhb}\n\n${asciiWindow(buf246, expLhb - 400, expLhb + 200)}\n`,
)

// Search assignments of the inner names inside the defining module
const names247 = ['We', 'Ns', 'Ds', 'Bs', 'Us', 'Hs', 'zs', 'Ws']
const names246 = ['ze', 'Ls', 'Ms', 'Is', 'Ns', 'Ds', 'Bs']

function dumpAssigns(buf, names, from, to, ver, tag) {
  const lines = [`# ${tag} ver=${ver} range=${from}-${to}`]
  for (const name of names) {
    const hits = identEqHits(buf, name, from, to)
    lines.push(`${name}= hits=${hits.length} offs=${hits.join(',')}`)
    hits.slice(0, 8).forEach((off, i) => {
      const s = asciiWindow(buf, Math.max(from, off - 80), Math.min(to, off + 220))
      dump(
        `gold-8-pass2-init-${name}-h${i}-${ver}.txt`,
        `# off=${off} name=${name}\n\n${s}\n`,
      )
      lines.push(`  h${i} ${JSON.stringify(s.replace(/\s+/g, ' ').slice(0, 200))}`)
    })
  }
  dump(`gold-8-pass2-init-index-${ver}.txt`, lines.join('\n') + '\n')
}

dumpAssigns(buf247, names247, mod247, expYvb + 20, 247, 'defmod')
dumpAssigns(buf246, names246, mod246, expLhb + 20, 246, 'defmod')

// Also search var/const/let zs= in whole file with word boundary
for (const [ver, buf, ident] of [
  [247, buf247, 'zs'],
  [246, buf246, 'Bs'],
]) {
  const patterns = [`var ${ident}=`, `const ${ident}=`, `let ${ident}=`, `,${ident}=`, `;${ident}=`]
  for (const p of patterns) {
    const hits = allHits(buf, p)
    console.log(ver, JSON.stringify(p), hits.length, hits.slice(0, 8))
    hits.slice(0, 6).forEach((off, i) => {
      dump(
        `gold-8-pass2-pat-${p.replace(/[^A-Za-z0-9]+/g, '')}-h${i}-${ver}.txt`,
        `# off=${off} pat=${JSON.stringify(p)}\n\n${asciiWindow(buf, Math.max(0, off - 100), off + 250)}\n`,
      )
    })
  }
}

// Extract complete `var zs=...` / `var Bs=...` by scanning def module for numeric-looking inits
function extractCompleteInit(buf, ident, from, to) {
  const hits = identEqHits(buf, ident, from, to)
  return hits.map((off) => {
    // read until comma/semicolon/newline at depth 0
    let i = off + ident.length + 1
    let depth = 0
    let inStr = null
    let esc = false
    const start = off
    while (i < to && i < off + 500) {
      const c = buf[i]
      if (inStr) {
        if (esc) esc = false
        else if (c === 92) esc = true
        else if (c === inStr) inStr = null
        i++
        continue
      }
      if (c === 34 || c === 39 || c === 96) {
        inStr = c
        i++
        continue
      }
      if (c === 40 || c === 91 || c === 123) depth++
      else if (c === 41 || c === 93 || c === 125) depth--
      else if (depth <= 0 && (c === 44 || c === 59 || c === 10)) break
      i++
    }
    return {
      off,
      src: asciiWindow(buf, start, i),
    }
  })
}

const zsInits = extractCompleteInit(buf247, 'zs', mod247, expYvb + 20)
const bsInits = extractCompleteInit(buf246, 'Bs', mod246, expLhb + 20)
dump(
  'gold-8-pass2-zs-complete-247.txt',
  `# count=${zsInits.length}\n` +
    zsInits.map((x, i) => `# [${i}] off=${x.off}\n${x.src}`).join('\n\n') +
    '\n',
)
dump(
  'gold-8-pass2-Bs-complete-246.txt',
  `# count=${bsInits.length}\n` +
    bsInits.map((x, i) => `# [${i}] off=${x.off}\n${x.src}`).join('\n\n') +
    '\n',
)
console.log('zs inits', zsInits)
console.log('Bs inits', bsInits)

// Family inits (likely size constants sitting together)
function dumpFamily(buf, names, from, to, file) {
  const parts = []
  for (const name of names) {
    const inits = extractCompleteInit(buf, name, from, to)
    parts.push(`## ${name} count=${inits.length}`)
    for (const x of inits) parts.push(`# off=${x.off}\n${x.src}`)
  }
  dump(file, parts.join('\n\n') + '\n')
}
dumpFamily(buf247, names247, mod247, expYvb + 20, 'gold-8-pass2-family-247.txt')
dumpFamily(buf246, names246, mod246, expLhb + 20, 'gold-8-pass2-family-246.txt')

// Real persist callee: first 4-arg VP near lre, first 4-arg AP near Rne
function extractBraceFn(buf, off, maxLen = 6000) {
  const src = asciiWindow(buf, off, off + maxLen)
  // skip default-arg `={}` by finding the function body's first `{` after `)`
  const paren = src.indexOf('(')
  if (paren < 0) return { src: src.slice(0, 80), end: -1 }
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
  if (brace < 0) return { src: src.slice(0, 80), end: -1 }
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
      if (depth === 0) return { src: src.slice(0, j + 1), end: off + j + 1 }
    }
  }
  return { src: src.slice(0, 200), end: -1 }
}

const lreOff = buf247.indexOf(
  Buffer.from('async function lre(e,t,n,{threshold:r=JWr,storageV5:o}={})'),
)
const rneOff = buf246.indexOf(
  Buffer.from('async function Rne(e,t,n,{threshold:r=BBr,storageV5:o}={})'),
)
const lreFn = extractBraceFn(buf247, lreOff, 2500)
const rneFn = extractBraceFn(buf246, rneOff, 2500)
dump('gold-8-pass2-lre-complete-247.txt', `# off=${lreOff} len=${lreFn.src.length}\n\n${lreFn.src}\n`)
dump('gold-8-pass2-Rne-complete-246.txt', `# off=${rneOff} len=${rneFn.src.length}\n\n${rneFn.src}\n`)

// Find persist callee name from body: await VP( / await AP(
const vpCall = lreFn.src.match(/await ([A-Za-z_$][\w$]*)\(/)
const apCall = rneFn.src.match(/await ([A-Za-z_$][\w$]*)\(/)
console.log('persist callees', vpCall && vpCall[1], apCall && apCall[1])

function findFnNear(buf, name, near, back = 800000) {
  const needles = [`async function ${name}(`, `function ${name}(`]
  let best = -1
  for (const n of needles) {
    const hits = allHits(buf, n, Math.max(0, near - back), near)
    for (const h of hits) {
      if (h < near && h > best) best = h
    }
  }
  return best
}

if (vpCall) {
  const off = findFnNear(buf247, vpCall[1], lreOff)
  const fn = off >= 0 ? extractBraceFn(buf247, off, 8000) : { src: 'MISS' }
  dump(
    'gold-8-pass2-persist-callee-247.txt',
    `# name=${vpCall[1]} off=${off} len=${fn.src.length}\n\n${fn.src}\n`,
  )
  console.log('247 callee', vpCall[1], off, fn.src.length)
}
if (apCall) {
  const off = findFnNear(buf246, apCall[1], rneOff)
  const fn = off >= 0 ? extractBraceFn(buf246, off, 8000) : { src: 'MISS' }
  dump(
    'gold-8-pass2-persist-callee-246.txt',
    `# name=${apCall[1]} off=${off} len=${fn.src.length}\n\n${fn.src}\n`,
  )
  console.log('246 callee', apCall[1], off, fn.src.length)
}

// Background-agent ERROR attach: look at LocalAgentTask-ish strings
const bgErrNeedles = [
  'agent failed with',
  'Agent failed with',
  'background agent failed',
  'background agent error',
  'agent error:',
  'Agent error:',
  'error from background',
  'stderr from',
  'printed',
  'megabyte',
  'too long',
  'output was lost',
  'output file',
]
console.log('\n=== bg error string counts ===')
for (const n of bgErrNeedles) {
  const a = allHits(buf246, n).length
  const b = allHits(buf247, n).length
  if (a || b) console.log(`${a}\t${b}\t${JSON.stringify(n)}${a !== b ? ' DIFF' : ''}`)
}

for (const n of ['agent error:', 'Agent error:', 'agent failed', 'megabyte', 'output was lost']) {
  for (const [ver, buf] of [
    [247, buf247],
    [246, buf246],
  ]) {
    const hits = allHits(buf, n)
    hits.slice(0, 3).forEach((off, i) => {
      const s = asciiWindow(buf, Math.max(0, off - 500), off + 700)
      if ((s.match(/[\x20-\x7e]/g) || []).length / s.length < 0.75) return
      dump(
        `gold-8-pass2-bgerr-${n.replace(/[^A-Za-z0-9]+/g, '-')}-h${i}-${ver}.txt`,
        `# off=${off}\n\n${s}\n`,
      )
    })
  }
}

// Compare 247 vs 246 "agent error:" windows for a cap
{
  const a = buf246.indexOf(Buffer.from('agent error:'))
  const b = buf247.indexOf(Buffer.from('agent error:'))
  dump(
    'gold-8-pass2-agent-error-tpl-246.txt',
    `# off=${a}\n\n${asciiWindow(buf246, Math.max(0, a - 400), a + 600)}\n`,
  )
  dump(
    'gold-8-pass2-agent-error-tpl-247.txt',
    `# off=${b}\n\n${asciiWindow(buf247, Math.max(0, b - 400), b + 600)}\n`,
  )
}

console.log('DONE pass2b')
