import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const buf246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
)

function asciiWindow(b, start, end) {
  let s = ''
  const a = Math.max(0, start)
  const c = Math.min(b.length, end)
  for (let j = a; j < c; j++) {
    const ch = b[j]
    s +=
      ch === 9 || ch === 10 || ch === 13 || (ch >= 32 && ch <= 126)
        ? String.fromCharCode(ch)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

function findAll(b, needle, limit = 20) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (hits.length < limit) {
    const i = b.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

function extractFn(b, start) {
  let i = start
  while (i < b.length && b[i] !== 123) i++
  if (i >= b.length) return { start, end: start, text: '' }
  let depth = 0
  let inS = 0
  let esc = false
  for (; i < b.length; i++) {
    const c = b[i]
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
        return { start, end: i + 1, text: asciiWindow(b, start, i + 1) }
      }
    }
  }
  return { start, end: start + 200, text: asciiWindow(b, start, start + 200) }
}

function walkBackToFn(b, pos, maxBack = 8000) {
  const from = Math.max(0, pos - maxBack)
  const win = asciiWindow(b, from, pos + 1)
  let best = -1
  for (const n of ['async function ', 'function ']) {
    let idx = 0
    while (true) {
      const j = win.indexOf(n, idx)
      if (j < 0) break
      const abs = from + j
      if (abs <= pos && abs > best) best = abs
      idx = j + n.length
    }
  }
  return best
}

function dump(name, content) {
  writeFileSync(`${outDir}/${name}`, content)
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

log('# HP/pendingUsage pass5 — increment caller enclose + unique strings + 246 leftover')

for (const n of [
  'qe(s.pluginInfo.repository)',
  'qe(p.pluginInfo.repository)',
  'if(s.type==="prompt"&&s.pluginInfo)qe(',
  'tt(i),Ze({storageV5:i,credentials:m})',
  'pluginInfo.repository',
  'function TP(){return',
  'TP().pendingUsage',
  'function Asn(e){let{pendingUsage:t}=TP()',
]) {
  const hits = findAll(buf, n, 8)
  const hits246 = findAll(buf246, n, 8)
  log(
    `${JSON.stringify(n)} 247=${hits.length}[${hits.join(',')}] 246=${hits246.length}[${hits246.join(',')}]`,
  )
  for (const i of hits) {
    log(`  247@${i} ${asciiWindow(buf, i - 80, i + n.length + 80).replace(/\n/g, ' ')}`)
  }
}

for (const pos of [225476838, 225484253, 222202257]) {
  const fnStart = walkBackToFn(buf, pos, 12000)
  log(`CALL@${pos} encloseStart=${fnStart}`)
  if (fnStart > 0) {
    const fn = extractFn(buf, fnStart)
    log(
      `  ${asciiWindow(buf, fnStart, fnStart + 80)} ... end=${fn.end} len=${fn.end - fnStart}`,
    )
    dump(
      `gold-HP-caller-${fnStart}.txt`,
      `# caller enclose @${fnStart} end=${fn.end} len=${fn.end - fnStart} call@${pos}
${fn.text}
`,
    )
  }
}

// 246 leftover complete HP-equivalent
const tp246 = findAll(buf246, 'function TP(){return', 5)
for (const i of tp246) {
  const fn = extractFn(buf246, i)
  log(`246 TP@${i} end=${fn.end} ${fn.text}`)
  dump(
    'gold-HP-246-TP-full.txt',
    `# 246 leftover (renamed) TP @${i} end=${fn.end} len=${fn.end - i}
# 247 HP equivalent. same-shape leftover, not 247 name.
${fn.text}
`,
  )
}
const asn246 = findAll(buf246, 'function Asn(e){let{pendingUsage:t}=TP()', 5)
for (const i of asn246) {
  const fn = extractFn(buf246, i)
  log(`246 Asn@${i} ${fn.text}`)
  dump(
    'gold-HP-246-Asn-full.txt',
    `# 246 leftover Asn (247 yln) @${i} end=${fn.end}
${fn.text}
`,
  )
}

dump('gold-HP-pendingUsage-pass5.txt', report.join('\n') + '\n')
log('WROTE gold-HP-pendingUsage-pass5.txt')
