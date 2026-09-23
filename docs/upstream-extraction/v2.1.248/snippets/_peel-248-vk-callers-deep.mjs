/**
 * Deep peel of the 5 real Vk(preExitFlush) callers.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  loadSea,
  asciiSlice,
  allHits,
  extractFnAt,
} from './_peel-248-na-helpers.mjs'

const out =
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-vk-callers-deep.txt'
const lines = ['# gold-248-vk-callers-deep', `# when=${new Date().toISOString()}`, '']
const b = loadSea(EXE_248)

function dumpNeedle(needle, cap = 6, around = 280) {
  const hits = allHits(b, needle)
  lines.push(`## ${JSON.stringify(needle)} hits=${hits.length}`)
  for (const p of hits.slice(0, cap)) {
    lines.push(`- @${p} ${asciiSlice(b, p - 60, p + around)}`)
  }
  lines.push('')
  return hits
}

function dumpAbs(tag, p, before = 200, after = 600) {
  lines.push(`## ${tag} @${p}`)
  lines.push(asciiSlice(b, p - before, p + after))
  lines.push('')
}

function dumpFn(tag, p, maxLen = 8000) {
  const ex = extractFnAt(b, p, maxLen)
  lines.push(`## fn ${tag} @${p}`)
  if (ex.body) {
    lines.push(`len=${ex.len} sha=${ex.sha}`)
    lines.push(ex.body)
  } else {
    lines.push('MISS ' + asciiSlice(b, p, p + 800))
  }
  lines.push('')
}

// --- 1. X$n plugin usage ---
dumpNeedle('function X$n(')
dumpNeedle('function CNe(')
dumpNeedle('function TNe(')
dumpNeedle('function EWt(')
dumpNeedle('function vWt(')
dumpNeedle('pluginUsage')
dumpNeedle('_Ne({flush:')
dumpNeedle('flushAtExit')

{
  const hits = allHits(b, 'function X$n(')
  for (const p of hits) dumpFn('X$n', p)
  for (const p of allHits(b, 'async function CNe(')) dumpFn('CNe', p)
  for (const p of allHits(b, 'function EWt(')) dumpFn('EWt', p)
  for (const p of allHits(b, 'function vWt(')) dumpFn('vWt', p)
}

// --- 2. lastSessionMetrics wt ---
dumpNeedle('lastSessionMetrics')
dumpNeedle('function wt($a)')
dumpNeedle('GTt()')

// --- 3. durable pendingOps be/wr ---
dumpNeedle('function be(e){let{pendingOps')
dumpNeedle('async function wr()')
dumpNeedle('durable.pendingOps')
dumpNeedle('me().durable')
{
  const hits = allHits(b, 'async function wr(){await un(Promise.allSettled')
  for (const p of hits) dumpFn('wr', p)
  const be = allHits(b, 'function be(e){let{pendingOps')
  for (const p of be) dumpFn('be', p)
  // larger durable module window
  if (be[0]) dumpAbs('durable-window', be[0], 1500, 1200)
}

// --- 4. editor draft qd ---
dumpNeedle('draftForDisk')
dumpNeedle('function qd(')
dumpNeedle('canonicalLauncherCwd')
dumpNeedle('AIt(ro,{q:')

// --- 5. flushBeforeExit writer ---
dumpNeedle('flushBeforeExit')
dumpNeedle('pendingWrites.settle')
{
  const p = 192334884
  dumpAbs('flushBeforeExit-2k', p, 2500, 900)
  const winStart = p - 5000
  const win = asciiSlice(b, winStart, p)
  let idx = win.lastIndexOf('class ')
  lines.push(`## class hunt before flushBeforeExit idx=${idx}`)
  while (idx >= 0) {
    const abs = winStart + idx
    lines.push(`- class @${abs} ${asciiSlice(b, abs, abs + 120)}`)
    idx = win.lastIndexOf('class ', idx - 1)
    if (lines.length > 200) break
  }
  lines.push('')
  // find getWriter / writers.set near
  dumpNeedle('this.writers.set(e,r)')
  dumpNeedle('this.flushBeforeExit')
}

// --- 6. Aye ZFn graceful ---
dumpNeedle('function Aye(')
dumpNeedle('async function ZFn(')
dumpNeedle('function eUn(')
dumpNeedle('lastGracefulShutdown')
dumpNeedle('function Jhe(')
{
  for (const p of allHits(b, 'function Aye(')) dumpFn('Aye', p)
  for (const p of allHits(b, 'async function ZFn(')) dumpFn('ZFn', p, 4000)
  for (const p of allHits(b, 'function eUn(')) dumpFn('eUn', p, 2000)
}

writeFileSync(out, lines.join('\n'))
console.log('wrote', out)
