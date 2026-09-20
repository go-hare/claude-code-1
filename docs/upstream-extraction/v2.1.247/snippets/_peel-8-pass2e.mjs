/**
 * #8 pass2e — Pc(e,t=Mue) complete body; 246 twin; call sites near hook/agent.
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

function allHits(buf, needle) {
  const n = Buffer.from(needle)
  const hits = []
  let i = 0
  while (true) {
    const j = buf.indexOf(n, i)
    if (j < 0) break
    hits.push(j)
    i = j + n.length
    if (hits.length > 80) break
  }
  return hits
}

function dump(name, text) {
  const body = text.endsWith('\n') ? text : `${text}\n`
  writeFileSync(`${outDir}/${name}`, body)
  console.log('WROTE', name, body.length)
}

function extractFn(buf, off, maxLen = 2500) {
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
  return src.slice(0, 400)
}

const needles = [
  'characters truncated',
  'function Pc(e,t=Mue)',
  'function Pc(',
  't=Mue)',
  'Math.floor(t/2)',
  'error text',
  'errorText',
]
console.log('=== counts ===')
for (const n of needles) {
  console.log(
    JSON.stringify(n),
    '246',
    allHits(buf246, n).length,
    '247',
    allHits(buf247, n).length,
  )
}

const pcOff = buf247.indexOf(Buffer.from('function Pc(e,t=Mue)'))
dump(
  'gold-8-pass2-Pc-complete-247.txt',
  `# off=${pcOff}\n\n${pcOff < 0 ? 'MISS' : extractFn(buf247, pcOff, 1500)}\n`,
)
dump(
  'gold-8-pass2-Pc-win-247.txt',
  `# off=${pcOff}\n\n${asciiWindow(buf247, Math.max(0, pcOff - 200), pcOff + 800)}\n`,
)

// 246 twins
for (const n of [
  'characters truncated',
  'function Pc(e,t=',
  'Math.floor(t/2)',
  '[${e} characters truncated]',
]) {
  const a = allHits(buf246, n)
  const b = allHits(buf247, n)
  console.log('hits', JSON.stringify(n), a, b)
  a.slice(0, 4).forEach((off, i) => {
    dump(
      `gold-8-pass2-trunc-twin-h${i}-246.txt`,
      `# off=${off} needle=${JSON.stringify(n)}\n\n${asciiWindow(buf246, Math.max(0, off - 250), off + 400)}\n`,
    )
  })
  b.slice(0, 4).forEach((off, i) => {
    dump(
      `gold-8-pass2-trunc-twin-h${i}-247.txt`,
      `# off=${off} needle=${JSON.stringify(n)}\n\n${asciiWindow(buf247, Math.max(0, off - 250), off + 400)}\n`,
    )
  })
}

// Pc call sites
const pcCalls = allHits(buf247, 'Pc(')
console.log('Pc( hits 247', pcCalls.length)
let dumped = 0
pcCalls.forEach((off, i) => {
  const s = asciiWindow(buf247, Math.max(0, off - 180), off + 220)
  const ratio = (s.match(/[\t\n\r\x20-\x7e]/g) || []).length / s.length
  if (ratio < 0.85) return
  if (dumped < 20) {
    dump(`gold-8-pass2-Pccall-h${dumped}-247.txt`, `# off=${off} hit=${i}\n\n${s}\n`)
    dumped++
  }
})

// 246 likely same helper under another name: search the exact template
const tpl = 'characters truncated] ... `'
for (const [ver, buf] of [
  [247, buf247],
  [246, buf246],
]) {
  const hits = allHits(buf, tpl)
  console.log(ver, 'tpl', hits)
  hits.forEach((off, i) => {
    dump(
      `gold-8-pass2-midtrunc-tpl-h${i}-${ver}.txt`,
      `# off=${off}\n\n${asciiWindow(buf, Math.max(0, off - 300), off + 500)}\n`,
    )
  })
}

// Unique 247 "error text" / errorText windows
function unique(needle, radius = 80) {
  const a = allHits(buf246, needle)
  const b = allHits(buf247, needle)
  const set = new Set(a.map((off) => asciiWindow(buf246, off, off + radius)))
  return b.filter((off) => !set.has(asciiWindow(buf247, off, off + radius)))
}
for (const n of ['error text', 'errorText']) {
  const u = unique(n, 90)
  console.log('unique', n, u.length, u)
  u.slice(0, 6).forEach((off, i) => {
    dump(
      `gold-8-pass2-uniq-${n.replace(/\s+/g, '')}-h${i}-247.txt`,
      `# off=${off}\n\n${asciiWindow(buf247, Math.max(0, off - 600), off + 600)}\n`,
    )
  })
}

// Is Pc used near hook/agent/stderr/blocking?
function near(buf, needle, neighbors, radius = 400) {
  return allHits(buf, needle).filter((off) => {
    const w = asciiWindow(buf, Math.max(0, off - radius), off + radius)
    return neighbors.some((n) => w.includes(n))
  })
}
const neigh = ['hook', 'Hook', 'stderr', 'blockingError', 'background agent', 'agent error']
for (const n of ['Pc(', 'Mue', 'characters truncated']) {
  const hits = near(buf247, n, neigh, 500)
  console.log('near hook/agent', n, hits.length, hits.slice(0, 8))
  hits.slice(0, 6).forEach((off, i) => {
    dump(
      `gold-8-pass2-Pc-nearhook-h${i}-247.txt`,
      `# off=${off} needle=${JSON.stringify(n)}\n\n${asciiWindow(buf247, Math.max(0, off - 500), off + 500)}\n`,
    )
  })
}

console.log('DONE pass2e')
