import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const buf246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
)

function asciiWindow(buf, start, end) {
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

function findAll(buf, needle, limit = 40) {
  const n = typeof needle === 'string' ? Buffer.from(needle) : needle
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

function extractFn(buf, start) {
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
        return { start, end: i + 1, text: asciiWindow(buf, start, i + 1) }
      }
    }
  }
  return {
    start,
    end: start + 200,
    text: asciiWindow(buf, start, start + 200),
  }
}

function dump(name, content) {
  writeFileSync(`${outDir}/${name}`, content)
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

log('# HP/pendingUsage pass2 callers + export aliases + 246 leftover')

const needles = [
  'dm as Y$',
  'uvi as Z$',
  'zC as _$',
  'xvi as $$',
  'xln as aaa',
  'dPe as baa',
  'Y$ as ',
  'Z$ as ',
  '$$ as ',
  'aaa as ',
  '_$ as ',
  'baa as ',
  't.delete(n)',
  'r.count++',
  'pendingUsage.set(e,{count:1,lastUsedAt:t})',
  'function TP(){return',
  'let{pendingUsage:t}=TP()',
  'class ysn{pendingUsage=new Map',
  'uln(',
  'uvi(',
  'oko(',
  'sko(',
  'xvi(',
  'sPe()',
  'sPe(',
  'Aln(',
  'xit(',
  'dm(e)',
  'Y$(',
  'Z$(',
  '$$(',
  'HP as ',
  ',HP as ',
  'HP as Y$',
  'HP as Z$',
  ' as HP,',
  't.keys())if(e.has(n.toLowerCase()))t.delete(n)',
  'flushers=e',
  'r3.flushers',
  'flushAtExit',
  'var Xwo=60000',
]

log('\n## 247 pass2 needles')
for (const n of needles) {
  const hits = findAll(buf, n, 25)
  log(`247 ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 10)) {
    log(
      `  @${i} ${asciiWindow(buf, i - 80, i + n.length + 120).replace(/\n/g, ' ')}`,
    )
  }
}

log('\n## 246 leftover extract TP/Asn/ysn')
for (const n of [
  'function TP(){return',
  'class ysn{pendingUsage=new Map',
  'function Asn(e){let{pendingUsage:t}=TP()',
  'pendingUsage.set(e,{count:1,lastUsedAt:t})',
  'let{pendingUsage:t}=TP()',
]) {
  const hits = findAll(buf246, n, 8)
  log(`246 ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits) {
    const fn = n.startsWith('function') || n.startsWith('class')
      ? extractFn(buf246, i)
      : null
    log(
      `  @${i} ${(fn ? fn.text : asciiWindow(buf246, i - 80, i + n.length + 140)).replace(/\n/g, ' ')}`,
    )
    if (fn) {
      dump(
        `gold-HP-246-${n.slice(0, 20).replace(/[^A-Za-z0-9]+/g, '-')}-${i}.txt`,
        `# 246 leftover @${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
      )
    }
  }
}

// walk back from dm as Y$ export to see if HP/sPe/yln/uln/oko/xit listed
log('\n## export map walk back from dm as Y$ @219684757')
dump(
  'gold-HP-export-dm-Y$.txt',
  `# export around dm as Y$ @219684757\n${asciiWindow(buf, 219684200, 219685400)}\n`,
)
log(asciiWindow(buf, 219684200, 219685000).replace(/\n/g, ' '))

// search HP / sPe / yln / uln / oko / xit / iln / lln / aln in that export window
const expWinStart = 219680000
const expWin = asciiWindow(buf, expWinStart, 219690000)
for (const name of [
  'HP as',
  'sPe as',
  'yln as',
  'uln as',
  'oko as',
  'xit as',
  'iln as',
  'lln as',
  'aln as',
  'pln as',
  'fln as',
  'mln as',
  'gln as',
  'hln as',
  'dln as',
  'Aln as',
  'sko as',
  'dm as',
  'uvi as',
  'xvi as',
  'xln as',
  'dPe as',
]) {
  const idx = expWin.indexOf(name)
  log(`EXPORTWIN ${JSON.stringify(name)} idx=${idx}`)
}

// same-module callers: scan 213640000-213660000 for dm( that is not function dm
log('\n## same-module call tokens 213640000-213660000')
const cluster = asciiWindow(buf, 213640000, 213660000)
for (const tok of [
  'dm(',
  'uln(',
  'uvi(',
  'sPe(',
  'oko(',
  'sko(',
  'xvi(',
  'xit(',
  'Aln(',
  'yln(',
  'HP()',
  'dln(',
  'pln(',
  'gln(',
  'hln(',
]) {
  let idx = 0
  const hits = []
  while (true) {
    const j = cluster.indexOf(tok, idx)
    if (j < 0) break
    hits.push(213640000 + j)
    idx = j + tok.length
  }
  log(`CLUSTER ${tok} count=${hits.length} hits=${hits.join(',')}`)
}

// import Y$ as / Z$ as consumers
log('\n## hashed import consumers Y$ Z$ $$ aaa _$ baa')
for (const n of [
  'Y$ as ',
  'Z$ as ',
  '$$ as ',
  'aaa as ',
  '_$ as ',
  'baa as ',
  'Y$,',
  ',Y$}',
  '{Y$ as',
  '{Z$ as',
  '{$$ as',
]) {
  const hits = findAll(buf, n, 20)
  log(`IMP2 ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 10)) {
    log(
      `  @${i} ${asciiWindow(buf, i - 60, i + n.length + 100).replace(/\n/g, ' ')}`,
    )
  }
}

// unique increment caller: search strings that likely call dm after plugin use
log('\n## increment-adjacent unique strings')
for (const n of [
  'pendingUsage.set(e,{count:1,lastUsedAt:t})',
  'r.count++,r.lastUsedAt=t',
  'lastUsedNumStartups',
  'plugin-telemetry',
  'claude-plugin-telemetry-v1',
]) {
  const hits = findAll(buf, n, 12)
  log(`INC ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 6)) {
    log(
      `  @${i} ${asciiWindow(buf, i - 80, i + n.length + 100).replace(/\n/g, ' ')}`,
    )
  }
}

dump('gold-HP-pendingUsage-pass2.txt', report.join('\n') + '\n')
log('WROTE gold-HP-pendingUsage-pass2.txt')
