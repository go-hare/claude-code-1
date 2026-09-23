/**
 * Peel Ior / Sgn / Ae() call sites from official 2.1.248 SEA.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStart,
  lastFnStartGeneric,
  loadSea,
  sha,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const buf = loadSea(EXE_248)
const lines = [
  '# gold-248-na-10-ior-scan',
  `exe=${EXE_248}`,
  `bytes=${buf.length}`,
  '',
]

function dumpHits(label, needle, around = 160, cap = 16) {
  const hits = allHits(buf, needle)
  lines.push(
    `## ${label} needle=${JSON.stringify(needle)} hits=${hits.length}`,
  )
  for (const [idx, i] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${idx} @${i} ${asciiSlice(buf, i - around, i + needle.length + around)}`,
    )
  }
  if (hits.length > cap) lines.push(`- … +${hits.length - cap} more`)
  lines.push('')
  return hits
}

function dumpFn(label, i, maxLen = 8000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
  return ext
}

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

// Unique Ae body start (desktop cutoff)
const aeNeedle = 'function Ae(){let e=tx("desktopSessionCleanupPeriodDays")'
const aeHits = dumpHits('#10 Ae-fn', aeNeedle, 80, 4)
const ae = aeHits[0] ?? -1

// Ae() call sites — search nearby JS region first, then whole binary
dumpHits('#10 Ae()', 'Ae()', 80, 30)
dumpHits('#10 await Ae', 'await Ae(', 80, 10)
dumpHits('#10 let Ae', 'let n=Ae()', 80, 10)
dumpHits('#10 var Ae', 'Ae()??', 80, 10)
dumpHits('#10 ||Ae()', '||Ae()', 80, 10)
dumpHits('#10 &&Ae()', '&&Ae()', 80, 10)
dumpHits('#10 =Ae()', '=Ae()', 80, 10)

// Ior / Sgn as function decls
dumpHits('#10 function Ior', 'function Ior', 80, 20)
dumpHits('#10 function Sgn', 'function Sgn', 80, 20)
dumpHits('#10 async function Ior', 'async function Ior', 80, 10)
dumpHits('#10 async function Sgn', 'async function Sgn', 80, 10)
dumpHits('#10 Ior(', 'Ior(', 80, 30)
dumpHits('#10 Sgn(', 'Sgn(', 80, 30)
dumpHits('#10 await Ior', 'await Ior(', 80, 10)
dumpHits('#10 await Sgn', 'await Sgn(', 80, 10)

// release / entrypoint / desktop markers
dumpHits('#10 desktop-released', 'desktop-released', 180, 20)
dumpHits('#10 .desktop-released.json', '.desktop-released.json', 180, 20)
dumpHits('#10 desktopReleased', 'desktopReleased', 120, 10)
dumpHits('#10 release marker', 'release marker', 120, 10)
dumpHits('#10 release-now', 'release-now', 160, 10)
dumpHits('#10 written by a desktop', 'written by a desktop', 160, 8)
dumpHits('#10 last written by', 'last written by', 160, 8)
dumpHits('#10 desktop-host', 'desktop-host', 160, 10)
dumpHits('#10 desktop-host surface', 'desktop-host surface', 120, 4)
dumpHits('#10 entrypoint', '"entrypoint"', 120, 20)
dumpHits('#10 entrypoint:', 'entrypoint:', 120, 20)
dumpHits('#10 Cowork', 'Cowork', 80, 16)
dumpHits('#10 CLAUDE_DESKTOP', 'CLAUDE_DESKTOP', 80, 10)
dumpHits('#10 claude-desktop', 'claude-desktop', 80, 10)

// Fe session-id regex sits immediately before Ae
dumpHits('#10 Fe-sessionid', 'function Fe(e){return/^[0-9A-Za-z_-]{1,64}$/.test(e)}', 40, 4)

// fe() hipaa/zdr gate after xe
dumpHits('#10 fe-hipaa', 'function fe(){return xe()||Fh("hipaa")||Fh("zdr")}', 40, 4)

// V_() is likely regular cutoff; pair with Ae
dumpHits('#10 V_()', 'function V_(){', 40, 8)
dumpHits('#10 V_() call near Ae region', 'V_()', 40, 20)

// Ior true/false usage around cleanup
dumpHits('#10 if(Ior', 'if(Ior(', 80, 16)
dumpHits('#10 if(Sgn', 'if(Sgn(', 80, 16)
dumpHits('#10 Ior&&', 'Ior&&', 80, 10)
dumpHits('#10 !Ior', '!Ior(', 80, 10)

// Extract named fns if unique
for (const name of ['Ior', 'Sgn', 'Fe', 'Ae', 'xe', 'fe', 'V_', 'Me']) {
  const hits = allHits(buf, `function ${name}(`)
  const asyncHits = allHits(buf, `async function ${name}(`)
  lines.push(
    `## decl ${name} sync=${hits.length} async=${asyncHits.length} @sync=${hits.slice(0, 8).join(',')} @async=${asyncHits.slice(0, 8).join(',')}`,
  )
  lines.push('')
}

// Extract Ior/Sgn if we find unique-ish decls
for (const name of ['Ior', 'Sgn']) {
  const syncHits = allHits(buf, `function ${name}(`)
  const asyncHits = allHits(buf, `async function ${name}(`)
  const all = [
    ...syncHits.map((i) => ({ i, async: false })),
    ...asyncHits.map((i) => ({ i, async: true })),
  ]
  for (const [idx, h] of all.slice(0, 6).entries()) {
    dumpFn(`#10 ${name}-decl-${idx}${h.async ? '-async' : ''}`, h.i, 12000)
    dumpAround(`#10 ${name}-win-${idx}`, h.i, 200, 400)
  }
}

// Large window around Ae — the cleanup module
if (ae >= 0) {
  dumpAround('#10 Ae-before-4k', ae, 4000, 200)
  dumpAround('#10 Ae-after-8k', ae, 100, 8000)
  dumpAround('#10 Ae-after-16k', ae, 50, 16000)
}

// Search JS-looking Ior near Ae (±200k)
if (ae >= 0) {
  const lo = Math.max(0, ae - 200000)
  const hi = Math.min(buf.length, ae + 200000)
  const region = asciiSlice(buf, lo, hi)
  for (const needle of [
    'function Ior',
    'async function Ior',
    'function Sgn',
    'async function Sgn',
    'Ior(',
    'Sgn(',
    'Ae()',
    'desktop-released',
    'entrypoint',
  ]) {
    let from = 0
    let n = 0
    const rels = []
    while (n < 20) {
      const k = region.indexOf(needle, from)
      if (k < 0) break
      rels.push(lo + k)
      from = k + needle.length
      n++
    }
    lines.push(
      `## region±200k ${JSON.stringify(needle)} hits=${rels.length} @=${rels.join(',')}`,
    )
    for (const i of rels.slice(0, 8)) {
      lines.push(`- @${i} ${asciiSlice(buf, i - 80, i + needle.length + 120)}`)
    }
    lines.push('')
  }
}

writeFileSync(`${outDir}/gold-248-na-10-ior-scan.txt`, lines.join('\n'))
console.log(
  'WROTE',
  `${outDir}/gold-248-na-10-ior-scan.txt`,
  'chars',
  lines.join('\n').length,
)
