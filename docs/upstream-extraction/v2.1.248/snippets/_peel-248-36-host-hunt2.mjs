/**
 * #36 host-hunt pass2 — extract bP typeahead regex + 247 caller fold
 */
import { writeFileSync, appendFileSync } from 'fs'
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

const out = 'docs/upstream-extraction/v2.1.248/snippets/gold-248-36-host-hunt.txt'
const b248 = loadSea(EXE_248)
const b247 = loadSea(EXE_247)
const lines = ['', '# ---- pass2 bP + 247 caller ----', `when=${new Date().toISOString()}`, '']

function dumpNear(buf, label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function dumpHits(label, needle) {
  const a = allHits(b248, needle)
  const b = allHits(b247, needle)
  lines.push(`## ${label}  needle=${JSON.stringify(needle)}  248=${a.length}@${a.slice(0, 10)}  247=${b.length}@${b.slice(0, 10)}`)
}

// bP definition — used as .match(bP)
for (const n of [
  'var bP=',
  'bP=',
  ',bP=',
  'match(bP)',
  'bP=',
]) {
  dumpHits(n, n)
}

// nearby \p{L} @ regex at 202915340 / 202917073
dumpNear(b248, 'pL-202915340', 202915340, 200, 400)
dumpNear(b248, 'pL-202917073', 202917073, 200, 400)
dumpNear(b248, 'pL-92414804', 92414804, 80, 300)
dumpNear(b248, 'pL-92415040', 92415040, 80, 300)

// search for regex literals near gme / typeahead
dumpNear(b248, 'gme-start', 202918553, 80, 400)
dumpNear(b248, 'before-gme-consts', 202918553, 3500, 80)

// leftover-shaped regex in official
for (const n of [
  '/(^|\\s)@',
  'new RegExp',
  '[\\w-]*)$',
  '[\\p{L}\\p{N}',
  '[\\p{L}\\p{M}',
  '\\p{L}\\p{N}_-',
  '\\p{L}',
]) {
  dumpHits(`lit ${n}`, n)
}

// 247 typeahead around send message · @232530811
dumpNear(b247, '247 send-message-dot', 232530811, 800, 400)
{
  const fn = lastFnStartGeneric(b247, 232530811, 15000)
  lines.push(`## 247 typeahead-fn name=${fn.name} i=${fn.i}`)
  dumpNear(b247, '247 typeahead-fn-start', fn.i, 200, 200)
}

// 247 match after @
dumpNear(b247, '247 at-re-197077772', 197077772, 80, 250)
dumpNear(b247, '247 at-re-232523516', 232523516, 200, 400)
dumpNear(b247, '247 pL-197077576', 197077576, 80, 300)
dumpNear(b247, '247 pL-232521839', 232521839, 200, 400)

// Does 247 fold query with Dr?
for (const n of [
  'Dr(jn[2]',
  'dr(jn[2]',
  'Bn=dr(',
  'Bn=Dr(',
  '.toLowerCase().startsWith(',
  'Dr(_n.name)',
  'dr(_n.name)',
]) {
  dumpHits(`fold ${n}`, n)
}

appendFileSync(out, lines.join('\n'), 'utf8')
console.log('appended', lines.length)
