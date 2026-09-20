import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

const HO = 207874075
const CLUSTER_LO = 207830000
const CLUSTER_HI = 207920000

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

function findAll(needle, limit = 40, from = 0, to = buf.length) {
  const n = typeof needle === 'string' ? Buffer.from(needle) : needle
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

function extractAssign(start, max = 800) {
  // from ident= through matching ; at depth 0, respecting strings/parens/braces
  let i = start
  while (i < buf.length && buf[i] !== 61) i++
  if (i >= buf.length) return { start, end: start, text: '' }
  let depth = 0
  let inS = 0
  let esc = false
  let paren = 0
  let brack = 0
  for (i = i + 1; i < buf.length && i < start + max; i++) {
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
    if (c === 40) paren++
    else if (c === 41) paren--
    else if (c === 91) brack++
    else if (c === 93) brack--
    else if (c === 123) depth++
    else if (c === 125) depth--
    else if (c === 59 && depth === 0 && paren === 0 && brack === 0) {
      return { start, end: i + 1, text: asciiWindow(start, i + 1) }
    }
  }
  return { start, end: start + max, text: asciiWindow(start, start + max) }
}

function dump(name, content) {
  writeFileSync(`${outDir}/${name}`, content)
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

log(`# ho-yo peel official-247 size=${buf.length} ho=${HO}`)

// --- collision scan for banned short names ---
const banned = ['yo', 'bo', 'os', 'ns']
for (const name of banned) {
  const pats = [
    `function ${name}(`,
    `function ${name}()`,
    `var ${name}=`,
    `let ${name}=`,
    `const ${name}=`,
    `${name}=p(`,
    `${name}=w(`,
  ]
  for (const pat of pats) {
    const hits = findAll(pat, 30)
    const near = hits.filter((i) => i >= CLUSTER_LO && i <= CLUSTER_HI)
    log(
      `COLLIDE ${JSON.stringify(pat)} count=${hits.length} hits=${hits.join(',')} near716=${near.join(',')}`,
    )
    for (const i of hits.slice(0, 12)) {
      log(`  @${i} ${asciiWindow(i, i + 140).replace(/\n/g, ' ')}`)
    }
  }
}

// --- unique body needles from truncated cluster ---
const uniqueFns = [
  ['yo', 'function yo(e){if(!e||typeof e!=="object")return!1;let t=e.source'],
  ['bo', 'function bo(e){let t=e.find((o)=>o.path.length===1&&o.path[0]==="source")'],
  ['Ft', 'function Ft(e){return _o.test(e)?e:"<key>"}'],
  ['ns', 'function ns(e){let t=e.slice(0,So).map((o)=>{let n=o.path.map(String)'],
  ['os', 'function os(e){return typeof e==="string"&&xo.test(e)&&!e.includes("..")}'],
  ['ho', 'function ho(e){let t=go();return e.flatMap((s,o)=>{let n=t.safeParse(s)'],
]

for (const [label, needle] of uniqueFns) {
  const hits = findAll(needle, 8)
  log(`UNIQ ${label} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits) {
    const fn = extractFn(i)
    dump(
      `gold-ho-yo-${label}.txt`,
      `# LOCKED ${label} pos=${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
    )
    log(`  DUMP ${label} @${i} end=${fn.end} len=${fn.end - i}`)
    log(`  BODY ${label} ${fn.text}`)
  }
}

// --- vo / fo / $t / ko / So / _o / xo near cluster ---
const constPats = [
  'var vo=',
  'vo="',
  'vo=`',
  ',vo=',
  'vo=new',
  'var fo=',
  'fo=new Set',
  'fo=new Set(',
  ',fo=',
  'var So=',
  ',So=',
  'So=',
  'var ko=',
  ',ko=',
  'ko=',
  'function $t(',
  'var $t=',
  '$t=',
  'function _o(',
  'var _o=',
  '_o=',
  'var xo=',
  'xo=',
  'xo=new',
]

for (const pat of constPats) {
  const all = findAll(pat, 25)
  const near = all.filter((i) => i >= CLUSTER_LO && i <= CLUSTER_HI)
  log(
    `CONST ${JSON.stringify(pat)} count=${all.length} near=${near.join(',')} all=${all.slice(0, 12).join(',')}`,
  )
  for (const i of near.slice(0, 8)) {
    log(`  NEAR @${i} ${asciiWindow(i - 40, i + 160).replace(/\n/g, ' ')}`)
  }
}

// dump window before ho (vo/fo likely declared earlier in module)
dump(
  'gold-ho-yo-before-ho.txt',
  `# ho@${HO} before 6k\n${asciiWindow(HO - 6000, HO)}\n`,
)

// dump after ns/os through Mo + var list
dump(
  'gold-ho-yo-after-os.txt',
  `# os neighborhood\n${asciiWindow(207875500, 207878200)}\n`,
)

// module init that assigns vo/fo/So/ko/_o/xo
const initHits = findAll('var Ee=500,Sn=32', 4, CLUSTER_LO, CLUSTER_HI)
for (const i of initHits) {
  dump('gold-ho-yo-varlist-Ee.txt', `# @${i}\n${asciiWindow(i, i + 4000)}\n`)
  log(`VARLIST Ee @${i}`)
}

// search module-init function after Mo that sets fo/vo
for (const pat of [
  'fo=new Set([',
  'fo=new Set(["',
  'vo="',
  'So=',
  'ko=',
  '_o=',
  'xo=',
  '$t=',
]) {
  const hits = findAll(pat, 20, CLUSTER_LO, CLUSTER_HI)
  log(`INITPAT ${JSON.stringify(pat)} ${hits.join(',')}`)
  for (const i of hits) {
    log(`  @${i} ${asciiWindow(i - 30, i + 200).replace(/\n/g, ' ')}`)
  }
}

// --- $t import bind from realhead ---
const dollarImport = findAll('AQc as $t', 8)
log(`IMPORT AQc as $t ${dollarImport.join(',')}`)
for (const i of dollarImport) {
  log(`  @${i} ${asciiWindow(i - 80, i + 80).replace(/\n/g, ' ')}`)
}

// find AQc definition
for (const pat of ['function AQc(', 'AQc=p(', 'var AQc=', 'AQc=(', ' as AQc,', ' as AQc}']) {
  const hits = findAll(pat, 10)
  log(`AQc ${JSON.stringify(pat)} ${hits.join(',')}`)
  for (const i of hits.slice(0, 6)) {
    log(`  @${i} ${asciiWindow(i - 20, i + 180).replace(/\n/g, ' ')}`)
  }
}

// --- export binds in _716 ---
const exportNeedles = [
  'yo as ',
  ' as yo,',
  ' as yo}',
  'bo as ',
  ' as bo,',
  ' as bo}',
  'os as ',
  ' as os,',
  ' as os}',
  'ns as ',
  ' as ns,',
  ' as ns}',
  'Ft as ',
  'ho as ',
  'fo as ',
  'vo as ',
  'So as ',
  'ko as ',
  '$t as ',
  'Mo as ',
  'wo as ',
  'Po as ',
]
for (const n of exportNeedles) {
  const hits = findAll(n, 15, CLUSTER_LO, CLUSTER_HI + 20000)
  log(`BIND ${JSON.stringify(n)} count=${hits.length} ${hits.join(',')}`)
  for (const i of hits.slice(0, 6)) {
    log(`  @${i} ${asciiWindow(i - 60, i + 100).replace(/\n/g, ' ')}`)
  }
}

// _716 export object
const expHits = findAll('export{', 8, 207910000, 207920000)
for (const i of expHits) {
  dump(`gold-ho-yo-export-${i}.txt`, `# export@${i}\n${asciiWindow(i, i + 2500)}\n`)
  log(`EXPORT @${i} ${asciiWindow(i, i + 400).replace(/\n/g, ' ')}`)
}

dump('gold-ho-yo-scan.txt', report.join('\n') + '\n')
