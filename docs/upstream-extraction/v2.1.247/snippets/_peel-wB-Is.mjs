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

function findAll(needle, limit = 40) {
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
  const p = `${outDir}/${name}`
  writeFileSync(p, content)
  return p
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

log(`# wB-Is peel official-247 size=${buf.length}`)

const uniqueNeedles = [
  'async function Is(e,t,n,r,i)',
  'function Is(e,t,n,r,i)',
  'settings storageV5 write failed',
  'updateSettingsForSource: invalid JSON',
  'updateSettingsForSource: written settings not seeded',
  'oi.run(i,()=>Is(e,t,i,n,r))',
  'oi=Pr()',
  'function si(){return oi.drain()}',
  'J as oGc',
  'let i=J(e)',
  'legacyRevocation',
  'publishDiscipline:"followAtomic"',
  'i.write(q.userSettings()',
]

for (const n of uniqueNeedles) {
  const hits = findAll(n, 20)
  log(`STR ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 6)) {
    log(`  @${i} ${asciiWindow(i - 60, i + n.length + 80).replace(/\n/g, ' ')}`)
  }
}

// extract unique Is
const isHits = findAll('async function Is(e,t,n,r,i)', 10)
log(`IS_HITS count=${isHits.length}`)
for (const i of isHits) {
  const fn = extractFn(i)
  dump(
    `gold-wB-Is-body.txt`,
    `# needle=async function Is(e,t,n,r,i) pos=${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
  )
  log(`DUMP Is @${i} end=${fn.end} len=${fn.end - i}`)
}

// confirm-only J near settings module (ii @208311653)
const jNeedles = [
  'function J(e){',
  'function J(e,t){',
  'function J(e,t,n){',
]
for (const n of jNeedles) {
  const hits = findAll(n, 80)
  log(`FN ${JSON.stringify(n)} count=${hits.length}`)
  const near = hits.filter((i) => i > 208200000 && i < 208400000)
  log(`  near-705 ${near.join(',')}`)
  for (const i of near.slice(0, 12)) {
    const fn = extractFn(i)
    log(`  J@${i} len=${fn.end - i} ${fn.text.slice(0, 220).replace(/\n/g, ' ')}`)
  }
}

// oi / Pr queue
const oiNeedles = [
  'oi=Pr()',
  'function Pr(',
  'Pr=()=>',
  'oi.run(',
  'oi.drain()',
]
for (const n of oiNeedles) {
  const hits = findAll(n, 20)
  log(`OI ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 8)) {
    log(`  @${i} ${asciiWindow(i - 40, i + 180).replace(/\n/g, ' ')}`)
  }
}

// export table around J as oGc
const oGc = findAll('J as oGc', 5)
for (const i of oGc) {
  dump(
    'gold-wB-Is-export-J-oGc.txt',
    `# J as oGc @${i}\n${asciiWindow(i - 200, i + 200)}\n`,
  )
  log(`EXPORT J as oGc @${i}`)
}

// ar / ke used by Is 5th
for (const n of [
  'async function ar(e,t)',
  'function ke(e,n)',
  'function ke(e,t)',
  'function A(){',
]) {
  const hits = findAll(n, 15)
  log(`HELP ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  const near = hits.filter((i) => i > 208300000 && i < 208330000)
  for (const i of near) {
    const fn = extractFn(i)
    log(`  HELP@${i} len=${fn.end - i} ${fn.text.slice(0, 240).replace(/\n/g, ' ')}`)
  }
}

// confirm-only unique bodies
for (const [label, needle] of [
  ['J-path', 'function J(e){return le(e,p())}'],
  ['ke-user-default', 'function ke(e,t){return e==="userSettings"&&Yo(t)===Fr.default}'],
  ['ar-full', 'async function ar(e,t){let n=J("userSettings")'],
  ['ii-full', 'function ii(e,t,n,r){if(e==="policySettings"||e==="flagSettings")'],
  ['Rs-full', 'function Rs(e,t,n,r){return ii(e,()=>t,n,r)}'],
]) {
  const hits = findAll(needle, 10)
  log(`UNIQ ${label} count=${hits.length} hits=${hits.join(',')}`)
}

const jPos = 208306382
const jFn = extractFn(jPos)
dump(
  'gold-wB-Is-J.txt',
  `# confirm-only J path — same _705 module as ii/Is; export J as oGc @208321331
# function J(e){return le(e,p())} pos=${jPos} end=${jFn.end} len=${jFn.end - jPos}
${jFn.text}
# next function J(e){ in file is AFTER this module export @208326222 (different module)
# le(e,p()) body not requested; Pr() factory for oi not uniquely bound (20 function Pr)
`,
)

const kePos = 208308006
const keFn = extractFn(kePos)
dump(
  'gold-wB-Is-ke.txt',
  `# ke used by Is 5th-arg gate o=A()&&i!==void 0&&ke(e,n)
# pos=${kePos} end=${keFn.end} len=${keFn.end - kePos}
${keFn.text}
`,
)

const arPos = 208314097
const arFn = extractFn(arPos)
dump(
  'gold-wB-Is-ar.txt',
  `# ar unique; called with Is 5th i (storageV5) after non-v5 write / null-transform localSettings
# pos=${arPos} end=${arFn.end} len=${arFn.end - arPos}
${arFn.text}
`,
)

dump(
  'gold-wB-Is-oi.txt',
  `# confirm-only oi.run queue
# oi.run(i,()=>Is(e,t,i,n,r)) UNIQUE @208311816
# function si(){return oi.drain()} UNIQUE @208311844
# oi=Pr() UNIQUE @208320642 in same module init Vs
# function Pr( collision count=20 — Pr body UNKNOWN (do not invent)
function ii(e,t,n,r){if(e==="policySettings"||e==="flagSettings")return Promise.resolve({error:null});let i=J(e);if(!i)return Promise.resolve({error:null});return oi.run(i,()=>Is(e,t,i,n,r))}
function si(){return oi.drain()}
oi=Pr()
`,
)

dump('gold-wB-Is-scan.txt', report.join('\n') + '\n')
