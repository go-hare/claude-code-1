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

function findAll(needle, limit = 12, from = 0, to = buf.length) {
  const n = Buffer.from(needle)
  const hits = []
  let i = from
  while (hits.length < limit) {
    const j = buf.indexOf(n, i)
    if (j < 0 || j > to) break
    hits.push(j)
    i = j + n.length
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

const dHits = findAll('function d(r,n=160)', 8)
log(`function d(r,n=160) count=${dHits.length} ${dHits.join(',')}`)
for (const i of dHits) {
  const fn = extractFn(i)
  dump(
    'gold-ho-yo-$t.txt',
    `# LOCKED $t = _717 d as AQc; _716 import AQc as $t
# d pos=${i} end=${fn.end} len=${fn.end - i}
# export d as AQc @207828236
# import AQc as $t @207835172
${fn.text}
`,
  )
  log(`D @${i} ${fn.text}`)
}

const lHits = findAll('function l(r){return s(r).replace(/ {2,}/g," ").trim()}', 8)
log(`l count=${lHits.length} ${lHits.join(',')}`)
for (const i of lHits) {
  const fn = extractFn(i)
  dump('gold-ho-yo-$t-l.txt', `# l pos=${i} end=${fn.end}\n${fn.text}\n`)
  log(`L @${i} ${fn.text}`)
}

const CHits = findAll('function C(r,n=160)', 8)
log(`C count=${CHits.length} ${CHits.join(',')}`)
for (const i of CHits) {
  const fn = extractFn(i)
  dump('gold-ho-yo-$t-C.txt', `# C=BQc pos=${i}\n${fn.text}\n`)
  log(`C @${i} ${fn.text}`)
}

// Gzd as e — truncate helper used by d
const eImp = findAll('Gzd as e', 8, 207820000, 207835000)
log(`Gzd as e ${eImp.join(',')}`)
for (const i of eImp) log(`  @${i} ${asciiWindow(i - 40, i + 80)}`)

for (const pat of ['function Gzd(', 'Gzd=', ' as Gzd,', ' as Gzd}']) {
  const hits = findAll(pat, 8)
  log(`Gzd ${JSON.stringify(pat)} ${hits.join(',')}`)
  for (const i of hits.slice(0, 4)) {
    log(`  @${i} ${asciiWindow(i, i + 160).replace(/\n/g, ' ')}`)
    if (pat.startsWith('function')) {
      const fn = extractFn(i)
      dump('gold-ho-yo-$t-Gzd.txt', `# Gzd@${i}\n${fn.text}\n`)
      log(`  BODY ${fn.text}`)
    }
  }
}

// rewrite clean isolated golds for vo/fo/So/ko
dump(
  'gold-ho-yo-vo.txt',
  `# LOCKED vo pos=207876619
vo='Bare source names resolve under metadata.pluginRoot, which this marketplace does not set (or sets to a path outside the marketplace root). Use a "./relative/path" source, or set metadata.pluginRoot to allow bare names.'
`,
)
dump(
  'gold-ho-yo-fo.txt',
  `# LOCKED fo pos=207910685
fo=new Set(["npm","url","github","git-subdir","archive","command","unsupported"])
`,
)
dump(
  'gold-ho-yo-So-ko.txt',
  `# LOCKED So pos=207876604  So=3
# LOCKED ko pos=207876609  ko=160
# cluster: fo,_o,So=3,ko=160,xo,vo='...'
So=3,ko=160
`,
)
dump(
  'gold-ho-yo-xo.txt',
  `# LOCKED xo pos=207910796 (os predicate regex)
xo=/^[A-Za-z0-9][-A-Za-z0-9._]*$/
`,
)
dump(
  'gold-ho-yo-_o.txt',
  `# LOCKED _o pos=207910767 (Ft key allowlist)
_o=/^[A-Za-z0-9_$.-]{1,40}$/
`,
)
dump(
  'gold-ho-yo-716-export.txt',
  `# _716 export @207915890
yo as jQc,Ft as kQc,ns as lQc,os as mQc,wo as nQc,Po as oQc,Mo as pQc
# bo NOT exported
# vo/fo/So/ko NOT exported (module-local)
`,
)

dump('gold-ho-yo-pass3-scan.txt', report.join('\n') + '\n')
