/**
 * #8 pass2f — 246 twin of Pc/VD/gPo; callers of VD (bg-agent vs hook).
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
    if (hits.length > 40) break
  }
  return hits
}

function dump(name, text) {
  const body = text.endsWith('\n') ? text : `${text}\n`
  writeFileSync(`${outDir}/${name}`, body)
  console.log('WROTE', name, body.length)
}

function extractFn(buf, off, maxLen = 4000) {
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
  return src.slice(0, 500)
}

const probes = [
  'Command failed with no output',
  'characters truncated',
  'function VD(',
  'function gPo(',
  'function LX(',
  'function fPo(',
  'e.stderr,e.stdout',
  'Exit code ${e.code}',
  'Interrupted',
  'dPo=1024',
]
console.log('=== probe counts ===')
for (const n of probes) {
  const a = allHits(buf246, n)
  const b = allHits(buf247, n)
  console.log(`${a.length}\t${b.length}\t${JSON.stringify(n)}${a.length !== b.length ? ' DIFF' : ''}`)
}

// Dump EVERY 246/247 "characters truncated" with version-prefixed names (no overwrite)
for (const [ver, buf] of [
  [246, buf246],
  [247, buf247],
]) {
  const hits = allHits(buf, 'characters truncated')
  hits.forEach((off, i) => {
    dump(
      `gold-8-pass2f-chars-trunc-${ver}-h${i}.txt`,
      `# off=${off} ver=${ver} hit=${i + 1}/${hits.length}\n\n${asciiWindow(buf, Math.max(0, off - 400), off + 700)}\n`,
    )
  })
}

for (const n of [
  'Command failed with no output',
  'function VD(',
  'function gPo(',
  'e.stderr,e.stdout',
  'dPo=1024',
]) {
  for (const [ver, buf] of [
    [246, buf246],
    [247, buf247],
  ]) {
    const hits = allHits(buf, n)
    hits.slice(0, 3).forEach((off, i) => {
      dump(
        `gold-8-pass2f-${n.replace(/[^A-Za-z0-9]+/g, '-').replace(/-+$/g, '')}-${ver}-h${i}.txt`,
        `# off=${off} ver=${ver}\n\n${asciiWindow(buf, Math.max(0, off - 200), off + 800)}\n`,
      )
    })
  }
}

// Extract VD / gPo / LX / fPo / Pc complete
const named = [
  [247, buf247, 'function VD(', 'VD'],
  [247, buf247, 'function gPo(', 'gPo'],
  [247, buf247, 'function LX(', 'LX'],
  [247, buf247, 'function fPo(', 'fPo'],
  [247, buf247, 'function Pc(e,t=Mue)', 'Pc'],
  [246, buf246, 'function VD(', 'VD'],
  [246, buf246, 'Command failed with no output', 'cmdfail'],
]
for (const [ver, buf, sig, tag] of named) {
  const off = buf.indexOf(Buffer.from(sig))
  if (off < 0) {
    dump(`gold-8-pass2f-${tag}-${ver}-MISS.txt`, `# MISS ${sig}\n`)
    continue
  }
  // walk back to function if needle is inside
  let start = off
  if (!sig.startsWith('function ')) {
    const win = asciiWindow(buf, Math.max(0, off - 800), off + 50)
    const idx = win.lastIndexOf('function ')
    if (idx >= 0) start = Math.max(0, off - 800) + idx
  }
  dump(
    `gold-8-pass2f-${tag}-fn-${ver}.txt`,
    `# needleOff=${off} start=${start}\n\n${extractFn(buf, start, 2500)}\n`,
  )
}

// Callers of VD( — dump JS windows
for (const [ver, buf] of [
  [247, buf247],
  [246, buf246],
]) {
  const hits = allHits(buf, 'VD(')
  console.log(ver, 'VD( hits', hits.length)
  let d = 0
  hits.forEach((off, i) => {
    const s = asciiWindow(buf, Math.max(0, off - 200), off + 180)
    if ((s.match(/[\x20-\x7e]/g) || []).length / s.length < 0.85) return
    if (d >= 12) return
    dump(`gold-8-pass2f-VDcall-${ver}-h${d}.txt`, `# off=${off} hit=${i}\n\n${s}\n`)
    d++
  })
}

console.log('DONE pass2f')
