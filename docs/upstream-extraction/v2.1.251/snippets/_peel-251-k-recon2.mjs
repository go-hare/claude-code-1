/**
 * densable 2.1.251 SEA peel recon2 — leftover callees for gold-251-k.
 */
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
  sha,
} from './_peel-251-helpers.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const buf = loadSea()
const lines = []
const log = s => {
  lines.push(s)
  console.log(s)
}

function dumpHits(needle, cap = 15, win = 90) {
  const hits = allHits(buf, needle)
  log(`${JSON.stringify(needle)} hits=${hits.length}`)
  for (const i of hits.slice(0, cap)) {
    const fn = lastFnStartGeneric(buf, i, 16000)
    log(
      `  @${i} lastFn=${fn.name}@${fn.i} | ${asciiSlice(buf, i - 20, i + win).replace(/\s+/g, ' ')}`,
    )
  }
}

function extractAt(i, maxLen = 16000) {
  const fn = extractFnAt(buf, i, maxLen)
  log(
    `extract @${i} miss=${!!fn.miss || !!fn.missEnd} len=${fn.len ?? 0} sha=${fn.sha ?? '-'}`,
  )
  if (fn.body) log(fn.body)
  else log((fn.preview || '').slice(0, 400))
  log('---')
  return fn
}

log('=== DVt / HA forms ===')
for (const n of [
  'DVt',
  ' DVt',
  'DVt=',
  'DVt =',
  'var DVt',
  'let DVt',
  'const DVt',
  'async function DVt',
  'function DVt',
  'HA=',
  'var HA',
  'let HA',
  'const HA',
  'async function HA',
  '{HA as',
  'HA as ',
  'HA,',
]) {
  dumpHits(n, 8, 70)
}

log('\n=== window around dpe HA/DVt ===')
log(asciiSlice(buf, 184388254, 184388254 + 520))
log('\n=== window around S0e HA restore ===')
log(asciiSlice(buf, 184387040, 184387040 + 320))

log('\n=== search HA(e,t) and utimes-like ===')
for (const n of [
  'await HA(',
  'function HA(e,t)',
  'async function HA(e',
  'HA=async',
  'utimes',
  'futimes',
  'refresh the set-aside',
  'isRetentionExemptionDisabled',
]) {
  dumpHits(n, 10, 80)
}

log('\n=== #33 _ g J near uo ===')
const uo = 204655316
log('chunk window before uo (imports):')
log(asciiSlice(buf, 204650800, 204651700))
log('--- switch site ---')
log(asciiSlice(buf, 204655580, 204655960))

for (const n of [
  'function _(e)',
  'function _(t)',
  'function _(',
  'function g(e,t)',
  'function g(e,',
  'function J(e,t,r)',
  'function J(',
  'zy().markOwnsControllingTerminal',
  'function zy(',
]) {
  dumpHits(n, 12, 80)
}

log('\n=== last function _( before uo ===')
{
  const needle = Buffer.from('function _(')
  let i = 0
  let last = -1
  while (i < uo) {
    const k = buf.indexOf(needle, i)
    if (k < 0 || k >= uo) break
    last = k
    i = k + 1
  }
  log(`last function _( before uo: ${last}`)
  if (last >= 0) {
    log(asciiSlice(buf, last, last + 200))
    extractAt(last, 2000)
  }
}

log('\n=== last function g( before uo ===')
{
  const needle = Buffer.from('function g(')
  let i = 0
  const near = []
  while (i < uo) {
    const k = buf.indexOf(needle, i)
    if (k < 0 || k >= uo) break
    if (k > uo - 200000) near.push(k)
    i = k + 1
  }
  log(`function g( in last 200k before uo: ${near.length} last=${near.at(-1)}`)
  for (const k of near.slice(-6)) {
    log(`  @${k} ${asciiSlice(buf, k, k + 120).replace(/\s+/g, ' ')}`)
  }
}

log('\n=== last function J( before uo ===')
{
  const needle = Buffer.from('function J(')
  let i = 0
  const near = []
  while (i < uo) {
    const k = buf.indexOf(needle, i)
    if (k < 0 || k >= uo) break
    if (k > uo - 200000) near.push(k)
    i = k + 1
  }
  log(`function J( in last 200k before uo: ${near.length} last=${near.at(-1)}`)
  for (const k of near.slice(-6)) {
    log(`  @${k} ${asciiSlice(buf, k, k + 140).replace(/\s+/g, ' ')}`)
  }
}

log('\n=== #44 TG call sites ===')
for (const n of [
  'TG("/bug")',
  "TG('/bug')",
  'TG("/share")',
  'TG("/feedback")',
  'function gRt',
  'async function gRt',
  'function TG(',
  'TG()',
  'name:"bug"',
  'name: "bug"',
  '"bug"',
]) {
  dumpHits(n, 10, 90)
}

log('\n=== #34 other null-byte paths ===')
for (const n of [
  'includes("\\x00")',
  'includes("\\0")',
  'includes("\0")',
  'addDirectories',
  'function gbe(',
  'async function gbe(',
  'alreadyInWorkspace',
  'validateDirectoryForWorkspace',
]) {
  dumpHits(n, 8, 80)
}

log('\n=== #51 Ld kr ===')
for (const n of [
  'function Ld(',
  'function kr(',
  'Ld(r)?r',
  'kr(r)?r',
]) {
  dumpHits(n, 10, 80)
}

log('\n=== full extracts of known ===')
const known = [
  [184388254, 2000, 'dpe'],
  [187729104, 4000, '$Y'],
  [184311051, 400, 'rNt'],
  [199184593, 8000, 'ZW'],
  [183518215, 800, 'jJn'],
  [181264770, 800, 'awn'],
  [181264685, 200, 'Yp'],
  [179077773, 200, 'oc-bridge'],
  [187092580, 400, 'dKe'],
  [182107056, 4000, 'lr'],
  [186039090, 2000, 'mbe'],
  [186039858, 2000, 'gbe'],
  [178831583, 200, 'zk'],
]
for (const [i, max, name] of known) {
  log(`\n######## ${name} @${i}`)
  extractAt(i, max)
}

const out = join(__dir, '_peel-251-k-recon2.txt')
writeFileSync(out, lines.join('\n'), 'utf8')
console.error('wrote', out, 'lines', lines.length)
