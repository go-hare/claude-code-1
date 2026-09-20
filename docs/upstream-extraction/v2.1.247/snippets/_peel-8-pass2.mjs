/**
 * #8 hook-mb-ptl pass 2 — lock JWr/BBr (Yvb/lHb) complete initializer,
 * background-agent error attach, persist-to-disk vs 246.
 * Invent-ban: do not invent 1MB/2MB/10k.
 */
import { createHash } from 'crypto'
import { readFileSync, writeFileSync } from 'fs'

const SEA = {
  247: 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
  246: 'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
}
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const bufs = {
  246: readFileSync(SEA[246]),
  247: readFileSync(SEA[247]),
}
console.log('loaded', bufs[246].length, bufs[247].length)

function allHits(buf, needle, from = 0, to = buf.length) {
  const n = Buffer.from(needle)
  const hits = []
  let i = from
  while (i < to) {
    const j = buf.indexOf(n, i)
    if (j < 0 || j >= to) break
    hits.push(j)
    i = j + n.length
    if (hits.length > 80) break
  }
  return hits
}

function count(buf, needle) {
  const n = Buffer.from(needle)
  let c = 0
  let i = 0
  while (true) {
    const j = buf.indexOf(n, i)
    if (j < 0) break
    c++
    i = j + n.length
  }
  return c
}

function asciiWindow(buf, start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

function dump(name, text) {
  const body = text.endsWith('\n') ? text : `${text}\n`
  writeFileSync(`${outDir}/${name}`, body)
  console.log('WROTE', name, body.length)
}

function sha16(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

function normMin(s) {
  return s.replace(/[A-Za-z_$][\w$]{0,4}/g, 'X')
}

// --- 1. import alias + from-module ---
function dumpImportFrom(ver, aliasNeedle, tag) {
  const hits = allHits(bufs[ver], aliasNeedle)
  dump(
    `gold-8-pass2-${tag}-hits.txt`,
    `# ver=${ver} needle=${JSON.stringify(aliasNeedle)} hits=${hits.length}\n# offsets=${hits.join(',')}\n`,
  )
  hits.forEach((off, i) => {
    const s = asciiWindow(bufs[ver], Math.max(0, off - 80), off + 240)
    const fromM = s.match(/from"([^"]+)"/)
    dump(
      `gold-8-pass2-${tag}-h${i}-${ver}.txt`,
      `# offset=${off} from=${fromM ? fromM[1] : 'NONE'}\n\n${s}\n`,
    )
    console.log(ver, tag, i, 'from', fromM && fromM[1], off)
  })
  return hits
}

dumpImportFrom(247, 'Yvb as JWr', 'import-JWr')
dumpImportFrom(246, 'lHb as BBr', 'import-BBr')

// confirm from module of the JS import (not the name table)
{
  const off = bufs[247].indexOf(Buffer.from('Yvb as JWr'))
  const s = asciiWindow(bufs[247], off, off + 4000)
  const froms = [...s.matchAll(/from"([^"]+)"/g)].map((m) => m[1])
  dump(
    'gold-8-pass2-JWr-from-chain-247.txt',
    `# offset=${off}\n# froms=${JSON.stringify(froms)}\n\n${s.slice(0, 2500)}\n`,
  )
  console.log('JWr from-chain', froms)
}
{
  const off = bufs[246].indexOf(Buffer.from('lHb as BBr'))
  const s = asciiWindow(bufs[246], off, off + 4000)
  const froms = [...s.matchAll(/from"([^"]+)"/g)].map((m) => m[1])
  dump(
    'gold-8-pass2-BBr-from-chain-246.txt',
    `# offset=${off}\n# froms=${JSON.stringify(froms)}\n\n${s.slice(0, 2500)}\n`,
  )
  console.log('BBr from-chain', froms)
}

// --- 2. walk Yvb / lHb definition (spaces, export, var/const/let) ---
function classifyHits(ver, needle, tag, before = 120, after = 200) {
  const hits = allHits(bufs[ver], needle)
  const lines = [`# ver=${ver} needle=${JSON.stringify(needle)} hits=${hits.length}`]
  let dumped = 0
  hits.forEach((off, i) => {
    const s = asciiWindow(bufs[ver], Math.max(0, off - before), off + after)
    const printable = (s.match(/[\t\n\r\x20-\x7e]/g) || []).length / s.length
    lines.push(`# h${i} offset=${off} ratio=${printable.toFixed(3)} ${JSON.stringify(s.replace(/\s+/g, ' ').slice(0, 180))}`)
    if (printable >= 0.75 && dumped < 12) {
      dump(
        `gold-8-pass2-${tag}-h${i}-${ver}.txt`,
        `# offset=${off} ver=${ver} ratio=${printable.toFixed(3)} needle=${JSON.stringify(needle)}\n\n${s}\n`,
      )
      dumped++
    }
  })
  dump(`gold-8-pass2-${tag}-index-${ver}.txt`, `${lines.join('\n')}\n`)
  console.log(ver, tag, 'hits', hits.length, 'dumped', dumped)
  return hits
}

const defNeedles247 = [
  'Yvb=',
  'Yvb =',
  'var Yvb',
  'const Yvb',
  'let Yvb',
  'export{Yvb',
  'export {Yvb',
  ' as Yvb',
  'as Yvb}',
  'as Yvb,',
  'function Yvb',
  'Yvb,',
]
const defNeedles246 = [
  'lHb=',
  'lHb =',
  'var lHb',
  'const lHb',
  'let lHb',
  'export{lHb',
  'export {lHb',
  ' as lHb',
  'as lHb}',
  'as lHb,',
  'function lHb',
  'lHb,',
]

console.log('\n=== Yvb / lHb definition needles ===')
for (const n of defNeedles247) {
  console.log('247', JSON.stringify(n), count(bufs[247], n))
}
for (const n of defNeedles246) {
  console.log('246', JSON.stringify(n), count(bufs[246], n))
}

classifyHits(247, 'var Yvb', 'var-Yvb', 80, 300)
classifyHits(247, 'const Yvb', 'const-Yvb', 80, 300)
classifyHits(247, 'let Yvb', 'let-Yvb', 80, 300)
classifyHits(247, 'Yvb =', 'Yvb-space', 80, 300)
classifyHits(247, 'export{Yvb', 'export-Yvb', 200, 400)
classifyHits(247, ' as Yvb', 'as-Yvb', 120, 300)
classifyHits(247, 'as Yvb}', 'as-Yvb-end', 200, 200)
classifyHits(247, 'as Yvb,', 'as-Yvb-comma', 200, 200)

classifyHits(246, 'var lHb', 'var-lHb', 80, 300)
classifyHits(246, 'const lHb', 'const-lHb', 80, 300)
classifyHits(246, 'let lHb', 'let-lHb', 80, 300)
classifyHits(246, 'lHb =', 'lHb-space', 80, 300)
classifyHits(246, 'export{lHb', 'export-lHb', 200, 400)
classifyHits(246, ' as lHb', 'as-lHb', 120, 300)
classifyHits(246, 'as lHb}', 'as-lHb-end', 200, 200)
classifyHits(246, 'as lHb,', 'as-lHb-comma', 200, 200)

// locate _559.js module body (247) and the 246 sibling
function findModuleVersionComment(buf, version, beforePos) {
  const needle = `// Version: ${version}`
  return buf.lastIndexOf(Buffer.from(needle), beforePos)
}

function dumpModuleAroundExport(ver, exportNeedle, tag) {
  const hits = allHits(bufs[ver], exportNeedle)
  console.log(ver, 'exportNeedle', exportNeedle, hits)
  for (const [i, off] of hits.slice(0, 4).entries()) {
    const verStr = ver === 247 ? '2.1.247' : '2.1.246'
    const modStart = findModuleVersionComment(bufs[ver], verStr, off)
    dump(
      `gold-8-pass2-${tag}-export-h${i}-${ver}.txt`,
      `# exportOff=${off} modStart=${modStart}\n\n${asciiWindow(bufs[ver], Math.max(0, off - 400), off + 600)}\n`,
    )
    if (modStart >= 0) {
      dump(
        `gold-8-pass2-${tag}-modstart-h${i}-${ver}.txt`,
        `# modStart=${modStart} exportOff=${off} span=${off - modStart}\n\n${asciiWindow(bufs[ver], modStart, Math.min(modStart + 2500, off + 200))}\n`,
      )
    }
  }
}

dumpModuleAroundExport(247, 'export{Yvb', 'Yvb')
dumpModuleAroundExport(247, 'Yvb as JWr', 'JWrimp')
dumpModuleAroundExport(246, 'export{lHb', 'lHb')
dumpModuleAroundExport(246, 'lHb as BBr', 'BBrimp')

// If _559.js source is marked, dump it
for (const [ver, marker] of [
  [247, 'B:/~BUN/root/_559.js'],
  [246, 'B:/~BUN/root/_559.js'],
]) {
  const hits = allHits(bufs[ver], marker)
  console.log(ver, marker, 'hits', hits.length, hits.slice(0, 8))
  hits.slice(0, 6).forEach((off, i) => {
    dump(
      `gold-8-pass2-mod559-ref-h${i}-${ver}.txt`,
      `# offset=${off}\n\n${asciiWindow(bufs[ver], Math.max(0, off - 200), off + 400)}\n`,
    )
  })
}

// Extract complete assignment if any ident=number near persist threshold names
function extractAssignment(buf, ident) {
  const patterns = [
    `var ${ident}=`,
    `const ${ident}=`,
    `let ${ident}=`,
    `,${ident}=`,
    `;${ident}=`,
    ` ${ident}=`,
  ]
  const found = []
  for (const p of patterns) {
    for (const off of allHits(buf, p)) {
      const s = asciiWindow(buf, off, off + 200)
      // complete initializer: ident = <expr> up to comma/semicolon
      const m = s.match(
        new RegExp(
          `${ident}\\s*=\\s*([^,;]{1,120})`,
        ),
      )
      found.push({
        pattern: p,
        off,
        expr: m ? m[1].trim() : 'PARSE_FAIL',
        win: s.slice(0, 160),
      })
    }
  }
  return found
}

const yvbAssigns = extractAssignment(bufs[247], 'Yvb')
const lhbAssigns = extractAssignment(bufs[246], 'lHb')
const jwrAssigns = extractAssignment(bufs[247], 'JWr')
const bbrAssigns = extractAssignment(bufs[246], 'BBr')

dump(
  'gold-8-pass2-assign-scan.txt',
  [
    '# Yvb assigns 247',
    ...yvbAssigns.map((a) => JSON.stringify(a)),
    '# lHb assigns 246',
    ...lhbAssigns.map((a) => JSON.stringify(a)),
    '# JWr assigns 247',
    ...jwrAssigns.map((a) => JSON.stringify(a)),
    '# BBr assigns 246',
    ...bbrAssigns.map((a) => JSON.stringify(a)),
  ].join('\n') + '\n',
)
console.log('assigns', {
  Yvb: yvbAssigns.length,
  lHb: lhbAssigns.length,
  JWr: jwrAssigns.length,
  BBr: bbrAssigns.length,
})

// --- 3. persist helper body compare (complete, normalized) ---
function extractFn(buf, sig, maxLen = 2500) {
  const off = buf.indexOf(Buffer.from(sig))
  if (off < 0) return { off: -1, src: '' }
  const src = asciiWindow(buf, off, off + maxLen)
  const brace = src.indexOf('{')
  if (brace < 0) return { off, src }
  let depth = 0
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return { off, src: src.slice(0, i + 1) }
    }
  }
  return { off, src }
}

const lre = extractFn(
  bufs[247],
  'async function lre(e,t,n,{threshold:r=JWr,storageV5:o}={})',
)
const rne = extractFn(
  bufs[246],
  'async function Rne(e,t,n,{threshold:r=BBr,storageV5:o}={})',
)
dump('gold-8-pass2-lre-body-247.txt', `# off=${lre.off} len=${lre.src.length} sha=${sha16(lre.src)}\n\n${lre.src}\n`)
dump('gold-8-pass2-Rne-body-246.txt', `# off=${rne.off} len=${rne.src.length} sha=${sha16(rne.src)}\n\n${rne.src}\n`)
const lreN = normMin(lre.src)
const rneN = normMin(rne.src)
dump(
  'gold-8-pass2-persist-norm-cmp.txt',
  `# lre.len=${lre.src.length} Rne.len=${rne.src.length}\n# lre.sha=${sha16(lre.src)} Rne.sha=${sha16(rne.src)}\n# normEqual=${lreN === rneN}\n# normSha=${sha16(lreN)} ${sha16(rneN)}\n`,
)
console.log('persist normEqual', lreN === rneN, lre.src.length, rne.src.length)

// persist callee VP / AP — is THAT 247-unique?
function extractNamed(buf, name, kind = 'async function') {
  const sig = `${kind} ${name}(`
  return extractFn(buf, sig, 8000)
}
const vp = extractNamed(bufs[247], 'VP')
const ap = extractNamed(bufs[246], 'AP')
dump(
  'gold-8-pass2-VP-247.txt',
  `# off=${vp.off} len=${vp.src.length}\n\n${vp.src.slice(0, 4000)}\n`,
)
dump(
  'gold-8-pass2-AP-246.txt',
  `# off=${ap.off} len=${ap.src.length}\n\n${ap.src.slice(0, 4000)}\n`,
)
console.log('VP/AP', vp.off, vp.src.length, ap.off, ap.src.length, 'norm', normMin(vp.src) === normMin(ap.src))

// --- 4. background-agent error attach (not hook) ---
const bgNeedles = [
  'printed megabytes',
  'overflow the conversation',
  'wedge the session',
  'megabytes of error',
  'background agent that',
  'agent that printed',
  'Prompt is too long',
  'prompt is too long',
  'background agent error',
  'Background agent error',
  'agent error output',
  'agent stderr',
  'stderr.slice',
  'error.slice',
  'task_notification',
  'type:"agent_error"',
  'type:"background_agent',
  'background_agent_error',
  'agent_completion_error',
  'truncatedFallback',
  'persist-to-disk failed',
  'tengu_hook_output_persisted',
  'tengu_agent_output_persisted',
  'tengu_bg_output_persisted',
  'await lre(',
  'await Rne(',
]

console.log('\n=== bg / persist counts ===')
const countLines = ['# pass2 counts 246 / 247']
for (const n of bgNeedles) {
  const a = count(bufs[246], n)
  const b = count(bufs[247], n)
  if (a || b) {
    const mark = a !== b ? ' DIFF' : ''
    console.log(`${a}\t${b}\t${JSON.stringify(n)}${mark}`)
    countLines.push(`${a}\t${b}\t${JSON.stringify(n)}${mark}`)
  } else {
    countLines.push(`${a}\t${b}\t${JSON.stringify(n)} MISS`)
  }
}
dump('gold-8-pass2-counts.txt', countLines.join('\n') + '\n')

// unique 247 windows for agent-error-ish attach
function uniqueWindows(needle, radius = 90) {
  const a = allHits(bufs[246], needle)
  const b = allHits(bufs[247], needle)
  const set246 = new Set(a.map((off) => asciiWindow(bufs[246], off, off + radius)))
  const uniq = []
  for (const off of b) {
    const w = asciiWindow(bufs[247], off, off + radius)
    if (!set246.has(w)) uniq.push({ off, w })
  }
  return { total246: a.length, total247: b.length, uniq }
}

const uniqProbes = [
  'background agent',
  'Background agent',
  'agent error',
  'stderr',
  'Prompt is too long',
  'persist-to-disk failed',
  'truncated at ${',
]
for (const n of uniqProbes) {
  const u = uniqueWindows(n, 100)
  console.log('unique', JSON.stringify(n), u.total246, u.total247, 'uniq', u.uniq.length)
  u.uniq.slice(0, 8).forEach((x, i) => {
    const s = asciiWindow(bufs[247], Math.max(0, x.off - 900), x.off + 900)
    const js =
      s.includes('function ') || s.includes('=>') || s.includes('if(') || s.includes('return ')
    if (!js && i > 2) return
    dump(
      `gold-8-pass2-uniq-${n.replace(/[^A-Za-z0-9]+/g, '-').replace(/-+$/g, '')}-h${i}-247.txt`,
      `# off=${x.off} js=${js} window=${JSON.stringify(x.w)}\n\n${s}\n`,
    )
  })
}

// agent conversation attach templates
const attachNeedles = [
  'agent failed',
  'Agent failed',
  'agent error:',
  'Agent error:',
  'background agent failed',
  'background agent exited',
  'task failed:',
  'Task failed',
  'error output:',
  'full error',
  'stderr output',
  'No stderr output',
  'hook blocking error from command',
  'hook_blocking_error',
  'hook_error_during_execution',
  'hook_non_blocking_error',
]
console.log('\n=== attach template counts ===')
for (const n of attachNeedles) {
  const a = count(bufs[246], n)
  const b = count(bufs[247], n)
  if (a || b) console.log(`${a}\t${b}\t${JSON.stringify(n)}${a !== b ? ' DIFF' : ''}`)
}

for (const n of [
  'agent failed',
  'Agent failed',
  'background agent failed',
  'background agent exited',
  'hook_error_during_execution',
  'hook_non_blocking_error',
]) {
  for (const ver of [246, 247]) {
    const hits = allHits(bufs[ver], n)
    hits.slice(0, 3).forEach((off, i) => {
      const s = asciiWindow(bufs[ver], Math.max(0, off - 600), off + 800)
      if ((s.match(/[\x20-\x7e]/g) || []).length / s.length < 0.8) return
      dump(
        `gold-8-pass2-attach-${n.replace(/[^A-Za-z0-9]+/g, '-').replace(/-+$/g, '')}-h${i}-${ver}.txt`,
        `# off=${off} ver=${ver}\n\n${s}\n`,
      )
    })
  }
}

// slice/substring near background agent / stderr attach — 247-only
function nearUnique(needle, neighbors, radius = 500) {
  const keep = (buf) =>
    allHits(buf, needle).filter((off) => {
      const w = asciiWindow(buf, Math.max(0, off - radius), off + radius)
      return neighbors.some((n) => w.includes(n))
    })
  const a = keep(bufs[246])
  const b = keep(bufs[247])
  const set246 = new Set(a.map((off) => asciiWindow(bufs[246], off, off + 70)))
  const uniq = b.filter((off) => !set246.has(asciiWindow(bufs[247], off, off + 70)))
  return { a: a.length, b: b.length, uniq }
}

const neighbors = [
  'agent',
  'Agent',
  'stderr',
  'hook',
  'Hook',
  'truncat',
  'conversation',
  'attachment',
  'blockingError',
]
console.log('\n=== numeric near agent/hook/stderr ===')
const nearLines = ['# numeric near agent/hook/stderr 246 / 247 / uniq247']
for (const n of [
  '1048576',
  '2097152',
  '1e6',
  '2e6',
  '1e7',
  '1e5',
  '10000',
  'slice(0,',
  'substring(0,',
  '.slice(0,r)',
]) {
  const r = nearUnique(n, neighbors, 400)
  console.log(n, r)
  nearLines.push(`${JSON.stringify(n)}\t246=${r.a}\t247=${r.b}\tuniq=${r.uniq.length}`)
  r.uniq.slice(0, 4).forEach((off, i) => {
    dump(
      `gold-8-pass2-near-${n.replace(/[^A-Za-z0-9]+/g, '')}-uniq-h${i}-247.txt`,
      `# off=${off} needle=${JSON.stringify(n)}\n\n${asciiWindow(bufs[247], Math.max(0, off - 700), off + 700)}\n`,
    )
  })
}
dump('gold-8-pass2-near-index.txt', nearLines.join('\n') + '\n')

// lre/Rne 3rd-arg kinds
const kinds = [
  ',"stdout"',
  ',"stderr"',
  ',"additionalContext"',
  ',"systemMessage"',
  ',"initialUserMessage"',
  ',"error"',
  ',"agent"',
  ',"agentError"',
  ',"background"',
  ',"blockingError"',
]
console.log('\n=== persist kinds ===')
for (const n of kinds) {
  console.log(count(bufs[246], n + ',{storageV5'), count(bufs[247], n + ',{storageV5'), n)
}

// blockingError still full interpolate?
for (const [ver, needle] of [
  [247, 'blockingError:`[${'],
  [246, 'blockingError:`[${'],
  [247, 'he.stderr||"No stderr output"'],
  [246, 'ye.stderr||"No stderr output"'],
]) {
  const off = bufs[ver].indexOf(Buffer.from(needle))
  dump(
    `gold-8-pass2-block-build-${ver}.txt`,
    `# off=${off} needle=${JSON.stringify(needle)}\n\n${off < 0 ? 'MISS' : asciiWindow(bufs[ver], Math.max(0, off - 200), off + 400)}\n`,
  )
}

// hook attach templates (confirm still full text)
for (const [ver, needle] of [
  [247, 'hook blocking error from command: "'],
  [246, 'hook blocking error from command: "'],
]) {
  const hits = allHits(bufs[ver], needle)
  const off = hits[Math.min(1, hits.length - 1)] ?? -1
  dump(
    `gold-8-pass2-block-attach-${ver}.txt`,
    `# off=${off} hits=${hits.length}\n\n${off < 0 ? 'MISS' : asciiWindow(bufs[ver], off, off + 350)}\n`,
  )
}

console.log('\nDONE pass2 peel')
