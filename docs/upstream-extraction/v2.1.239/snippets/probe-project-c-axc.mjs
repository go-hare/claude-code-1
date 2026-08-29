/**
 * densable 2.1.239 SEA — Project C (236 #9) Axc compositor peel.
 * SEA: %TEMP%\official-239-pkg\package\claude.exe
 *
 * Writes:
 *   gold-project-c-axc-probe.txt  — needle hits
 *   gold-project-c-axc-methods.txt — full method bodies (latin1, ASCII-scrubbed)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const exe = `${process.env.TEMP}\\official-239-pkg\\package\\claude.exe`
const buf = readFileSync(exe)

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '.')
}

function hits(needle, max = 12) {
  const n = Buffer.from(needle)
  const out = []
  let i = 0
  while (out.length < max) {
    const j = buf.indexOf(n, i)
    if (j < 0) break
    out.push(j)
    i = j + 1
  }
  return out
}

function around(i, b, a) {
  return ascii(
    buf.subarray(Math.max(0, i - b), Math.min(buf.length, i + a)).toString('latin1'),
  )
}

/** Extract from method start until next sibling method or class end heuristics. */
function extractMethod(startNeedle, endNeedles, maxLen = 8000) {
  const hs = hits(startNeedle, 3)
  if (hs.length === 0) return { offset: -1, body: '(not found)' }
  const start = hs[0]
  const region = buf.subarray(start, Math.min(buf.length, start + maxLen)).toString('latin1')
  let end = region.length
  for (const en of endNeedles) {
    // skip the opening needle itself
    const idx = region.indexOf(en, startNeedle.length)
    if (idx > 0 && idx < end) end = idx
  }
  return { offset: start, body: ascii(region.slice(0, end)) }
}

const methodSpecs = [
  {
    name: 'handleResize',
    start: 'handleResize(e,t){',
    ends: ['tickPump(){', 'consumeBackfillNeeded(){'],
  },
  {
    name: 'tickPump',
    start: 'tickPump(){',
    ends: ['consumeBackfillNeeded(){', 'consumeGapRange(){'],
  },
  {
    name: 'syncViewport',
    start: 'syncViewport(e,t){',
    ends: ['draw(e){', 'computeLayout('],
  },
  {
    name: 'draw',
    start: 'draw(e){',
    ends: ['computeLayout(', 'handleResize(e,t){', '_transient(){'],
  },
  {
    name: 'resume',
    start: 'resume(e,t){',
    ends: ['restore(){', 'syncViewport(e,t){'],
  },
  {
    name: 'suspend',
    start: 'suspend(){',
    ends: ['resume(e,t){', 'restore(){'],
  },
  {
    name: 'restore',
    start: 'restore(){',
    ends: ['syncViewport(e,t){', 'draw(e){'],
  },
  {
    name: 'resetTransientState',
    start: 'resetTransientState(){',
    ends: ['clearLine(', 'writeOverlayLines(', 'commitImmediate(){', '_transient(){'],
  },
  {
    name: 'primeBackfill',
    start: 'primeBackfill(e){',
    ends: ['switchTranscript(){', 'restoreUnderContentOverlay(){'],
  },
  {
    name: 'switchTranscript',
    start: 'switchTranscript(){',
    ends: ['restoreUnderContentOverlay(){', 'resetTransientState(){'],
  },
  {
    name: 'consumeBackfillNeeded',
    start: 'consumeBackfillNeeded(){',
    ends: ['consumeGapRange(){', 'primeBackfill(e){'],
  },
  {
    name: 'consumeGapRange',
    start: 'consumeGapRange(){',
    ends: ['primeBackfill(e){', 'switchTranscript(){'],
  },
  {
    name: 'computeLayout',
    start: 'computeLayout(e,t){',
    ends: ['handleResize(e,t){', 'tickPump(){'],
  },
  {
    name: 'setup',
    start: 'setup(){',
    ends: ['suspend(){', 'resume(e,t){'],
  },
]

let methodsOut = '# densable 2.1.239 — Axc method bodies (Project C)\n'
methodsOut += `# SEA: ${exe}\n`
methodsOut += `# extracted: ${new Date().toISOString()}\n\n`

for (const spec of methodSpecs) {
  const { offset, body } = extractMethod(spec.start, spec.ends)
  methodsOut += `\n#### ${spec.name} @ ${offset}\n`
  methodsOut += '```js\n' + body + '\n```\n'
}

// Constants cluster near tickPump / class tail
const constHits = hits('q$0=100,uyn=1e4,dyn=4', 2)
methodsOut += `\n#### CONSTANTS_CLUSTER count=${constHits.length}\n`
for (const h of constHits) {
  methodsOut += `--- ${h} ---\n${around(h, 80, 200)}\n`
}

// frameSink "tick" arm (Qvt/xxc caller)
const tickArms = [
  '?"tick":!0',
  'return"tick"',
  ',"tick"',
  'frameSink=',
  'tickPump()',
]
methodsOut += '\n#### frameSink / tick arms\n'
for (const n of tickArms) {
  const hs = hits(n, 4)
  methodsOut += `\n#### "${n}" count=${hs.length}\n`
  for (const h of hs.slice(0, 2)) {
    methodsOut += `--- ${h} ---\n${around(h, 200, 900)}\n`
  }
}

// Class constructor / field init near nativeHistory
const ctorHits = hits('nativeHistory=[];pumpCursor=-1', 2)
if (ctorHits.length === 0) {
  // try variants
  for (const alt of [
    'this.nativeHistory=[]',
    'nativeHistory=[],pumpCursor',
    'pumpCursor=-1,replayPending',
    'this.pumpCursor=-1',
  ]) {
    const hs = hits(alt, 2)
    methodsOut += `\n#### ctor-alt "${alt}" count=${hs.length}\n`
    for (const h of hs.slice(0, 1)) {
      methodsOut += `--- ${h} ---\n${around(h, 400, 1200)}\n`
    }
  }
} else {
  methodsOut += `\n#### ctor nativeHistory init\n`
  for (const h of ctorHits) {
    methodsOut += `--- ${h} ---\n${around(h, 500, 1500)}\n`
  }
}

// Confirm l5w absent; Ran vs dyn
methodsOut += `\n#### rename notes\n`
methodsOut += `l5w hits: ${hits('l5w=', 3).length} (236 batch name; 239 uses q$0)\n`
methodsOut += `Ran= hits (noise-prone): ${hits('Ran=', 3).length}\n`
methodsOut += `dyn=4 in cluster: ${constHits.length > 0}\n`
methodsOut += `contentHeight uses dyn: ${hits('t-dyn', 3).length} / Math.max(2,t-dyn)\n`

writeFileSync(join(here, 'gold-project-c-axc-methods.txt'), methodsOut)

// Keep original needle dump too
const needles = [
  'tickPump(){',
  'nativeHistory',
  'replayPending=!0',
  'pumpCursor',
  'syncViewport(e,t)',
  'frameSink',
  'q$0=',
  'l5w=',
  'uyn=',
  'dyn=',
  'Ran=',
  'handleResize(e,t){',
  'resetTransientState',
  'consumeBackfillNeeded',
  '?"tick":!0',
]
let out = '# densable 2.1.239 — Project C Axc probe\n'
for (const n of needles) {
  const hs = hits(n, 6)
  out += `\n#### "${n}" count=${hs.length}\n`
  for (const h of hs.slice(0, 2)) {
    out += `--- ${h} ---\n${around(h, 120, 1400)}\n`
  }
}
writeFileSync(join(here, 'gold-project-c-axc-probe.txt'), out)

console.log(
  'ok methods=' +
    methodSpecs.map(s => s.name).join(',') +
    ' | const=' +
    (constHits[0] ?? 'missing') +
    ' | ' +
    needles.map(n => `${n}:${hits(n, 3).length}`).join(' | '),
)
