/**
 * 248 #20 — extract official unpushed gate NEXT TO deleteJob / worktree remove.
 * Not generic --merged / is-ancestor tables.
 */
import { existsSync, writeFileSync } from 'fs'
import {
  EXE_247,
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
  sha,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const b248 = loadSea(EXE_248)
const b247 = existsSync(EXE_247) ? loadSea(EXE_247) : null

const lines = [
  '# gold-248-20-unpushed',
  `when=${new Date().toISOString()}`,
  `bytes248=${b248.length} bytes247=${b247 ? b247.length : 'ABSENT'}`,
  'rule=gate next to unpushed phrase / deleteJob logs. generic git tables ignored.',
  '',
]

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(b248, i - before, i + after))
  lines.push('')
}

function dumpFn(label, buf, i, maxLen = 12000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
  return ext
}

function dumpHits(label, needle, around = 140, cap = 12) {
  const hits = allHits(b248, needle)
  const n247 = b247 ? allHits(b247, needle).length : 'n/a'
  lines.push(
    `## ${label} needle=${JSON.stringify(needle)} hits248=${hits.length} hits247=${n247}`,
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

function coveringFn(buf, at, maxLookback = 8000) {
  const { i, name } = lastFnStartGeneric(buf, at, maxLookback)
  return { i, name, ext: i < 0 ? { miss: true } : extractFnAt(buf, i, 16000) }
}

// --- phrase + deleteJob logs ---
dumpHits('#20 phrase', 'has commits that are not pushed anywhere')
dumpHits('#20 on no remote', 'has commits that are on no remote')
dumpHits('#20 deleteJob: prefix', 'deleteJob:')
dumpHits('#20 unpushed kept log', 'has commits that are on no remote, kept')
dumpHits('#20 keptReason unpushed', '="unpushed"')
dumpHits('#20 :"unpushed"', ':"unpushed"')
dumpHits('#20 ,unpushed,', ',unpushed,')

// --- git args near remotes / ancestor / merged ---
for (const n of [
  'rev-list',
  '--not","--remotes',
  '"--not","--remotes"',
  '--all","--not',
  '"--all","--not"',
  'HEAD","--not","--remotes',
  '"HEAD","--not","--remotes"',
  '--max-count=1","HEAD","--not',
  'merge-base","--is-ancestor',
  '"--is-ancestor"',
  'is-ancestor',
  '--merged","HEAD',
  '"--merged","HEAD"',
  '--merged',
  'refs/heads/main',
  'refs/heads/master',
  'symbolic-ref","--short","HEAD',
  '"symbolic-ref","--short"',
  'origin/HEAD',
  'checked-out',
  'default branch',
  'merged into',
]) {
  dumpHits(`#20 needle ${n}`, n, 80, 6)
}

// --- extract every deleteJob: covering fn ---
const delHits = allHits(b248, 'deleteJob:')
lines.push(`## covering-fns for deleteJob: hits=${delHits.length}`)
const seenFn = new Set()
for (const i of delHits) {
  const { i: fi, name, ext } = coveringFn(b248, i, 12000)
  const key = `${fi}:${ext.sha || ext.miss}`
  if (seenFn.has(key)) continue
  seenFn.add(key)
  lines.push(`- log@${i} fn=${name} @${fi} sha=${ext.sha || 'MISS'} len=${ext.len || 0}`)
  if (ext.body) {
    const unpushedish = [
      'unpushed',
      'rev-list',
      '--remotes',
      'is-ancestor',
      '--merged',
      'refs/heads/main',
      'refs/heads/master',
      'symbolic-ref',
    ].filter((k) => ext.body.includes(k))
    lines.push(`  keys=${unpushedish.join(',') || 'NONE'}`)
  }
}
lines.push('')

for (const i of delHits) {
  dumpAround(`#20-deleteJob-log`, i, 80, 220)
}

// Prefer the log that mentions unpushed / no remote
for (const i of delHits) {
  const win = asciiSlice(b248, i, i + 220)
  if (win.includes('unpushed') || win.includes('no remote') || win.includes('not pushed')) {
    const { i: fi, name } = coveringFn(b248, i, 16000)
    dumpFn(`#20-deleteJob-unpushed-fn ${name}`, b248, fi, 16000)
  }
}

// phrase map covering (expect wrong if attach) + nearby helpers AFTER the map
const phrase = b248.indexOf(
  Buffer.from('unpushed:"has commits that are not pushed anywhere"'),
)
dumpAround('#20-phrase-map', phrase, 80, 400)

// walk FORWARD from phrase for function defs that mention rev-list / unpushed
{
  const start = phrase > 0 ? phrase : 0
  const win = asciiSlice(b248, start, start + 80000)
  lines.push('## #20 forward-from-phrase function names (80k)')
  const re = /(?:async )?function ([A-Za-z_$][\w$]*)\(/g
  let m
  const names = []
  while ((m = re.exec(win))) names.push({ rel: m.index, name: m[1], abs: start + m.index })
  for (const n of names.slice(0, 40)) {
    const preview = asciiSlice(b248, n.abs, n.abs + 180)
    lines.push(`- ${n.name} @${n.abs} ${preview.replace(/\s+/g, ' ').slice(0, 160)}`)
  }
  lines.push(`count=${names.length}`)
  lines.push('')
}

// walk BACKWARD looking for ze / C2e-like delete body
{
  const { i, name } = lastFnStartGeneric(b248, phrase, 20000)
  dumpFn(`#20-phrase-covering ${name}`, b248, i, 16000)
}

// Find JS-looking rev-list --not --remotes (not flag tables)
const revNeedles = [
  '["rev-list","--all","--not","--remotes"',
  "['rev-list','--all','--not','--remotes'",
  '["rev-list","--max-count=1","HEAD","--not","--remotes"',
  '["rev-list","--max-count=1","--all","--not","--remotes"',
  '"rev-list","--all","--not","--remotes","--max-count=1"',
  '"rev-list","--max-count=1","HEAD","--not","--remotes"',
  '...go,"rev-list","--all","--not","--remotes"',
  '...go,"rev-list","--max-count=1","HEAD","--not","--remotes"',
  '"rev-list","--max-count=1","HEAD","--not"',
  '"rev-list","--all","--not"',
]
for (const n of revNeedles) {
  dumpHits(`#20 revExact ${n}`, n, 200, 8)
}

// Broader: every JS-looking "rev-list" in 185M-195M / 215M-225M bands (delete/worktree)
function jsHitsInBand(needle, lo, hi, cap = 30) {
  const n = Buffer.from(needle)
  const hits = []
  let i = lo
  while (i < hi) {
    const k = b248.indexOf(n, i)
    if (k < 0 || k >= hi) break
    const win = asciiSlice(b248, k - 60, k + 180)
    if (
      win.includes('function ') ||
      win.includes('jn(') ||
      win.includes('await ') ||
      win.includes('["') ||
      win.includes("['")
    ) {
      hits.push(k)
    }
    i = k + n.length
  }
  lines.push(
    `## #20 js-rev-list band ${lo}-${hi} needle=${JSON.stringify(needle)} jsHits=${hits.length}`,
  )
  for (const [idx, k] of hits.slice(0, cap).entries()) {
    lines.push(`- #${idx} @${k} ${asciiSlice(b248, k - 80, k + 200)}`)
  }
  if (hits.length > cap) lines.push(`- … +${hits.length - cap} more`)
  lines.push('')
  return hits
}

const revJs = [
  ...jsHitsInBand('rev-list', 184000000, 190000000, 40),
  ...jsHitsInBand('rev-list', 214000000, 222000000, 40),
  ...jsHitsInBand('rev-list', 186000000, 187000000, 20),
]

// For each JS rev-list, note if covering fn also has unpushed / deleteJob / is-ancestor / --merged / refs/heads
lines.push('## #20 rev-list covering classification')
const classSeen = new Set()
for (const k of revJs) {
  const { i, name, ext } = coveringFn(b248, k, 8000)
  const key = `${i}:${name}`
  if (classSeen.has(key)) continue
  classSeen.add(key)
  const body = ext.body || ''
  const flags = {
    unpushed: body.includes('unpushed'),
    deleteJob: body.includes('deleteJob'),
    remotes: body.includes('--remotes'),
    ancestor: body.includes('is-ancestor'),
    merged: body.includes('--merged'),
    headsMain: body.includes('refs/heads/main'),
    headsMaster: body.includes('refs/heads/master'),
    symbolic: body.includes('symbolic-ref'),
    dirty: body.includes('uncommitted'),
  }
  lines.push(
    `- rev@${k} fn=${name} @${i} sha=${ext.sha || 'MISS'} len=${ext.len || 0} flags=${JSON.stringify(flags)}`,
  )
  if (flags.unpushed || flags.deleteJob || (flags.remotes && flags.ancestor)) {
    if (ext.body) {
      lines.push('BODY_START')
      lines.push(ext.body)
      lines.push('BODY_END')
    }
  }
}
lines.push('')

// Compare 247 vs 248 around "on no remote" / UMs-like / ze
if (b247) {
  const needles247 = [
    'has commits that are on no remote',
    'has commits that are not pushed anywhere',
    'deleteJob:',
    '"--all","--not","--remotes"',
    '"HEAD","--not","--remotes"',
  ]
  lines.push('## #20 247-vs-248 hit counts')
  for (const n of needles247) {
    lines.push(
      `- ${JSON.stringify(n)} 247=${allHits(b247, n).length} 248=${allHits(b248, n).length}`,
    )
  }
  lines.push('')

  // extract 247 covering of on-no-remote if present
  const p247 = b247.indexOf(Buffer.from('has commits that are on no remote'))
  if (p247 >= 0) {
    const { i, name } = lastFnStartGeneric(b247, p247, 16000)
    dumpFn(`#20-247-on-no-remote-fn ${name}`, b247, i, 16000)
  }
  const d247 = b247.indexOf(Buffer.from('deleteJob:'))
  lines.push(`## #20-247 first deleteJob: @${d247}`)
  if (d247 >= 0) lines.push(asciiSlice(b247, d247, d247 + 200))
  lines.push('')
}

writeFileSync(`${outDir}/gold-248-20-unpushed.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-20-unpushed.txt`, 'lines', lines.length)
