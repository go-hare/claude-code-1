/**
 * #31 pass2 — confirm unique 248 reconnect-repaint vs 247 JS
 * (not UTF-16 string table). Invent-ban.
 */
import { writeFileSync } from 'fs'
import {
  EXE_247,
  EXE_248,
  loadSea,
  asciiSlice,
  sha,
  allHits,
  extractFnAt,
  lastFnStartGeneric,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const b248 = loadSea(EXE_248)
const b247 = loadSea(EXE_247)
const lines = [
  '# gold-248-unk-31b',
  `when=${new Date().toISOString()}`,
  '',
]

function cnt(buf, n) {
  return allHits(buf, n).length
}

function jsHits(buf, n) {
  // JS heap in these SEAs starts ~178e6; skip UTF-16 string tables
  return allHits(buf, n).filter(i => i > 170000000)
}

function dumpNear(buf, label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function dumpFn(buf, label, i, maxLen = 8000) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) {
    lines.push('MISS')
    lines.push('')
    return { miss: true }
  }
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    const other = buf === b248 ? b247 : b248
    const inOther = other.indexOf(Buffer.from(ext.body))
    lines.push(
      `len=${ext.len} sha=${ext.sha} exactOther=${inOther >= 0 ? inOther : 0}`,
    )
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
  return ext
}

const needles = [
  'resendUndeliveredResponses',
  'giveUpOnSettle',
  'giveUpUndeliveredResponses',
  'dropUndeliveredResponses',
  'undeliveredResponses',
  'afterConnect()',
  'afterConnect',
  'afterDisconnect',
  'workerSeenThisConnection',
  'dirSync?.sync.afterConnect',
  'ye("requires_action"',
  "ye('requires_action'",
  'reportState("requires_action")',
  "reportState('requires_action')",
  'pe.size>0',
  'findLast((t)=>t.details',
  'findLast((o)=>o.details',
  'Ze.clear()',
  'this.resendUndeliveredResponses()',
  'keepStreamRedialling',
  'onCatchUpTruncated',
  'Catch-up truncated',
]

lines.push('# ==== JS counts (off>170e6) ====')
for (const n of needles) {
  const a = jsHits(b248, n).length
  const b = jsHits(b247, n).length
  const aAll = cnt(b248, n)
  const bAll = cnt(b247, n)
  lines.push(
    `- ${JSON.stringify(n)} js248=${a} js247=${b} all248=${aAll} all247=${bAll}${a > 0 && b === 0 ? ' **NEW248-JS**' : ''}`,
  )
}
lines.push('')

// extract 248 setOnConnect body (already have fn @198351726)
const fn248 = b248.indexOf(Buffer.from('function fn(){C.setOnConnect(()=>{if(x)return;if(clearTimeout(rr)'))
dumpFn(b248, '#31 248 fn setOnConnect', fn248, 2500)

// 247 twin of setOnConnect remote-bridge
for (const n of [
  'function fn(){C.setOnConnect',
  'C.setOnConnect(()=>{',
  '.setOnConnect(()=>{if(',
  '[remote-bridge] v2 transport connected',
]) {
  const hs = jsHits(b247, n)
  lines.push(`247 JS ${JSON.stringify(n)} n=${hs.length} ${hs.slice(0, 6).join(',')}`)
  for (const i of hs.slice(0, 3)) {
    dumpNear(b247, `#31 247 JS ${n}`, i, 200, 800)
    const st = lastFnStartGeneric(b247, i, 8000)
    lines.push(`- enclosing 247 ${st.name} @${st.i}`)
    if (st.i >= 0) dumpFn(b247, `#31 247-fn ${st.name}`, st.i, 4000)
  }
}

// 247 RemoteSessionManager onConnected JS
for (const n of [
  '[RemoteSessionManager] Connected',
  'resendUndeliveredResponses',
  'giveUpOnSettle==="undelivered"',
  'this.resendUndeliveredResponses()',
]) {
  const hs = jsHits(b247, n)
  lines.push(`247 RSM ${JSON.stringify(n)} n=${hs.length}`)
  for (const i of hs.slice(0, 3)) dumpNear(b247, `#31 247 RSM ${n}`, i, 150, 700)
}

// 248 RSM methods
for (const n of [
  'resendUndeliveredResponses(){',
  'giveUpUndeliveredResponses(){',
  'dropUndeliveredResponses(){',
  'afterConnect(){',
]) {
  const a = jsHits(b248, n)
  const b = jsHits(b247, n)
  lines.push(`method ${n} 248=${a.length} 247=${b.length}${a.length && !b.length ? ' **NEW248**' : ''}`)
  for (const i of a.slice(0, 2)) {
    dumpNear(b248, `#31 248 method ${n}`, i, 40, 1200)
    const st = lastFnStartGeneric(b248, i, 4000)
    if (st.i >= 0) dumpFn(b248, `#31 248 method-fn ${st.name}`, st.i, 3000)
  }
  for (const i of b.slice(0, 2)) {
    dumpNear(b247, `#31 247 method ${n}`, i, 40, 1200)
  }
}

// exact body presence: 248 pe.size reconnect-repaint snippet in 247?
const snippets = [
  'pe.size>0){let o=[...pe.values()].findLast((t)=>t.details!==void 0);ye("requires_action",o?.details),Ze.clear()}',
  'ye("requires_action",o?.details)',
  'this.resendUndeliveredResponses()',
  'this.config.dirSync?.sync.afterConnect()',
  't.giveUpOnSettle==="undelivered"',
  'giveUpOnSettle==="undelivered"',
]
lines.push('# ==== exact snippet in 247 ====')
for (const s of snippets) {
  const i248 = b248.indexOf(Buffer.from(s))
  const i247 = b247.indexOf(Buffer.from(s))
  lines.push(`- ${JSON.stringify(s)} 248=${i248} 247=${i247}${i248 >= 0 && i247 < 0 ? ' **NEW248**' : ''}`)
}
lines.push('')

// leftover-shaped remoteBridgeCore setOnConnect vs official
const leftoverShape = [
  'if($t&&en)Ne($t,en)',
  'onTransportPersistenceReady',
  'skipInitialHistoryFlush',
  'flushHistory',
  'authRecoveryInFlight',
]
lines.push('# ==== leftover remoteBridgeCore shapes ====')
for (const n of leftoverShape) {
  lines.push(
    `- ${JSON.stringify(n)} 248=${cnt(b248, n)} 247=${cnt(b247, n)} js248=${jsHits(b248, n).length} js247=${jsHits(b247, n).length}`,
  )
}

writeFileSync(`${outDir}/gold-248-unk-31b.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-unk-31b.txt`, 'lines', lines.length)
