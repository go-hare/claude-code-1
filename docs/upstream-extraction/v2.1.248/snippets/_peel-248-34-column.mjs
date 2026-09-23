/**
 * #34 startup warning column — extract Uf/Gp/StatusNotices padding vs 247.
 * Gold only. Do not invent paddingLeft.
 */
import { existsSync, writeFileSync } from 'fs'
import {
  EXE_247,
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
const b248 = loadSea(EXE_248)
const b247 = existsSync(EXE_247) ? loadSea(EXE_247) : null

const lines = [
  '# gold-248-34-column',
  `bytes248=${b248.length} bytes247=${b247 ? b247.length : 'ABSENT'}`,
  `exe247=${existsSync(EXE_247) ? 'YES' : 'NO'}`,
  '',
]

function dumpAround(buf, label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function dumpFn(buf, label, i, maxLen = 8000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
  return ext
}

function dumpHits(buf, label, needle, around = 120, cap = 12) {
  const hits = allHits(buf, needle)
  lines.push(`## ${label} needle=${JSON.stringify(needle)} hits=${hits.length}`)
  for (const [idx, i] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${idx} @${i} ${asciiSlice(buf, i - around, i + needle.length + around)}`,
    )
  }
  if (hits.length > cap) lines.push(`- … +${hits.length - cap} more`)
  lines.push('')
  return hits
}

function compareHits(label, needle) {
  const h248 = allHits(b248, needle)
  const h247 = b247 ? allHits(b247, needle) : []
  lines.push(
    `## CMP ${label} needle=${JSON.stringify(needle)} hits248=${h248.length} hits247=${b247 ? h247.length : 'n/a'}`,
  )
  return { h248, h247 }
}

// --- Uf mcp-needs-auth ---
const uf = b248.indexOf(Buffer.from('id:"mcp-needs-auth"'))
dumpAround(b248, '248 Uf mcp-needs-auth', uf, 80, 400)

const uf247 = b247 ? b247.indexOf(Buffer.from('id:"mcp-needs-auth"')) : -1
if (b247) dumpAround(b247, '247 Uf mcp-needs-auth', uf247, 80, 400)

// --- Gp JSX used by Uf ---
dumpHits(b248, '248 r(Gp,{status:"warning"', 'r(Gp,{status:"warning"', 80, 20)
if (b247) dumpHits(b247, '247 r(Gp,{status:"warning"', 'r(Gp,{status:"warning"', 80, 8)

// find function Gp( near Uf
const gpNearUf = lastFnStart(b248, uf > 0 ? uf : b248.length, [
  'function Gp(',
  'function Gp=',
])
lines.push(`## lastFnStart Gp before Uf ${JSON.stringify(gpNearUf)}`)
if (gpNearUf.i >= 0) dumpFn(b248, '248 last-Gp-before-Uf', gpNearUf.i, 4000)

const gpHits = allHits(b248, 'function Gp(')
lines.push(`## function Gp( hits248=${gpHits.length}`)
for (const i of gpHits) {
  const win = asciiSlice(b248, i, i + 220)
  lines.push(`- @${i} ${win}`)
}
lines.push('')

// JSX component Gp — often `function Gp(` or `Gp=function` or `function Gp({`
dumpHits(b248, '248 Gp=function', 'Gp=function', 40, 8)
dumpHits(b248, '248 function Gp({', 'function Gp({', 80, 8)
dumpHits(b248, '248 var Gp=', 'var Gp=', 80, 12)

// --- StatusNotices wrapper ---
dumpHits(b248, '248 StatusNotices', 'StatusNotices', 80, 8)
dumpHits(b248, '248 getActiveNotices', 'getActiveNotices', 80, 8)
dumpHits(b248, '248 warnings.length', 'warnings.length', 80, 12)
dumpHits(b248, '248 qt.warnings', 'qt.warnings', 80, 8)

// wrapper around Uf list — look backwards from Uf for paddingLeft
if (uf > 0) {
  dumpAround(b248, '248 Uf-back-2k', uf, 2000, 80)
  dumpAround(b248, '248 Uf-fwd-2k', uf, 80, 2500)
}

// find paddingLeft near mcp-needs-auth / StatusNotices region (20156xxxx)
const noticeRegionStart = 201550000
const noticeRegionEnd = 201590000
function paddingInRegion(buf, start, end, label) {
  const hits = allHits(buf, 'paddingLeft')
  const inR = hits.filter((i) => i >= start && i <= end)
  lines.push(`## ${label} paddingLeft in [${start},${end}] count=${inR.length}`)
  for (const i of inR) {
    lines.push(`- @${i} ${asciiSlice(buf, i - 80, i + 80)}`)
  }
  lines.push('')
  return inR
}
paddingInRegion(b248, noticeRegionStart, noticeRegionEnd, '248 notice-region')

// also scan 20156xxxx more tightly around Uf
if (uf > 0) paddingInRegion(b248, uf - 15000, uf + 15000, '248 Uf±15k')

// find StatusNotices-like render: flexDirection:"column",paddingLeft
dumpHits(
  b248,
  '248 flexDir column paddingLeft:1',
  'flexDirection:"column",paddingLeft:1',
  100,
  15,
)
dumpHits(
  b248,
  '248 flexDir column paddingLeft:2',
  'flexDirection:"column",paddingLeft:2',
  100,
  15,
)
dumpHits(
  b248,
  '248 flexDir column paddingLeft:0',
  'flexDirection:"column",paddingLeft:0',
  100,
  8,
)
dumpHits(b248, '248 paddingLeft:2 flexDir', 'paddingLeft:2,flexDirection:"column"', 80, 15)

if (b247) {
  dumpHits(
    b247,
    '247 flexDir column paddingLeft:1',
    'flexDirection:"column",paddingLeft:1',
    100,
    15,
  )
  dumpHits(
    b247,
    '247 flexDir column paddingLeft:2',
    'flexDirection:"column",paddingLeft:2',
    100,
    15,
  )
  dumpHits(b247, '247 paddingLeft:2 flexDir', 'paddingLeft:2,flexDirection:"column"', 80, 15)
}

// extract function that contains Uf assignment
const ufFn = lastFnStartGeneric(b248, uf > 0 ? uf : 0, 8000)
lines.push(`## lastFnStartGeneric before Uf ${JSON.stringify(ufFn)}`)
if (ufFn.i >= 0) dumpFn(b248, '248 fn-before-Uf', ufFn.i, 12000)

// find render of warnings list — "activeNotices" / ".map((notice" / warnings.map
dumpHits(b248, '248 warnings.map', 'warnings.map', 120, 10)
dumpHits(b248, '248 .warnings', '.warnings', 60, 8)
dumpHits(b248, '248 notice.render', 'notice.render', 80, 8)
dumpHits(b248, '248 render(context)', 'render(context)', 80, 8)
dumpHits(b248, '248 mcpNeedsAuthCount:Yv', 'mcpNeedsAuthCount:Yv', 200, 3)

// Logo / Debug mode enabled — leftover LogoV2 paddingLeft=2
dumpHits(b248, '248 Debug mode enabled', 'Debug mode enabled', 120, 6)
dumpHits(b248, '248 Logging to:', 'Logging to:', 80, 4)
if (b247) {
  dumpHits(b247, '247 Debug mode enabled', 'Debug mode enabled', 120, 6)
}

// run /mcp near Uf
dumpHits(b248, '248 run /mcp', 'run /mcp', 80, 8)
dumpHits(b248, '248 · run /mcp', ' · run /mcp', 80, 8)

// Gp component definition by looking at first r(Gp usage and searching function
// Also try "function Gp({status" or children with warning icon
dumpHits(b248, '248 status==="warning"', 'status==="warning"', 120, 8)
dumpHits(b248, '248 status:"warning",children', 'status:"warning",children', 40, 6)

// extract Gp if it's a React component with status prop
const gpStatus = b248.indexOf(Buffer.from('function Gp({status'))
dumpFn(b248, '248 function Gp({status', gpStatus, 3000)
const gpStatus2 = b248.indexOf(Buffer.from('function Gp(e){let{status'))
dumpFn(b248, '248 function Gp(e){let{status', gpStatus2, 3000)
const gpStatus3 = b248.indexOf(Buffer.from('function Gp({status:'))
dumpFn(b248, '248 function Gp({status:', gpStatus3, 3000)

// generic: search "Gp=({status" and "Gp=function({status"
dumpHits(b248, '248 Gp=({status', 'Gp=({status', 80, 6)
dumpHits(b248, '248 Gp=e=>', 'Gp=(', 40, 10)

// wZe mentioned in leftover
dumpHits(b248, '248 function wZe', 'function wZe', 80, 6)
dumpHits(b248, '248 wZe(', 'wZe(', 60, 8)

// compare unique strings around StatusNotices padding
compareHits('paddingLeft:1 around notices phrase', 'paddingLeft:1')
compareHits(
  'column paddingLeft:1',
  'flexDirection:"column",paddingLeft:1',
)
compareHits(
  'column paddingLeft:2',
  'flexDirection:"column",paddingLeft:2',
)

// Look for wrapper after warnings assembled: $c=qt.warnings.length
const slot = b248.indexOf(Buffer.from('$c=qt.warnings.length>0'))
dumpAround(b248, '248 qt.warnings slot', slot, 200, 800)
if (b247) {
  const slot247 = b247.indexOf(Buffer.from('warnings.length>0'))
  dumpAround(b247, '247 warnings.length>0 first', slot247, 200, 400)
}

// find function that maps warnings to JSX with padding
const warnMapNeedles = [
  'qt.warnings.map',
  'warnings.map((',
  '.map((notice',
  'paddingLeft:1,children:',
  'paddingLeft:2,children:',
  'paddingLeft:0,children:',
]
for (const n of warnMapNeedles) dumpHits(b248, `248 ${n}`, n, 100, 8)

// LogoV2 condensed: paddingLeft:2 near Debug
const dbg = b248.indexOf(Buffer.from('Debug mode enabled'))
if (dbg > 0) {
  dumpAround(b248, '248 Debug-mode-win', dbg, 400, 200)
  const padBefore = b248.lastIndexOf(Buffer.from('paddingLeft'), dbg)
  dumpAround(b248, '248 last-paddingLeft-before-Debug', padBefore, 40, 80)
}
if (b247) {
  const dbg247 = b247.indexOf(Buffer.from('Debug mode enabled'))
  if (dbg247 > 0) {
    dumpAround(b247, '247 Debug-mode-win', dbg247, 400, 200)
    const padBefore = b247.lastIndexOf(Buffer.from('paddingLeft'), dbg247)
    dumpAround(b247, '247 last-paddingLeft-before-Debug', padBefore, 40, 80)
  }
}

// Search StatusNotices-like: "moved neutral" comment won't exist minified.
// Look for "mcp-needs-auth" then find the list renderer that consumes warnings.
const consume = b248.indexOf(Buffer.from('mcpNeedsAuthCount:Yv'))
dumpAround(b248, '248 mcpNeedsAuthCount:Yv ctx', consume, 300, 900)

// extract function around consume
if (consume > 0) {
  const fn = lastFnStartGeneric(b248, consume, 15000)
  lines.push(`## fn before mcpNeedsAuthCount:Yv ${JSON.stringify(fn)}`)
  if (fn.i >= 0) dumpFn(b248, '248 fn-mcpNeedsAuthCount-Yv', fn.i, 20000)
}

writeFileSync(`${outDir}/gold-248-34-column.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-34-column.txt`, 'lines', lines.length)
