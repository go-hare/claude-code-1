import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function asciiWindow(start, end) {
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
  return s.replace(/[.]{4,}/g, '...')
}

function findAll(needle, limit = 15) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (hits.length < limit) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

function extractFn(start) {
  let i = start
  while (i < buf.length && buf[i] !== 123) i++
  if (i >= buf.length) return { start, end: start, text: '' }
  let depth = 0
  let inS = 0
  let esc = false
  for (; i < buf.length; i++) {
    const c = buf[i]
    if (inS) {
      if (esc) {
        esc = false
        continue
      }
      if (c === 92) {
        esc = true
        continue
      }
      if (c === inS) inS = 0
      continue
    }
    if (c === 34 || c === 39 || c === 96) {
      inS = c
      continue
    }
    if (c === 123) depth++
    else if (c === 125) {
      depth--
      if (depth === 0) {
        return { start, end: i + 1, text: asciiWindow(start, i + 1) }
      }
    }
  }
  return { start, end: start + 200, text: asciiWindow(start, start + 200) }
}

function dump(name, content) {
  writeFileSync(`${outDir}/${name}`, content)
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

log('# mp pass7 Od/Y/C + gold dumps')

dump(
  'gold-mp-ci-full.txt',
  `# Fs SOURCE ci unique via ci as hMb @209535570 + CLAUDE_CODE_PLUGIN_CACHE_DIR @209324427
# K8 import hMb as Fs @212823619 count=1
${extractFn(209324427).text}
`,
)

dump(
  'gold-mp-ci-neighbors.txt',
  `# ci@209324427 neighbors\n${asciiWindow(209323800, 209325200)}\n`,
)

for (const n of [
  'function Od(',
  'function Od()',
  'Od()',
  'function Y()',
  'CLAUDE_CODE_PLUGIN_CACHE_DIR',
  'function Ur(',
]) {
  const hits = findAll(n, 12)
  log(`DIR ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 6)) {
    const near = Math.abs(i - 209324427) < 80000
    log(`  @${i} nearCi=${near} ${asciiWindow(i - 20, i + 140).replace(/\n/g, ' ')}`)
  }
}

// Od in 2093xxxxx
{
  for (const name of ['function Od(', 'function Y()', 'function Ur(', 'function Lr(']) {
    const n = Buffer.from(name)
    let from = 209280000
    let c = 0
    while (c < 6) {
      const i = buf.indexOf(n, from)
      if (i < 0 || i > 209540000) break
      const fn = extractFn(i)
      log(`${name} @${i} ${fn.text.slice(0, 200)}`)
      dump(
        `gold-mp-${name.replace(/[()]/g, '')}-${i}.txt`,
        `# @${i}\n${fn.text}\n`,
      )
      from = i + 10
      c++
    }
  }
}

dump(
  'gold-mp-E-full.txt',
  `# xe SOURCE E unique function E(e){return e.length>0&&e.every(C)} @207942213
# export E as ydd @207949946 count=1
# sl-mod import ydd as xe @211418076 count=1 from _814.js
${extractFn(207942213).text}
`,
)

dump(
  'gold-mp-C-full.txt',
  `# E.every(C) @207942094 — path segment safe
${extractFn(207942094).text}
`,
)

dump(
  'gold-K8-v5-dSt-OFe.txt',
  `# dSt unique function dSt( count=1 @214510094
# join as OFe @214509025
# wg = ss = ".orphaned_at"
${extractFn(214510094).text}
# import
${asciiWindow(214508980, 214509080)}
`,
)

dump(
  'gold-K8-v5-JD-vpt.txt',
  `# JD unique async function JD( count=1 @214078883
# lstat as vpt count=1 @214076933
${extractFn(214078883).text}
# import
${asciiWindow(214076900, 214077050)}
`,
)

dump('gold-mp-pass7.txt', report.join('\n') + '\n')
