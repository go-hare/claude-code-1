/**
 * Peel #18 pass2: extract up/ag/Lc/dropDraft + setQuery("") callers.
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
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const buf = loadSea(EXE_248)
const lines = [`when=${new Date().toISOString()}`]

function log(s) {
  lines.push(s)
  console.log(s)
}

function dumpWin(label, off, before = 300, after = 700) {
  log('')
  log(`## ${label} @${off}`)
  log(asciiSlice(buf, off - before, off + after))
}

function hitsIn(needle, lo, hi) {
  return allHits(buf, needle).filter((h) => h >= lo && h < hi)
}

const FLEET_LO = 191900000
const FLEET_HI = 192400000

for (const n of [
  'function up(',
  'async function up(',
  'up=(',
  'function ag(',
  'ag=(',
  'function $L(',
  '$L(',
  'dropDraft(',
  'function dropDraft',
  'dropDraft()',
  'mf(Ke.origin)',
  'up(ra',
]) {
  const hits = hitsIn(n, FLEET_LO, FLEET_HI)
  log('')
  log(`## fleet ${JSON.stringify(n)} count=${hits.length} ${hits.slice(0, 12).join(',')}`)
  for (const h of hits.slice(0, 6)) {
    log(`-- @${h} ${asciiSlice(buf, h - 60, h + n.length + 200)}`)
  }
}

// extract function up near Du wrapper
for (const h of hitsIn('function up(', FLEET_LO, FLEET_HI)) {
  const ext = extractFnAt(buf, h, 20000)
  log('')
  log(`## function up @${h} sha=${ext.sha} len=${ext.len} missEnd=${ext.missEnd}`)
  if (ext.body) log(ext.body)
  else dumpWin('up-preview', h, 0, 800)
}

// also lastFnStart before Du=
{
  const found = lastFnStart(buf, 192279362, [
    'function up(',
    'async function up(',
    'function $L(',
  ])
  log('')
  log(`## lastFn before Du= found=${found.name}@${found.i}`)
  if (found.i >= 0) {
    const ext = extractFnAt(buf, found.i, 20000)
    log(`sha=${ext.sha} len=${ext.len}`)
    if (ext.body) log(ext.body)
  }
}

// extract Lc fully
{
  const ext = extractFnAt(buf, 192158881, 30000)
  log('')
  log(`## Lc full sha=${ext.sha} len=${ext.len}`)
  if (ext.body) log(ext.body)
}

// extract ag (JIy)
for (const h of hitsIn('function ag(', FLEET_LO, FLEET_HI)) {
  const ext = extractFnAt(buf, h, 40000)
  log('')
  log(`## function ag @${h} sha=${ext.sha} len=${ext.len} missEnd=${ext.missEnd}`)
  if (ext.body) {
    const keys = [
      'newsession',
      'openNewSession',
      'ye(',
      'lt(',
      'Du(',
      'setQuery',
      'dropDraft',
      'willInsertNewline',
    ]
    log(`keys=${keys.filter((k) => ext.body.includes(k)).join(',')}`)
    log(ext.body)
  }
}

// setQuery("") windows
for (const h of allHits(buf, 'setQuery("")')) {
  if (h < FLEET_LO || h >= FLEET_HI) continue
  dumpWin(`setQuery("")`, h, 500, 400)
}

// dropDraft
for (const h of allHits(buf, 'dropDraft()')) {
  dumpWin('dropDraft()', h, 200, 300)
}

// beginNewSession spawn body — extract enclosing function
{
  const found = lastFnStart(buf, 192190295, [
    'function up(',
    'async function up(',
    'function $L(',
    'function ',
  ])
  log('')
  log(`## spawn-enclosing found=${found.name}@${found.i}`)
  if (found.i >= 0) {
    const ext = extractFnAt(buf, found.i, 25000)
    log(`sha=${ext.sha} len=${ext.len} missEnd=${ext.missEnd}`)
    if (ext.body) log(ext.body)
    else dumpWin('spawn-preview', found.i, 0, 2000)
  }
}

dumpWin('beginNewSession-call', 192190250, 80, 2500)
dumpWin('click mf(Ke.origin)', 192210213, 80, 400)

writeFileSync(`${outDir}/gold-248-18-up-lc.txt`, lines.join('\n'))
console.log('wrote', lines.length)
