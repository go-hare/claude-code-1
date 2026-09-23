/**
 * Peel official 248 _G callees E (execve replace) and C (spawnSync inherit).
 * Prior gold-248-g-full peel grabbed wrong C (quota event emitter).
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  loadSea,
  asciiSlice,
  extractFnAt,
  lastFnStart,
  lastFnStartGeneric,
  allHits,
  sha,
} from './_peel-248-na-helpers.mjs'

const b = loadSea(EXE_248)
const out = [`when=${new Date().toISOString()}`, '## goal peel E/C for _G']

function dumpHits(label, needle, max = 8) {
  const hits = allHits(b, needle)
  out.push(`\n## ${label} needle=${JSON.stringify(needle)} hits=${hits.length}`)
  for (const h of hits.slice(0, max)) {
    out.push(`- @${h} ${asciiSlice(b, h - 100, h + 220).replace(/\n/g, ' ')}`)
  }
  return hits
}

function dumpFnAt(label, i, maxLen = 8000) {
  out.push(`\n## ${label} @${i}`)
  const ext = extractFnAt(b, i, maxLen)
  if (ext.body) {
    out.push(`len=${ext.len} sha=${ext.sha}`)
    out.push(ext.body)
  } else {
    out.push(JSON.stringify(ext).slice(0, 500))
    out.push(asciiSlice(b, i, i + 2000))
  }
  return ext
}

// _G call sites
const eCall = 'E(o,[o,...r,...i],s,m)'
const cCall = 'let c=C(o,[...r,...i],{stdio:"inherit"'
dumpHits('E-call', eCall)
dumpHits('C-call', cCall)

// Known E from prior peel
dumpFnAt('E-known', 189573358, 4000)

// Walk back from C call for function C(
const cHits = allHits(b, cCall)
for (const h of cHits.slice(0, 2)) {
  out.push(`\n## C-callsite walkback from @${h}`)
  // show more context of _G
  out.push(asciiSlice(b, h - 800, h + 400))

  // Find last function C( before this call — but many C exist.
  // Prefer ones that mention spawnSync / windowsHide / Absolute
  const start = Math.max(0, h - 200000)
  const win = asciiSlice(b, start, h)
  const re = /function C\(/g
  let m
  const candidates = []
  while ((m = re.exec(win))) {
    candidates.push(start + m.index)
  }
  out.push(`function C( candidates in 200k lookback: ${candidates.length}`)
  // Check last 15 candidates for spawnSync body
  for (const i of candidates.slice(-15)) {
    const ext = extractFnAt(b, i, 6000)
    const body = ext.body || ''
    const score =
      (body.includes('spawnSync') ? 10 : 0) +
      (body.includes('windowsHide') ? 5 : 0) +
      (body.includes('stdio') ? 3 : 0) +
      (body.includes('Xet') ? 2 : 0) +
      (body.includes('inherit') ? 2 : 0)
    out.push(
      `- cand @${i} score=${score} len=${ext.len || 0} sha=${ext.sha || '?'} preview=${(body || asciiSlice(b, i, i + 120)).slice(0, 160).replace(/\n/g, ' ')}`,
    )
    if (score >= 10) {
      dumpFnAt('C-spawnSync-match', i, 8000)
    }
  }
}

// Also search spawnSync wrappers near execve
dumpHits('process.execve', 'process.execve(')
dumpHits('execReplaceProcess', 'execReplaceProcess')
dumpHits('falling back to spawn', 'falling back to spawn')
dumpHits('spawnSync windowsHide', 'windowsHide:!0')
dumpHits('function with Xet', 'function Xet(')
dumpHits('Xet(', 'Xet(')

// Absolute path check A( used by E
dumpHits('A(e) near E', '!A(e)')
const eBodyHits = allHits(b, 'if(B()==="windows"||!A(e))return')
for (const h of eBodyHits.slice(0, 3)) {
  const start = lastFnStart(b, h, ['function E(', 'function A('])
  out.push(`\n## near windows||!A @${h} lastFn=${start.name}@${start.i}`)
  if (start.i > 0) dumpFnAt('near-A-or-E', start.i, 4000)
}

// Find A( absolute path helper used by E — look just before E
out.push('\n## window before E @189573358')
out.push(asciiSlice(b, 189572800, 189573400))

// Find function A that checks Absolute — commonly path.isAbsolute
const aHits = allHits(b, 'function A(e){return')
out.push(`\n## function A(e){return hits=${aHits.length}`)
for (const h of aHits.slice(0, 20)) {
  const ext = extractFnAt(b, h, 500)
  const body = ext.body || ''
  if (
    body.includes('Absolute') ||
    body.includes('isAbsolute') ||
    body.includes('/') ||
    body.length < 120
  ) {
    out.push(`- @${h} ${body.slice(0, 200)}`)
  }
}

// Find Xet env transform
const xetHits = allHits(b, 'function Xet(')
out.push(`\n## function Xet( hits=${xetHits.length}`)
for (const h of xetHits.slice(0, 5)) {
  dumpFnAt('Xet', h, 3000)
}

// bu = chdir?
dumpHits('bu(r) near E', 'bu(r)')
const buHits = allHits(b, 'function bu(')
out.push(`\n## function bu( hits=${buHits.length}`)
for (const h of buHits.slice(0, 5)) {
  const ext = extractFnAt(b, h, 400)
  out.push(`- @${h} ${(ext.body || '').slice(0, 200)}`)
}

// B() platform
dumpHits('function B()', 'function B(){')
const bHits = allHits(b, 'function B(){return')
for (const h of bHits.slice(0, 10)) {
  const ext = extractFnAt(b, h, 300)
  const body = ext.body || ''
  if (body.includes('win') || body.includes('darwin') || body.includes('linux')) {
    out.push(`- B @${h} ${body}`)
  }
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-E-C.txt',
  out.join('\n'),
)
console.log('wrote gold-248-E-C.txt lines', out.length)
