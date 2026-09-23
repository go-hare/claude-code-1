/**
 * Peel densable 2.1.248 #18: ye/lt/Du/openNewSessionRow + drop-query path.
 * Gold: ye(X.origin) @192261457; willInsertNewline @192073232/@192269870.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  loadSea,
  asciiSlice,
  sha,
  allHits,
  extractFnAt,
  lastFnStart,
  lastFnStartGeneric,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const buf = loadSea(EXE_248)
const lines = [`when=${new Date().toISOString()}`, `seaLen=${buf.length}`]

function log(s) {
  lines.push(s)
  console.log(s)
}

function dumpWin(label, off, before = 400, after = 800) {
  log('')
  log(`## ${label} @${off}`)
  log(asciiSlice(buf, off - before, off + after))
}

function dumpHits(label, needle, ctxBefore = 80, ctxAfter = 160, cap = 12) {
  const hits = allHits(buf, needle)
  log('')
  log(`## ${label} needle=${JSON.stringify(needle)} hits=${hits.length}`)
  for (const [i, h] of hits.slice(0, cap).entries()) {
    log(
      `- #${i} @${h} ${asciiSlice(buf, h - ctxBefore, h + needle.length + ctxAfter)}`,
    )
  }
  if (hits.length > cap) log(`- … +${hits.length - cap} more`)
  return hits
}

function extractNear(label, off, names, maxLen = 20000) {
  const found = lastFnStart(buf, off + 40, names)
  log('')
  log(`## extractNear ${label} before=@${off} found=${found.name}@${found.i}`)
  if (found.i < 0) {
    const gen = lastFnStartGeneric(buf, off + 40, 12000)
    log(`generic ${gen.name}@${gen.i}`)
    if (gen.i >= 0) {
      const ext = extractFnAt(buf, gen.i, maxLen)
      if (ext.body) {
        log(`sha=${ext.sha} len=${ext.len}`)
        log(ext.body)
      } else log(JSON.stringify(ext))
    }
    return
  }
  const ext = extractFnAt(buf, found.i, maxLen)
  if (ext.body) {
    log(`sha=${ext.sha} len=${ext.len}`)
    log(ext.body)
  } else {
    log(JSON.stringify({ miss: ext.miss, missEnd: ext.missEnd, preview: ext.preview }))
    dumpWin(`preview-${label}`, found.i, 0, 600)
  }
}

const FLEET_LO = 191900000
const FLEET_HI = 192400000

function hitsInFleet(needle) {
  return allHits(buf, needle).filter((h) => h >= FLEET_LO && h < FLEET_HI)
}

// --- known gold offsets ---
dumpWin('ye(X.origin) gold', 192261457, 500, 900)
dumpWin('willInsertNewline @192073232', 192073232, 600, 1200)
dumpWin('willInsertNewline @192269870', 192269870, 400, 900)
dumpWin('openNewSessionRow:lt @192159479', 192159479, 200, 400)
dumpWin('openNewSessionRow:ye @192252775', 192252775, 200, 400)
dumpWin('openNewSessionRow:Du @192280375', 192280375, 800, 1200)
dumpWin('lt(Ie.origin) @192165261', 192165261, 400, 600)

// --- find Du / ye / lt definitions in fleet band ---
for (const n of [
  'let Du=',
  'Du=(',
  'Du=async',
  'const Du=',
  'Du=useCallback',
  'Du=Q.useCallback',
  'Du=Cf.useCallback',
  'function Du(',
  'async function Du(',
  'let ye=',
  'ye=async',
  'function ye(',
  'let lt=',
  'lt=async',
  'function lt(',
  'openNewSessionRow',
  'beginNewSession',
  'newSessionOpening',
]) {
  const hits = hitsInFleet(n)
  log('')
  log(`## fleetHits ${JSON.stringify(n)} count=${hits.length} ${hits.join(',')}`)
  for (const h of hits.slice(0, 8)) {
    log(`-- @${h} ${asciiSlice(buf, h - 80, h + n.length + 220)}`)
  }
}

// last function before ye(X.origin)
extractNear(
  'caller-of-ye(X.origin)',
  192261457,
  [
    'function Lc(',
    'function JIy(',
    'function Fs(',
    'function ye(',
    'async function ye(',
    'function lt(',
    'function Du(',
  ],
  25000,
)

// last function before Du alias in submit object
extractNear(
  'caller-of-Du-alias',
  192280375,
  ['function ', 'async function '],
  8000,
)

// search Du= in a wider window before the alias
{
  const winStart = 192240000
  const win = asciiSlice(buf, winStart, 192285000)
  const re = /(?:let |const |var )?Du\s*=/g
  let m
  log('')
  log('## Du= in 192240000-192285000')
  while ((m = re.exec(win))) {
    const abs = winStart + m.index
    log(`@${abs} ${asciiSlice(buf, abs, abs + 400)}`)
  }
}

{
  const winStart = 192240000
  const win = asciiSlice(buf, winStart, 192285000)
  for (const ident of ['ye=', 'lt=', 'mf=']) {
    let idx = 0
    log('')
    log(`## ${ident} in 192240000-192285000`)
    let found = 0
    while (found < 8) {
      const k = win.indexOf(ident, idx)
      if (k < 0) break
      const abs = winStart + k
      const prev = win[k - 1] || ''
      if (/[A-Za-z0-9_$]/.test(prev)) {
        idx = k + ident.length
        continue
      }
      log(`@${abs} ${asciiSlice(buf, abs, abs + 350)}`)
      found++
      idx = k + ident.length
    }
  }
}

// --- drop-query needles in fleet band ---
for (const n of [
  'setQuery("")',
  "setQuery('')",
  'setQuery(``)',
  'yo("")',
  "yo('')",
  'Ke("")',
  "Ke('')",
  'setQueryAndCursor',
  'clearQuery',
  'dropQuery',
  'typed prompt',
  'Couldn\'t start a new session',
  'newSessionOpening',
  'beginNewSession',
  'xAe(',
  'kind:"newsession"',
  'kind==="newsession"',
]) {
  dumpHits(`#18 ${n}`, n, 60, 180, 8)
}

// willInsertNewline definition: look backward from return {..., willInsertNewline:xe
extractNear(
  'willInsertNewline-return',
  192073232,
  ['function GP(', 'function Zu(', 'function vpc(', 'function '],
  12000,
)

// JIy / Lc around newsession enter
for (const n of ['function JIy(', 'function Lc(', 'function Fs(', 'function Zu(']) {
  const hits = hitsInFleet(n)
  log('')
  log(`## fleetFn ${n} count=${hits.length} ${hits.join(',')}`)
  for (const h of hits.slice(0, 4)) {
    const ext = extractFnAt(buf, h, 30000)
    if (ext.body) {
      log(`@${h} sha=${ext.sha} len=${ext.len}`)
      // only dump if mentions newsession / openNewSession / willInsertNewline
      const keys = ['newsession', 'openNewSession', 'willInsertNewline', 'setQuery', 'ye(', 'lt(', 'Du(']
      const hitsKeys = keys.filter((k) => ext.body.includes(k))
      log(`keys=${hitsKeys.join(',')}`)
      if (hitsKeys.length) log(ext.body.slice(0, 4000) + (ext.body.length > 4000 ? '\n…TRUNC…' : ''))
    } else log(`@${h} miss ${JSON.stringify(ext)}`)
  }
}

writeFileSync(`${outDir}/gold-248-18-newsession.txt`, lines.join('\n'))
console.log('wrote', `${outDir}/gold-248-18-newsession.txt`, 'lines', lines.length)
