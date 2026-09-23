/**
 * densable 2.1.251 SEA peel recon — PARTIAL CLI/bg/session missing callees.
 * #25 #27 #33 #34 #35 #36 #41 #42 #44 #51. Invent-ban. Does not mark HAVE.
 */
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  EXE_251,
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
  sha,
} from './_peel-251-helpers.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const EXPECT = 217360032
const buf = loadSea()
if (buf.length !== EXPECT) throw new Error(`SEA bytes ${buf.length} != ${EXPECT}`)

const lines = []
const log = s => {
  lines.push(s)
  console.log(s)
}

function hitsPreview(needle, cap = 12) {
  const hits = allHits(buf, needle)
  const rows = hits.slice(0, cap).map(i => {
    const fn = lastFnStartGeneric(buf, i, 12000)
    const head = asciiSlice(buf, i, i + 80).replace(/\s+/g, ' ')
    return `  @${i} lastFn=${fn.name}@${fn.i} | ${head}`
  })
  return { n: hits.length, hits, rows }
}

function extractNamed(name, { maxLen = 12000, preferAsync = true } = {}) {
  const needles = preferAsync
    ? [`async function ${name}(`, `function ${name}(`]
    : [`function ${name}(`, `async function ${name}(`]
  const found = []
  for (const needle of needles) {
    for (const i of allHits(buf, needle)) {
      const fn = extractFnAt(buf, i, maxLen)
      found.push({
        needle,
        i,
        miss: !!fn.miss || !!fn.missEnd,
        len: fn.len ?? 0,
        sha: fn.sha ?? '-',
        preview: (fn.body || fn.preview || '').slice(0, 180).replace(/\s+/g, ' '),
        body: fn.body,
      })
    }
  }
  return found
}

function extractFromCaller(callerNeedle, { lookback = 8000, maxLen = 12000 } = {}) {
  const hits = allHits(buf, callerNeedle)
  return hits.slice(0, 8).map(h => {
    const fn = lastFnStartGeneric(buf, h, lookback)
    const extracted = fn.i >= 0 ? extractFnAt(buf, fn.i, maxLen) : { miss: true }
    return {
      caller: h,
      name: fn.name,
      i: fn.i,
      miss: !!extracted.miss || !!extracted.missEnd,
      len: extracted.len ?? 0,
      sha: extracted.sha ?? '-',
      preview: (extracted.body || extracted.preview || '')
        .slice(0, 160)
        .replace(/\s+/g, ' '),
      body: extracted.body,
    }
  })
}

function extractMethod(name, { maxLen = 4000 } = {}) {
  const needle = `${name}(){`
  const hits = allHits(buf, needle)
  return hits.slice(0, 8).map(i => {
    const win = asciiSlice(buf, i, i + maxLen)
    let depth = 0
    let inStr = null
    let esc = false
    const brace = win.indexOf('{')
    if (brace < 0) return { i, miss: true }
    for (let p = brace; p < win.length; p++) {
      const c = win[p]
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
        if (depth === 0) {
          const body = win.slice(0, p + 1)
          return { i, body, sha: sha(body), len: body.length, miss: false }
        }
      }
    }
    return { i, miss: true, preview: win.slice(0, 160) }
  })
}

log(`SEA ${buf.length} ${EXE_251}`)
log('')

const probes = [
  ['#25 function dpe(', 'function dpe('],
  ['#25 async function dpe(', 'async function dpe('],
  ['#25 function DVt(', 'function DVt('],
  ['#25 async function DVt(', 'async function DVt('],
  ['#25 function HA(', 'function HA('],
  ['#25 async function HA(', 'async function HA('],
  ['#25 refresh the set-aside', "refresh the set-aside's mtime"],
  ['#25 existing destination set aside', 'existing destination set aside'],
  ['#25 .superseded-', '.superseded-'],
  ['#25 restore set-aside destination after ENOENT', 'restore set-aside destination after ENOENT'],
  ['#27 function $Y(', 'function $Y('],
  ['#27 $Y(ke,Pe)', '$Y(ke,Pe)'],
  ['#33 function rNt(', 'function rNt('],
  ['#33 rNt()', 'rNt()'],
  ['#33 bg_worker_ctty', 'bg_worker_ctty'],
  ['#34 addDirectories carries a directory containing a null byte', 'addDirectories carries a directory containing a null byte'],
  ['#34 containsNullByte', 'containsNullByte'],
  ['#34 Path contains null bytes', 'Path contains null bytes'],
  ['#34 additionalDirectories', 'additionalDirectories'],
  ['#35 function ZW(', 'function ZW('],
  ['#35 export{ZW', 'export{ZW'],
  ['#36 function jJn(', 'function jJn('],
  ['#36 rendersItalicAsStandout', 'rendersItalicAsStandout'],
  ['#41 function awn(', 'function awn('],
  ['#41 async function awn(', 'async function awn('],
  ['#41 function Yp(', 'function Yp('],
  ['#41 urr(awn())', 'urr(awn())'],
  ['#42 function oc(', 'function oc('],
  ['#42 oc()||wt()', 'oc()||wt()'],
  ['#44 TG("/bug")', 'TG("/bug")'],
  ['#44 TG("/feedback")', 'TG("/feedback")'],
  ['#44 gRt', 'm==="share"?"/share":"/bug"'],
  ['#51 function dKe(', 'function dKe('],
  ['#51 function wCe(', 'function wCe('],
  ['#51 localAgent', 'localAgent'],
]

for (const [label, needle] of probes) {
  const p = hitsPreview(needle)
  log(`${label} hits=${p.n}`)
  for (const row of p.rows) log(row)
  log('')
}

log('=== named extracts ===')
for (const name of [
  'dpe',
  'DVt',
  'HA',
  '$Y',
  'rNt',
  'ZW',
  'jJn',
  'awn',
  'Yp',
  'oc',
  'dKe',
  'lr',
  'mbe',
  'zk',
]) {
  const found = extractNamed(name, { maxLen: name === 'HA' || name === 'oc' ? 4000 : 16000 })
  log(`${name} decls=${found.length}`)
  for (const f of found.slice(0, 10)) {
    log(
      `  ${f.needle} @${f.i} miss=${f.miss} len=${f.len} sha=${f.sha} | ${f.preview}`,
    )
  }
  log('')
}

log('=== methods ===')
for (const m of extractMethod('rendersItalicAsStandout')) {
  log(
    `rendersItalicAsStandout @${m.i} miss=${m.miss} len=${m.len ?? 0} sha=${m.sha ?? '-'} | ${(m.body || m.preview || '').slice(0, 160)}`,
  )
}

log('')
log('=== caller lastFn ===')
for (const needle of [
  'await DVt(',
  'await HA(x,y)',
  '$Y(ke,Pe)',
  'urr(awn())',
  'if(!Yp())',
  'return oc()||wt()',
  'TG("/bug")',
  'dKe(s.viewingAgentTaskId',
  'copiedVia:ft,copy:se}=ZW(',
]) {
  const rows = extractFromCaller(needle)
  log(`caller ${JSON.stringify(needle)} n=${allHits(buf, needle).length}`)
  for (const r of rows) {
    log(
      `  caller@${r.caller} -> ${r.name}@${r.i} miss=${r.miss} len=${r.len} sha=${r.sha} | ${r.preview}`,
    )
  }
  log('')
}

const out = join(__dir, '_peel-251-k-recon.txt')
writeFileSync(out, lines.join('\n'), 'utf8')
console.error('wrote', out)
