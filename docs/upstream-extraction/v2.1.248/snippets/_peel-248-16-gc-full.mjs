import { existsSync, writeFileSync } from 'fs'
import {
  EXE_248,
  EXE_247,
  loadSea,
  asciiSlice,
  sha,
  allHits,
  extractFnAt,
  lastFnStart,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const outGold = `${outDir}/gold-248-16-gc-full.txt`

const OFF = {
  classGc: 192130933,
  Fh: 192130838,
  DhExport: 192130470,
  hashX: 192131709,
  hashP: 192131287,
  hashE: 192134546,
  loadPrStatuses: 192135779,
  prGetFilter: 192137355,
  fetchBatchCall: 192137568,
  hashEMerge: 192137786,
  pruneLi: 192138314,
  rp: 192178267,
  ZeOr: 192204952,
  Xw: 192234494,
  V$n: 184556749,
  K$n: 184559595,
  q$n: 184558619,
  uXe: 184559295,
}

const b248 = loadSea(EXE_248)
const b247 = existsSync(EXE_247) ? loadSea(EXE_247) : null

const lines = [
  '# gold-248-16-gc-full',
  `exe248=${EXE_248}`,
  `bytes248=${b248.length}`,
  `exe247=${b247 ? EXE_247 : 'MISSING'}`,
  `bytes247=${b247?.length ?? 0}`,
  `when=${new Date().toISOString()}`,
  '',
]

function extractBalancedFrom(buf, i, maxLen = 120000) {
  const win = asciiSlice(buf, i, i + maxLen)
  let depth = 0
  let inStr = null
  let esc = false
  let started = false
  for (let p = 0; p < win.length; p++) {
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
    if (c === '{') {
      depth++
      started = true
    } else if (c === '}') {
      depth--
      if (started && depth === 0) {
        const body = win.slice(0, p + 1)
        return { body, sha: sha(body), len: body.length, endOffset: i + p + 1 }
      }
    }
  }
  return { missEnd: true, preview: win.slice(0, 500), scanned: win.length }
}

function section(title) {
  lines.push(`## ${title}`)
}

function dumpSlice(label, buf, i, before, after) {
  section(`${label} @${i}`)
  if (i < 0) {
    lines.push('MISS')
    lines.push('')
    return
  }
  lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function dumpBalanced(label, buf, i, maxLen) {
  section(`${label} @${i}`)
  if (i < 0) {
    lines.push('MISS')
    lines.push('')
    return
  }
  const ext = extractBalancedFrom(buf, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha} end@${ext.endOffset}`)
    lines.push(ext.body)
  } else {
    lines.push(`MISS ${JSON.stringify(ext)}`)
  }
  lines.push('')
}

function dumpFn(label, buf, i, maxLen = 12000) {
  section(`${label} @${i}`)
  if (i < 0) {
    lines.push('MISS')
    lines.push('')
    return
  }
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else {
    lines.push(`MISS ${JSON.stringify(ext)}`)
  }
  lines.push('')
}

function findClassGc(buf) {
  const needle = Buffer.from('class gc{')
  let i = buf.indexOf(needle)
  if (i < 0) {
    const n2 = Buffer.from('class gc')
    i = buf.lastIndexOf(n2, OFF.classGc + 5000)
  }
  return i
}

function findLoadMethodStart(buf, classStart, classEnd) {
  const win = asciiSlice(buf, classStart, classEnd)
  for (const needle of ['load=async()=>{', 'load=async(){', 'load(){']) {
    const rel = win.indexOf(needle)
    if (rel >= 0) return classStart + rel
  }
  return -1
}

function listGcMethodsFull(classBody) {
  const names = []
  const patterns = [
    /#([A-Za-z][\w$]*)\([^)]*\)\{/g,
    /\b(loadRemote|stopRemote|archiveRemote)\([^)]*\)\{/g,
    /\b(load|reload|attachView|setRemoteWanted|constructor|usesStorage|getSnapshot|subscribe)\b/g,
    /\b(holdJob|optimistic|noteDeleteRefusal|updateJobs|updateAdoptedPeers|updateRemoteJobs|updatePendings|seedJobs|settleLandedPendings|kick|watchPendingJobDir|liveStatus|terminalHolderOf|bumpGen|resetPrFetchGate|isDeleting|isDeletingSession|isHolding|isArchiving)\b/g,
    /#O\s*=\s*\(\)\s*=>\s*\{/g,
    /#O\s*=\s*\(\)\s*\{/g,
  ]
  for (const re of patterns) {
    let m
    while ((m = re.exec(classBody))) {
      const n = m[1] ?? m[0].replace(/\s/g, '')
      if (n && !names.includes(n)) names.push(n.startsWith('#') ? n : n)
    }
  }
  if (classBody.includes('#O=()=>')) names.push('#O')
  if (classBody.includes('load=async()')) names.push('load')
  if (classBody.includes('reload=()=>')) names.push('reload')
  return names
}

function compareNeedle(label, needleStr) {
  section(`247vs248 ${label} needle=${JSON.stringify(needleStr)}`)
  const n = Buffer.from(needleStr)
  const h248 = allHits(b248, needleStr)
  const h247 = b247 ? allHits(b247, needleStr) : []
  lines.push(`hits248=${h248.length} hits247=${h247.length}`)
  if (h248.length) lines.push(`248 offsets (first 8)=${h248.slice(0, 8).join(',')}`)
  if (h247.length) lines.push(`247 offsets (first 8)=${h247.slice(0, 8).join(',')}`)
  const sig248 =
    h248.length > 0
      ? sha(asciiSlice(b248, h248[0] - 40, h248[0] + 420))
      : 'none'
  const sig247 =
    b247 && h247.length > 0
      ? sha(asciiSlice(b247, h247[0] - 40, h247[0] + 420))
      : 'none'
  lines.push(`windowSha248=${sig248} windowSha247=${sig247} same=${sig248 === sig247 && sig248 !== 'none'}`)
  lines.push('')
}


section('OFFSETS-KNOWN')
lines.push(JSON.stringify(OFF, null, 2))
lines.push('')

const gcStart = findClassGc(b248)
section(`class gc locate`)
lines.push(`findClassGc=${gcStart} known=${OFF.classGc} delta=${gcStart - OFF.classGc}`)
lines.push('')

dumpFn('Fh', b248, b248.indexOf(Buffer.from('function Fh(){'), OFF.Fh - 200))
dumpBalanced('Fh-body', b248, b248.indexOf(Buffer.from('function Fh(){'), OFF.Fh - 200), 800)
dumpSlice('Dh-export-window', b248, OFF.DhExport, 120, 520)

const gcBrace = gcStart >= 0 ? asciiSlice(b248, gcStart, gcStart + 20).indexOf('{') : -1
const gcBodyStart = gcStart >= 0 && gcBrace >= 0 ? gcStart + gcBrace : gcStart
const gcFull = gcBodyStart >= 0 ? extractBalancedFrom(b248, gcBodyStart, 200000) : { missEnd: true }
if (gcFull.body) {
  section(`class gc FULL @${gcStart}`)
  lines.push(`len=${gcFull.len} sha=${gcFull.sha} end@${gcFull.endOffset}`)
  lines.push(gcFull.body)
  lines.push('')
  section('class gc METHOD-LIST')
  lines.push(listGcMethodsFull(gcFull.body).join(', '))
  lines.push('')
} else {
  section('class gc FULL')
  lines.push('CHUNKED — full balanced miss; dumping windows')
  lines.push(JSON.stringify(gcFull))
  lines.push('')
  dumpSlice('gc-head-8k', b248, gcStart, 0, 8000)
  dumpSlice('gc-mid-load', b248, OFF.loadPrStatuses - 400, 0, 3500)
  dumpSlice('gc-tail-pr', b248, OFF.pruneLi - 200, 0, 2500)
}

const loadStart = gcFull.endOffset
  ? findLoadMethodStart(b248, gcStart, gcFull.endOffset)
  : b248.indexOf(Buffer.from('load(){'), OFF.loadPrStatuses - 8000)
if (loadStart >= 0) dumpBalanced('gc.load', b248, loadStart, 25000)

dumpSlice('#x-attachView-context', b248, OFF.hashX - 200, 0, 1100)
dumpFn('#x', b248, asciiSlice(b248, OFF.hashX - 80, OFF.hashX + 80).indexOf('#x') >= 0 ? OFF.hashX + asciiSlice(b248, OFF.hashX - 80, OFF.hashX + 80).indexOf('#x') : OFF.hashX, 2500)
dumpFn('#I', b248, b248.indexOf(Buffer.from('#I(){'), OFF.hashX), 2000)
dumpFn('#P', b248, b248.indexOf(Buffer.from('#P(){'), OFF.hashX), 2000)
dumpFn('#p', b248, OFF.hashP, 800)
dumpFn('#E', b248, OFF.hashE, 1200)

dumpSlice('load-Oo-prStatuses', b248, OFF.loadPrStatuses, 500, 900)
dumpSlice('prStatuses.get-filter', b248, OFF.prGetFilter, 400, 700)
dumpSlice('fetchPrStatusBatch-call', b248, OFF.fetchBatchCall, 200, 900)
dumpBalanced('#E-merge-callback', b248, OFF.hashEMerge, 2500)
dumpSlice('prune-Li-prStatuses', b248, OFF.pruneLi, 350, 600)

dumpFn('V$n', b248, OFF.V$n, 20000)
dumpFn('K$n', b248, OFF.K$n, 800)
dumpFn('q$n', b248, OFF.q$n, 800)
dumpFn('uXe', b248, OFF.uXe, 1200)

const ooFleet = lastFnStart(b248, OFF.pruneLi + 5000, ['function Oo('])
section('Oo fleet candidate')
lines.push(JSON.stringify(ooFleet))
if (ooFleet.i >= 0) dumpFn('Oo', b248, ooFleet.i, 4000)

for (const n of ['ensureFleetRoster', 'function rp(', 'function Xw(']) {
  const hits = allHits(b248, n)
  section(`needle ${n}`)
  lines.push(`hits=${hits.length} first=${hits[0] ?? 'none'}`)
  if (hits[0] != null) dumpSlice(n, b248, hits[0], 80, 450)
}

dumpSlice('rp-props', b248, OFF.rp, 0, 400)
dumpSlice('Ze(or)-prStatuses', b248, OFF.ZeOr, 120, 350)
dumpSlice('Xw-prStatuses', b248, OFF.Xw, 80, 120)

compareNeedle('class gc', 'class gc{')
compareNeedle(
  '#x loadPrStatusCache',
  'prStatuses.size===0)this.#e.loadPrStatusCache(this.#n).then((d)=>{if(d.size)this.#E((m)=>m.size?new Map([...d,...m]):d)}',
)
compareNeedle('#E persist', '#E(i){let d=this.#t.prStatuses;if(this.#p("prStatuses",i),this.#t.prStatuses!==d)this.#e.persistPrStatusCache(this.#t.prStatuses,this.#n)}')
compareNeedle('V$n head', 'async function V$n(e){let t=new Map,r=[],o=null;')

if (b247) {
  const m247 = b247.indexOf(Buffer.from('class Mf{#r;#e;#a=Tt();#t=Tk()'))
  section('247 fleet roster class Mf')
  lines.push(`hit=${m247}`)
  if (m247 >= 0) {
    const ext = extractBalancedFrom(
      b247,
      m247 + asciiSlice(b247, m247, m247 + 12).indexOf('{'),
      200000,
    )
    if (ext.body) {
      lines.push(`len=${ext.len} sha=${ext.sha}`)
      lines.push(ext.body.slice(0, 1200) + '...(trunc in gold; full in re-peel if needed)')
    }
  }
  compareNeedle(
    '247 attach loadPrStatusCache (storage #r)',
    'prStatuses.size===0)this.#e.loadPrStatusCache(this.#r).then((t)=>{if(t.size)this.#C((o)=>o.size?new Map([...t,...o]):t)}',
  )
  compareNeedle('248 uXe log', 'loadPrStatusCache: dropped')
  lines.push('')
}

lines.push('## CONTRACT')
lines.push(
  '#16 unique knife (248): uXe @184559295 — RJt().safeParse per entry, log `loadPrStatusCache: dropped N malformed cache entries`, return Map (248 log string absent in 247 SEA).',
)
lines.push(
  'Roster host (248): class gc @192130933 sha=e74a66069314570f, snapshot Fh() includes prStatuses Map; attachView→#x loads K$n when prStatuses.size===0, merges via #E; #E calls q$n on Map identity change after #p("prStatuses").',
)
lines.push(
  '247 SEA: same product wiring under class Mf @223695xxx + Tk() (NOT named gc — gc{ in 247 is unrelated @azure/msal). attachView→#I, persist hook #C, storage this.#r. loadPrStatusCache merge path ALREADY in 247.',
)
lines.push(
  'Leftover missing production (official — do NOT invent): class gc/Mf-equivalent roster module, Fh/Tk snapshot, Dh/Ok client export, attachView/#x/#P/#I/#E/#p, load() Oo(state,prStatuses)+href batch+Li prune, ensureFleetRoster, V$n/G$n, K$n/q$n/uXe wiring from store, FleetView rp({prStatuses}) / Xw / Ze(or).',
)
lines.push(
  'Leftover rejects (from gold-248-16-host-hunt): src/utils/prStatusCache.ts (helpers only), AgentView useState maps, prViewCache/prCheckCache, usePrStatus/wY, prStatusPoller JE().',
)
lines.push('')

writeFileSync(outGold, lines.join('\n'))
console.log('WROTE', outGold, 'lines', lines.length)
if (gcFull.body)
  console.log('gc len', gcFull.len, 'methods', listGcMethodsFull(gcFull.body).length)
