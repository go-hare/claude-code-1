/**
 * densable 2.1.248 UNKNOWN wave9 — #14 #21 #28 #31 #36
 * Unique body + leftover host only. Invent-ban. No checklist/board.
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
  lastFnStart,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const b248 = loadSea(EXE_248)
const b247 = loadSea(EXE_247)

const lines = [
  '# gold-248-unk-wave9',
  `when=${new Date().toISOString()}`,
  `sea248=${EXE_248} bytes=${b248.length}`,
  `sea247=${EXE_247} bytes=${b247.length}`,
  'items=#14 #21 #28 #31 #36',
  'rule=extract unique 248 body AND leftover host, else stay UNKNOWN',
  '',
]

function cnt(buf, n) {
  return allHits(buf, n).length
}

function only248(n) {
  const a = cnt(b248, n)
  const b = cnt(b247, n)
  return { a, b, uniq: a > 0 && b === 0 }
}

function dumpHits(label, needle, around = 140, cap = 8, minOff = 0) {
  const hits = allHits(b248, needle).filter(i => i >= minOff)
  const c247 = cnt(b247, needle)
  lines.push(
    `## ${label}  needle=${JSON.stringify(needle)}  248=${hits.length} 247=${c247}${c247 === 0 && hits.length ? '  **NEW248**' : ''}`,
  )
  for (const [idx, i] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${idx} @${i} ${asciiSlice(b248, i - around, i + needle.length + around)}`,
    )
  }
  if (hits.length > cap) lines.push(`- … +${hits.length - cap} more`)
  lines.push('')
  return hits
}

function dumpFn(label, i, maxLen = 8000) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) {
    lines.push('MISS')
    lines.push('')
    return { miss: true }
  }
  const ext = extractFnAt(b248, i, maxLen)
  if (ext.body) {
    const in247 = b247.indexOf(Buffer.from(ext.body))
    lines.push(`len=${ext.len} sha=${ext.sha} exact247=${in247 >= 0 ? in247 : 0}`)
    lines.push(ext.body)
  } else {
    lines.push(`MISS ${JSON.stringify(ext)}`)
  }
  lines.push('')
  return ext
}

function dumpFn247(label, i, maxLen = 8000) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) {
    lines.push('MISS')
    lines.push('')
    return { miss: true }
  }
  const ext = extractFnAt(b247, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else {
    lines.push(`MISS ${JSON.stringify(ext)}`)
  }
  lines.push('')
  return ext
}

function dumpNear(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(b248, i - before, i + after))
  lines.push('')
}

function dumpNear247(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(b247, i - before, i + after))
  lines.push('')
}

function extractNear(label, i, maxLook = 8000, maxLen = 8000) {
  const start = lastFnStartGeneric(b248, i, maxLook)
  lines.push(`## ${label} near@${i} fn=${start.name} @${start.i}`)
  return dumpFn(`${label} ${start.name}`, start.i, maxLen)
}

// ============================================================================
// #14 model-name-code
// ============================================================================
lines.push('# ==== #14 model-name-code ====')
const n14 = [
  'function JKt(',
  'function Dv(',
  'Fast mode ON',
  'Fast mode OFF',
  'sonnet[1m]',
  'opus[1m]',
  '[1m]',
  '`sonnet',
  '`opus',
  'render as code',
  ' as code',
  'markdown code',
  'wrapCode',
  'asCode',
  'code:!0',
  'type:"code"',
  'kind:"code"',
  'inverse:',
  'createElement(Code',
  '<Code',
  '](1m]',
  '](1m',
  'OSC8',
  'fast-mode-toggled',
  'model-switch-fast-mode',
  'FAST_MODE_MODEL_DISPLAY',
  'available with ',
  'model set to ',
  'bold:!0,children:',
]
for (const n of n14) {
  const { a, b, uniq } = only248(n)
  lines.push(`- count ${JSON.stringify(n)} 248=${a} 247=${b}${uniq ? ' **NEW248**' : ''}`)
}
lines.push('')

for (const i of allHits(b248, 'function JKt(')) dumpFn('#14 JKt', i, 4000)
for (const i of allHits(b247, 'function JKt(').slice(0, 3))
  dumpFn247('#14 247-JKt', i, 4000)

for (const i of allHits(b248, 'function Dv(').slice(0, 8)) dumpFn('#14 Dv', i, 2500)

// Fast-mode notice windows + covering fn
for (const n of ['Fast mode ON', 'fast-mode-toggled', 'model-switch-fast-mode']) {
  for (const i of allHits(b248, n).filter(x => x > 170000000).slice(0, 6)) {
    dumpNear(`#14 ${n}-win`, i, 120, 400)
    extractNear(`#14 ${n}-fn`, i, 4000, 5000)
  }
}

// markdown backtick wrap near model / fast
for (const n of [
  'children:[`',
  'bold:!0,children:[`',
  'children:[`sonnet',
  'children:[`opus',
  'children:[`claude',
  '`+[',
  '+`]',
  '"`"+',
  "+'`'",
  'wrapInBackticks',
  'asMarkdownCode',
  'markdownCode',
  'renderModel',
  'formatModelName',
  'modelDisplayName',
]) {
  dumpHits(`#14 wrap ${n}`, n, 80, 6, 170000000)
}

// leftover-shaped strings
for (const n of [
  'Fast mode is ',
  'available with ',
  'Switching to other models',
  'model set to ',
  'Use /fast',
  'to turn on Fast mode',
]) {
  dumpHits(`#14 leftoverish ${n}`, n, 100, 4, 170000000)
}

// ============================================================================
// #21 hook-invalid-answer — fleet row that names hook+schema
// ============================================================================
lines.push('# ==== #21 hook-invalid-answer ====')
const n21 = [
  'function Swt(',
  'function Owt(',
  'function UFe(',
  'function lq(',
  'function _P(',
  'PermissionRequest decision must be',
  'top-level decision is the legacy',
  'hookSpecificOutput is missing required field',
  'Hook JSON output validation failed',
  'Expected schema:',
  'schema error',
  'hook schema',
  'invalid answer',
  'waiting silently',
  'hookName} hook',
  '${e.hookName}',
  'JSON validation failed: ',
  'async hook JSON output failed schema validation',
  'topDialogWaitingFor',
  'waitingFor:',
  'lastMessage:',
  'updateSessionActivity',
]
for (const n of n21) {
  const { a, b, uniq } = only248(n)
  lines.push(`- count ${JSON.stringify(n)} 248=${a} 247=${b}${uniq ? ' **NEW248**' : ''}`)
}
lines.push('')

for (const i of allHits(b248, 'function Swt(')) dumpFn('#21 Swt', i, 2000)
for (const i of allHits(b247, 'function Swt(').slice(0, 2))
  dumpFn247('#21 247-Swt', i, 800)
for (const i of allHits(b248, 'function Owt(').slice(0, 2)) dumpFn('#21 Owt', i, 800)
for (const i of allHits(b248, 'function UFe(').slice(0, 2)) dumpFn('#21 UFe', i, 800)

// unique 248 strings that might be fleet row copy
for (const n of [
  'PermissionRequest decision must be',
  'top-level decision is the legacy',
  ' hook error',
  'hook + schema',
  'hook and schema',
  'schemaError',
  'hookSchemaError',
  'invalidHook',
  'hook_validation',
  'hookValidation',
]) {
  dumpHits(`#21 uniq ${n}`, n, 160, 6)
}

// who SETS waitingFor / lastMessage from hook?
for (const n of [
  'waitingFor:C',
  'waitingFor:e',
  'waitingFor:t',
  'waitingFor:`',
  'lastMessage:`',
  'lastMessage:e',
  'topDialogWaitingFor=',
  'topDialogWaitingFor:',
]) {
  dumpHits(`#21 set ${n}`, n, 100, 6, 170000000)
}

// _P unique sig from pass3
const pSig = 'function _P('
dumpHits('#21 _P-sig', pSig, 80, 8)
for (const i of allHits(b248, pSig).slice(0, 6)) dumpFn('#21 _P', i, 3000)

// fleet lastMessage from hook validation
for (const n of [
  'JSON validation failed',
  'validationError',
  'hookName+" "',
  'hookName, "hook',
]) {
  for (const i of allHits(b248, n).filter(x => x > 190000000 && x < 210000000).slice(0, 4)) {
    dumpNear(`#21 fleet-region ${n}`, i, 80, 200)
  }
}

// leftover AgentView detail host — does 248 row build hook+schema locally?
for (const n of [
  'waitingFor??',
  'waitingFor ??',
  '.waitingFor??',
  '.waitingFor??.',
  'session.waitingFor',
]) {
  dumpHits(`#21 row ${n}`, n, 80, 6, 200000000)
}

// ============================================================================
// #28 trust-emoji-trunc
// ============================================================================
lines.push('# ==== #28 trust-emoji-trunc ====')
const n28 = [
  'cut off mid-emoji',
  'Intl.Segmenter',
  'granularity:"grapheme"',
  "granularity:'grapheme'",
  'grapheme',
  'toWellFormed',
  'tengu_trust_dialog_shown',
  'TrustDialog',
  'Quick safety check',
  'Allow rules',
  'allow rules',
  'permission rules',
  'repo permission',
  'truncateToWidth',
  'stringWidth',
]
for (const n of n28) {
  const { a, b, uniq } = only248(n)
  lines.push(`- count ${JSON.stringify(n)} 248=${a} 247=${b}${uniq ? ' **NEW248**' : ''}`)
}
lines.push('')

for (const i of allHits(b248, 'cut off mid-emoji'))
  dumpNear('#28 mid-emoji-win', i, 220, 220)
for (const i of allHits(b248, 'Intl.Segmenter')) {
  dumpNear('#28 Segmenter-win', i, 80, 200)
  extractNear('#28 Segmenter-fn', i, 3000, 2500)
}
for (const n of ['granularity:"grapheme"', "granularity:'grapheme'"]) {
  for (const i of allHits(b248, n)) {
    dumpNear(`#28 ${n}`, i, 80, 160)
    extractNear('#28 grapheme-fn', i, 3000, 2000)
  }
}

// TrustDialog shown + Go
for (const i of allHits(b248, 'tengu_trust_dialog_shown').filter(x => x > 170000000)) {
  dumpNear('#28 trust-shown-win', i, 80, 400)
  extractNear('#28 trust-shown-fn', i, 8000, 8000)
}

// rule list truncation APIs unique?
for (const n of [
  'toWellFormed()',
  '.toWellFormed(',
  'segment(text)',
  'segment(e)',
  'segment(t)',
  'graphemeSegments',
  'truncateGrapheme',
  'cutGrapheme',
  'mid-emoji',
  'U+FFFD',
  '\\uFFFD',
  'replacement character',
]) {
  dumpHits(`#28 api ${n}`, n, 80, 5, 170000000)
}

// leftover TrustDialog host: ACCESSING / bash allow rule listing
for (const n of [
  'ACCESSING_CAPABILITY',
  'hasProjectAllowRules',
  'project allow',
  'Bash(',
  'permission rule',
]) {
  dumpHits(`#28 leftoverish ${n}`, n, 100, 4, 170000000)
}

// ============================================================================
// #31 rc-reconnect-prompt
// ============================================================================
lines.push('# ==== #31 rc-reconnect-prompt ====')
const n31 = [
  'silently reconnect',
  'tengu_bridge_reconnected',
  'tengu_bridge_repl_reconnected_in_place',
  'getPendingPermissionRequests',
  'republishSurviving',
  'flushPendingReceipts',
  'afterReconnect',
  'onReconnect',
  'replay permission',
  'permission prompt',
  'latest messages',
  'forceRender',
  'forceUpdate',
  'repaint',
  'resync',
  'undeliveredResponses',
  'flushGate',
  'silent reconnect',
  'reconnect-repaint',
  'reShow',
  'reshow',
  're-show',
  'replayPrompt',
  'replayPermission',
]
for (const n of n31) {
  const { a, b, uniq } = only248(n)
  lines.push(`- count ${JSON.stringify(n)} 248=${a} 247=${b}${uniq ? ' **NEW248**' : ''}`)
}
lines.push('')

for (const n of [
  'tengu_bridge_reconnected',
  'tengu_bridge_repl_reconnected_in_place',
  'getPendingPermissionRequests',
  'republishSurviving',
]) {
  for (const i of allHits(b248, n).filter(x => x > 170000000).slice(0, 4)) {
    dumpNear(`#31 ${n}-win`, i, 80, 300)
    extractNear(`#31 ${n}-fn`, i, 6000, 6000)
  }
}

// compare reconnect fns 248 vs 247
for (const n of ['function dNe(', 'function xe(', 'async function dNe(']) {
  dumpHits(`#31 ${n}`, n, 40, 4)
}

// leftover replBridge unique 248 strings
for (const n of [
  'reconnect-after-env-lost',
  'reconnected_in_place',
  'flush pending',
  'pending permission',
  'latest message',
  'show permission',
]) {
  dumpHits(`#31 leftoverish ${n}`, n, 80, 4)
}

// ============================================================================
// #36 mention-ime
// ============================================================================
lines.push('# ==== #36 mention-ime ====')
const n36 = [
  'non-Latin',
  'IME',
  'toLocaleLowerCase',
  'localeCompare',
  'normalize("NFKC")',
  "normalize('NFKC')",
  'normalize("NFKD")',
  "normalize('NFKD')",
  'normalize("NFD")',
  'normalize("NFC")',
  'hangul',
  'Hangul',
  'Korean',
  'isComposing',
  'foldCase',
  'tengu_at_mention_peer_',
  'peer_mention',
  '@mention',
  'mentionQuery',
  'composition',
]
for (const n of n36) {
  const { a, b, uniq } = only248(n)
  lines.push(`- count ${JSON.stringify(n)} 248=${a} 247=${b}${uniq ? ' **NEW248**' : ''}`)
}
lines.push('')

for (const i of allHits(b248, 'non-Latin'))
  dumpNear('#36 non-Latin-win', i, 200, 200)
for (const i of allHits(b248, 'tengu_at_mention_peer_').filter(x => x > 170000000)) {
  dumpNear('#36 mention-analytics-win', i, 80, 300)
  extractNear('#36 mention-fn', i, 4000, 6000)
}

for (const n of ['normalize("NFKC")', "normalize('NFKC')"]) {
  const hits = allHits(b248, n).filter(x => x > 170000000)
  lines.push(`## #36 ${n} code-hits=${hits.length}`)
  for (const i of hits.slice(0, 10)) {
    dumpNear(`#36 NFKC @${i}`, i, 80, 180)
    extractNear('#36 NFKC-fn', i, 2500, 2000)
  }
}

// leftover host fold vs unique 248
for (const n of [
  'function kp(',
  'function vu(',
  'function dr(',
  'function normalizeSessionNameKey(',
  'toLocaleLowerCase()',
  'localeCompare(',
]) {
  dumpHits(`#36 fold ${n}`, n, 80, 6)
}

// compare leftover-shaped NFKC body
const leftoverNfkc =
  '.normalize("NFKC").replace(/[\\p{Cc}\\p{Cf}]/gu'
dumpHits('#36 leftover-NFKC-shape', leftoverNfkc, 80, 4)
dumpHits('#36 leftover-NFKC-shape2', 'normalize("NFKC")', 80, 8, 180000000)

writeFileSync(`${outDir}/gold-248-unk-wave9.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-unk-wave9.txt`, 'lines', lines.length)
