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

function allHits(buf, needle) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (from < buf.length) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
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
  return s.replace(/[.]{4,}/g, '...')
}

function looksJs(s) {
  return (
    s.includes('function ') ||
    s.includes('=>') ||
    s.includes('if(') ||
    s.includes('return ') ||
    s.includes('var ') ||
    s.includes('const ')
  )
}

function count(buf, needle) {
  return allHits(buf, needle).length
}

function dump(ver, tag, needle, before, after, which = 0) {
  const hits = allHits(bufs[ver], needle)
  if (!hits.length) {
    console.log('MISS', ver, tag, JSON.stringify(needle))
    writeFileSync(
      `${outDir}/gold-8-${tag}-${ver}-MISS.txt`,
      `# MISS ver=${ver} needle=${JSON.stringify(needle)}\n`,
    )
    return
  }
  const i = hits[Math.min(which, hits.length - 1)]
  const s = asciiWindow(bufs[ver], Math.max(0, i - before), i + after)
  writeFileSync(
    `${outDir}/gold-8-${tag}-${ver}.txt`,
    `# offset=${i} ver=${ver} hit=${which + 1}/${hits.length} js=${looksJs(s)} needle=${JSON.stringify(needle)}\n\n${s}\n`,
  )
  console.log('OK', ver, tag, `${which + 1}/${hits.length}`, i, 'js', looksJs(s))
}

function dumpJsHits(ver, tag, needle, before, after, maxHits = 8) {
  const hits = allHits(bufs[ver], needle)
  console.log(`hits ${ver} ${JSON.stringify(needle)} => ${hits.length}`)
  let dumped = 0
  for (let i = 0; i < hits.length && dumped < maxHits; i++) {
    const off = hits[i]
    const s = asciiWindow(bufs[ver], Math.max(0, off - before), off + after)
    if (!looksJs(s)) continue
    writeFileSync(
      `${outDir}/gold-8-${tag}-h${i}-${ver}.txt`,
      `# offset=${off} ver=${ver} hit=${i + 1}/${hits.length} js=true needle=${JSON.stringify(needle)}\n\n${s}\n`,
    )
    console.log('  js-dump', tag, 'h' + i, off)
    dumped++
  }
  if (!dumped) {
    writeFileSync(
      `${outDir}/gold-8-${tag}-${ver}-nojs.txt`,
      `# no JS-looking windows ver=${ver} hits=${hits.length} needle=${JSON.stringify(needle)}\n# offsets=${hits.slice(0, 20).join(',')}\n`,
    )
    console.log('  no-js', ver, tag, 'hits', hits.length)
  }
}

function nearHits(buf, needle, neighbors, radius = 800) {
  const hits = allHits(buf, needle)
  const kept = []
  for (const off of hits) {
    const win = asciiWindow(buf, Math.max(0, off - radius), off + radius)
    if (neighbors.some((n) => win.includes(n))) kept.push(off)
  }
  return kept
}

const needles = [
  'Prompt is too long',
  'prompt is too long',
  'megabyte',
  'megabytes',
  'MAX_HOOK_OUTPUT',
  'MAX_HOOK_OUTPUT_LENGTH',
  'output truncated - exceeded',
  'output truncated -',
  '[output truncated',
  'hook success:',
  'hook additional context:',
  'hook blocking error from command',
  'hook_error_during_execution',
  'hook_non_blocking_error',
  'hook_success',
  'background agent',
  'Background agent',
  'truncateHook',
  'hookTruncat',
  'applyTruncation',
  'KB removed',
  'characters]',
  'exceeded ${',
  'No stderr output',
  'hook warning',
  'printed megabytes',
  'overflow the conversation',
  'wedge the session',
  '1048576',
  '2097152',
  '2e6',
  '1e6',
  '2**21',
  '2**20',
]

console.log('\n=== COUNTS 246 / 247 ===')
for (const n of needles) {
  const a = count(bufs[246], n)
  const b = count(bufs[247], n)
  const mark = a !== b ? ' DIFF' : ''
  if (a || b) console.log(`${a}\t${b}\t${JSON.stringify(n)}${mark}`)
}

dump('247', 'ptl', 'Prompt is too long', 2500, 1500)
dump('246', 'ptl', 'Prompt is too long', 2500, 1500)
dump('247', 'ptl-lc', 'prompt is too long', 1500, 1500)
dump('246', 'ptl-lc', 'prompt is too long', 1500, 1500)
dump('247', 'hook-success-copy', 'hook success:', 3000, 2500)
dump('246', 'hook-success-copy', 'hook success:', 3000, 2500)
dump('247', 'hook-addctx', 'hook additional context:', 2500, 2000)
dump('246', 'hook-addctx', 'hook additional context:', 2500, 2000)
dump('247', 'hook-block-copy', 'hook blocking error from command', 3000, 2500)
dump('246', 'hook-block-copy', 'hook blocking error from command', 3000, 2500)
dump('247', 'no-stderr', 'No stderr output', 2500, 2000)
dump('246', 'no-stderr', 'No stderr output', 2500, 2000)
dump('247', 'kb-removed', 'KB removed', 2000, 1500)
dump('246', 'kb-removed', 'KB removed', 2000, 1500)
dump('247', 'trunc-exceeded', 'output truncated - exceeded', 2500, 2000)
dump('246', 'trunc-exceeded', 'output truncated - exceeded', 2500, 2000)
dump('247', 'max-hook', 'MAX_HOOK_OUTPUT', 800, 800)
dump('246', 'max-hook', 'MAX_HOOK_OUTPUT', 800, 800)
dump('247', 'megabyte', 'megabyte', 800, 800)
dump('246', 'megabyte', 'megabyte', 800, 800)

dumpJsHits('247', 'output-trunc', 'output truncated -', 2500, 2000, 10)
dumpJsHits('246', 'output-trunc', 'output truncated -', 2500, 2000, 10)
dumpJsHits('247', 'hook-err-type', 'hook_error_during_execution', 2000, 2500, 6)
dumpJsHits('246', 'hook-err-type', 'hook_error_during_execution', 2000, 2500, 6)
dumpJsHits('247', 'bg-agent', 'background agent', 2000, 2000, 6)
dumpJsHits('246', 'bg-agent', 'background agent', 2000, 2000, 6)

const neighbors = [
  'hook',
  'Hook',
  'stderr',
  'stdout',
  'agent',
  'truncat',
  'Prompt is too long',
  'attachment',
  'conversation',
]

console.log('\n=== NUMERIC NEAR HOOK/AGENT/TRUNC ===')
for (const n of ['1048576', '2097152', '1e6', '2e6', '=10000', '=1e4', '=1e5', '=1e7']) {
  const a = nearHits(bufs[246], n, neighbors, 600)
  const b = nearHits(bufs[247], n, neighbors, 600)
  console.log(
    `${n}\t246near=${a.length}\t247near=${b.length}${a.length !== b.length ? ' DIFF' : ''}`,
  )
  if (b.length) {
    const off = b[0]
    const s = asciiWindow(bufs[247], Math.max(0, off - 1200), off + 1200)
    writeFileSync(
      `${outDir}/gold-8-near-${n.replace(/[^A-Za-z0-9]+/g, '')}-247.txt`,
      `# offset=${off} ver=247 nearHits=${b.length} needle=${JSON.stringify(n)}\n\n${s}\n`,
    )
    console.log('  dump near', n, off)
  }
}

function extractFn(buf, off, back = 4000, fwd = 2500) {
  const start0 = Math.max(0, off - back)
  const win = asciiWindow(buf, start0, off + fwd)
  const markers = ['function ', 'async function ', 'class ']
  let cut = -1
  for (const m of markers) {
    const i = win.lastIndexOf(m, off - start0)
    if (i > cut) cut = i
  }
  return cut >= 0 ? win.slice(cut) : win
}

const attachNeedles = [
  'hook success:',
  'hook additional context:',
  'hook blocking error from command',
  'No stderr output',
]
console.log('\n=== FN EXTRACT 247 vs 246 ===')
for (const n of attachNeedles) {
  const h247 = allHits(bufs[247], n)
  const h246 = allHits(bufs[246], n)
  const tag = n.replace(/[^A-Za-z0-9]+/g, '-').replace(/-+$/g, '')
  if (h247[0] != null) {
    const body247 = extractFn(bufs[247], h247[0])
    writeFileSync(`${outDir}/gold-8-fn-${tag}-247.txt`, body247)
  }
  if (h246[0] != null) {
    const body246 = extractFn(bufs[246], h246[0])
    writeFileSync(`${outDir}/gold-8-fn-${tag}-246.txt`, body246)
  }
  if (h247[0] != null && h246[0] != null) {
    const a = extractFn(bufs[247], h247[0])
    const b = extractFn(bufs[246], h246[0])
    const same = a.replace(/[A-Za-z_$]{1,3}\(/g, 'X(') === b.replace(/[A-Za-z_$]{1,3}\(/g, 'X(')
    console.log(JSON.stringify(n), 'same-shape', same, 'len', a.length, b.length)
  }
}

function asciiRatio(s) {
  if (!s.length) return 0
  let ok = 0
  for (const ch of s) {
    const c = ch.charCodeAt(0)
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)) ok++
  }
  return ok / s.length
}

function dumpAsciiHits(ver, tag, needle, before, after, maxHits = 8) {
  const hits = allHits(bufs[ver], needle)
  console.log(`ascii-hits ${ver} ${JSON.stringify(needle)} => ${hits.length}`)
  let dumped = 0
  for (let i = 0; i < hits.length && dumped < maxHits; i++) {
    const off = hits[i]
    const s = asciiWindow(bufs[ver], Math.max(0, off - before), off + after)
    if (asciiRatio(s) < 0.85) continue
    writeFileSync(
      `${outDir}/gold-8-ascii-${tag}-h${i}-${ver}.txt`,
      `# offset=${off} ver=${ver} hit=${i + 1}/${hits.length} ratio=${asciiRatio(s).toFixed(3)} needle=${JSON.stringify(needle)}\n\n${s}\n`,
    )
    console.log('  ascii-dump', tag, 'h' + i, off, asciiRatio(s).toFixed(3))
    dumped++
  }
  if (!dumped) {
    writeFileSync(
      `${outDir}/gold-8-ascii-${tag}-${ver}-none.txt`,
      `# no high-ASCII windows ver=${ver} hits=${hits.length} needle=${JSON.stringify(needle)}\n`,
    )
    console.log('  no-ascii', ver, tag, 'hits', hits.length)
  }
}

function uniqueWindows(needle, radius = 80) {
  const a = allHits(bufs[246], needle)
  const b = allHits(bufs[247], needle)
  const set246 = new Set(
    a.map((off) => asciiWindow(bufs[246], off, off + radius)),
  )
  const uniq = []
  for (const off of b) {
    const w = asciiWindow(bufs[247], off, off + radius)
    if (!set246.has(w)) uniq.push({ off, w })
  }
  return uniq
}

console.log('\n=== ASCII JS TEMPLATES ===')
const asciiNeedles = [
  'case"hook_success"',
  'case"hook_additional_context"',
  'case"hook_blocking_error"',
  'case"hook_error_during_execution"',
  'hook success: ${',
  'hook additional context: ${',
  'hook blocking error from command: "',
  'content:e.content',
  'content:e.stderr',
  'slice(0,1048576',
  'slice(0,1e6',
  'slice(0,2e6',
  'substring(0,1048576',
  'length>1048576',
  'length>1e6',
  'length>2e6',
  '.length>1e4',
  '.length>1e5',
  'output truncated',
]

for (const n of asciiNeedles) {
  const a = count(bufs[246], n)
  const b = count(bufs[247], n)
  if (a || b) console.log(`${a}\t${b}\t${JSON.stringify(n)}${a !== b ? ' DIFF' : ''}`)
  dumpAsciiHits('247', n.replace(/[^A-Za-z0-9]+/g, '-').replace(/-+$/g, ''), n, 2000, 2000, 4)
}

console.log('\n=== 2e6 ALL ===')
{
  const hits = allHits(bufs[247], '2e6')
  console.log('2e6 hits 247', hits.length)
  hits.forEach((off, i) => {
    const s = asciiWindow(bufs[247], Math.max(0, off - 400), off + 400)
    writeFileSync(
      `${outDir}/gold-8-2e6-h${i}-247.txt`,
      `# offset=${off} ver=247 hit=${i + 1}/${hits.length}\n\n${s}\n`,
    )
    console.log('  2e6', i, off, JSON.stringify(s.slice(Math.max(0, 350), 450)))
  })
  const hits246 = allHits(bufs[246], '2e6')
  console.log('2e6 hits 246', hits246.length)
  hits246.forEach((off, i) => {
    const s = asciiWindow(bufs[246], Math.max(0, off - 400), off + 400)
    writeFileSync(
      `${outDir}/gold-8-2e6-h${i}-246.txt`,
      `# offset=${off} ver=246 hit=${i + 1}/${hits246.length}\n\n${s}\n`,
    )
  })
}

console.log('\n=== UNIQUE background agent WINDOWS ===')
{
  const uniq = uniqueWindows('background agent', 100)
  console.log('unique 247 background-agent windows', uniq.length)
  uniq.slice(0, 12).forEach((u, i) => {
    const s = asciiWindow(bufs[247], Math.max(0, u.off - 1500), u.off + 1500)
    writeFileSync(
      `${outDir}/gold-8-bg-unique-h${i}-247.txt`,
      `# offset=${u.off} ver=247 uniqueWindow=${JSON.stringify(u.w)}\n\n${s}\n`,
    )
    console.log('  uniq', i, u.off, JSON.stringify(u.w))
  })
}

console.log('\n=== UNIQUE 1048576 near hook/trunc (shape) ===')
{
  const neighbors = ['hook', 'Hook', 'stderr', 'truncat', 'attachment']
  const a = nearHits(bufs[246], '1048576', neighbors, 400)
  const b = nearHits(bufs[247], '1048576', neighbors, 400)
  const set246 = new Set(
    a.map((off) => asciiWindow(bufs[246], off, off + 60)),
  )
  let n = 0
  for (const off of b) {
    const w = asciiWindow(bufs[247], off, off + 60)
    if (set246.has(w)) continue
    const s = asciiWindow(bufs[247], Math.max(0, off - 800), off + 800)
    writeFileSync(
      `${outDir}/gold-8-1048576-unique-h${n}-247.txt`,
      `# offset=${off}\n\n${s}\n`,
    )
    console.log('  unique 1048576', n, off, JSON.stringify(w))
    n++
    if (n >= 8) break
  }
  console.log('unique 1048576 near', n)
}

function dumpBothAscii(tag, needle, before, after, which = 0) {
  for (const ver of [246, 247]) {
    const hits = allHits(bufs[ver], needle)
    if (!hits.length) {
      console.log('MISS both-ascii', ver, tag)
      continue
    }
    const i = hits[Math.min(which, hits.length - 1)]
    const s = asciiWindow(bufs[ver], Math.max(0, i - before), i + after)
    writeFileSync(
      `${outDir}/gold-8-cmp-${tag}-${ver}.txt`,
      `# offset=${i} ver=${ver} hit=${which + 1}/${hits.length} needle=${JSON.stringify(needle)}\n\n${s}\n`,
    )
    console.log('cmp', ver, tag, i, 'hits', hits.length)
  }
}

console.log('\n=== CMP HOOK API + CREATE ===')
dumpBothAscii('hook-success-tpl', 'hook success: ${', 200, 400)
dumpBothAscii('hook-addctx-tpl', 'hook additional context: ${', 200, 500)
dumpBothAscii('hook-block-tpl', 'hook blocking error from command: "', 80, 400, 1)
dumpBothAscii('userprompt-exp', 'UserPromptExpansion', 200, 400)
dumpBothAscii('nW-def', 'function nW(', 80, 600)
dumpBothAscii('Lj-def', 'function Lj(', 80, 600)

const createNeedles = [
  'type:"hook_success",content:',
  'type:"hook_success",content',
  'content:f.stdout',
  'content:e.stdout',
  'content:t.stdout',
  'content:r.stdout.trim',
  'additionalContexts.map',
  'blockingError:r.stderr',
  'blockingError:`[${',
  'No stderr output',
  'function nW(',
  'nW(g.stderr',
  'Lj(g.stderr',
]

console.log('\n=== CREATE / HELPER COUNTS ===')
for (const n of createNeedles) {
  const a = count(bufs[246], n)
  const b = count(bufs[247], n)
  if (a || b) console.log(`${a}\t${b}\t${JSON.stringify(n)}${a !== b ? ' DIFF' : ''}`)
}

dumpAsciiHits('247', 'create-hook-success', 'type:"hook_success"', 400, 800, 6)
dumpAsciiHits('246', 'create-hook-success', 'type:"hook_success"', 400, 800, 6)
dumpAsciiHits('247', 'stdout-trim', 'stdout.trim()', 300, 500, 6)
dumpAsciiHits('247', 'addctx-map', 'additionalContexts.map', 400, 600, 4)
dumpAsciiHits('246', 'addctx-map', 'additionalContexts.map', 400, 600, 4)

console.log('\n=== 246 extra case hook_success ===')
dumpAsciiHits('246', 'case-hook-success', 'case"hook_success"', 200, 400, 6)

console.log('\n=== PROCESSUSERINPUT HOOK ===')
dumpBothAscii(
  'ups-cancelled',
  'UserPromptSubmit hooks cancelled',
  4000,
  800,
)
dumpBothAscii(
  'prompt-submit-bi',
  'the prompt did not go through prompt.submit',
  2500,
  400,
)
dumpBothAscii('hook-success-if-content', 'if(!m.message.attachment.content)', 800, 400)
dumpBothAscii(
  'hook-success-if-content-247shape',
  'attachment.content)break',
  800,
  400,
)

const puiNeedles = [
  'UserPromptSubmit hooks cancelled',
  'if(!m.message.attachment.content)',
  'if(!e.message.attachment.content)',
  'applyTruncation',
  'additionalContexts.map(',
  'content:m.additionalContexts',
  'content:e.additionalContexts',
  'hookEvent:"UserPromptSubmit"',
  'substring(0,',
  '… [output truncated',
  '[output truncated - exceeded',
]

console.log('\n=== PUI COUNTS ===')
for (const n of puiNeedles) {
  const a = count(bufs[246], n)
  const b = count(bufs[247], n)
  if (a || b) console.log(`${a}\t${b}\t${JSON.stringify(n)}${a !== b ? ' DIFF' : ''}`)
}

dumpAsciiHits('247', 'ups-body', 'UserPromptSubmit hooks cancelled', 5000, 200, 2)
dumpAsciiHits('246', 'ups-body', 'UserPromptSubmit hooks cancelled', 5000, 200, 2)
dumpAsciiHits('247', 'addctx-assign', 'content:m.additionalContexts', 500, 400, 4)
dumpAsciiHits('246', 'addctx-assign', 'content:m.additionalContexts', 500, 400, 4)
dumpAsciiHits('247', 'addctx-e', 'content:e.additionalContexts', 500, 400, 4)
dumpAsciiHits('246', 'addctx-e', 'content:e.additionalContexts', 500, 400, 4)

console.log('\n=== lre / stdout spill ===')
const spillNeedles = [
  ',"stdout",{storageV5',
  ",'stdout',{storageV5",
  'stdout.trim(),',
  'function lre(',
  'await lre(',
  'lre(he.stdout',
  'storageV5:b})',
  'storageV5:',
]

for (const n of spillNeedles) {
  const a = count(bufs[246], n)
  const b = count(bufs[247], n)
  if (a || b) console.log(`${a}\t${b}\t${JSON.stringify(n)}${a !== b ? ' DIFF' : ''}`)
}

dumpBothAscii('stdout-storagev5', ',"stdout",{storageV5', 2500, 1500)
dumpAsciiHits('247', 'lre-call', 'await lre(', 800, 800, 6)
dumpAsciiHits('246', 'stdout-storagev5', ',"stdout",{storageV5', 800, 1200, 4)
dumpAsciiHits('247', 'stdout-storagev5', ',"stdout",{storageV5', 800, 1200, 4)

console.log('\n=== Rne vs lre BODY ===')
const rneNeedles = [
  'function Rne(',
  'await Rne(',
  'Rne(ye.stdout',
  ',"additionalContext",{storageV5',
  ',"systemMessage",{storageV5',
  ',"stdout",{storageV5',
  ',"stderr",{storageV5',
]

for (const n of rneNeedles) {
  const a = count(bufs[246], n)
  const b = count(bufs[247], n)
  if (a || b) console.log(`${a}\t${b}\t${JSON.stringify(n)}${a !== b ? ' DIFF' : ''}`)
}

dumpBothAscii('addctx-spill', ',"additionalContext",{storageV5', 1500, 800)
dumpBothAscii('sysmsg-spill', ',"systemMessage",{storageV5', 1500, 800)
dumpAsciiHits('247', 'fn-lre', 'function lre(', 80, 2500, 4)
dumpAsciiHits('246', 'fn-Rne', 'function Rne(', 80, 2500, 4)
dumpAsciiHits('246', 'await-Rne', 'await Rne(', 200, 400, 8)

console.log('\n=== THRESHOLD + STDERR WRAP ===')
const thrNeedles = [
  'var JWr=',
  'JWr=',
  'var BBr=',
  'BBr=',
  'tengu_hook_output_persisted',
  'persist-to-disk failed',
  'truncated at ${',
  'Hook ${n} truncated',
  'lre(he.stderr',
  'Rne(ye.stderr',
  'lre(ne.blockingError',
  'blockingError:await lre',
  'blockingError:await Rne',
]

for (const n of thrNeedles) {
  const a = count(bufs[246], n)
  const b = count(bufs[247], n)
  if (a || b) console.log(`${a}\t${b}\t${JSON.stringify(n)}${a !== b ? ' DIFF' : ''}`)
}

dumpBothAscii('JWr-assign', 'var JWr=', 200, 200)
dumpBothAscii('BBr-assign', 'var BBr=', 200, 200)
dumpBothAscii('trunc-hook-msg', 'Hook ${n} truncated', 400, 400)
dumpAsciiHits('247', 'JWr', 'JWr=', 80, 200, 6)
dumpAsciiHits('246', 'BBr', 'BBr=', 80, 200, 6)

console.log('\n=== JWr / BBr / persist ===')
for (const n of ['JWr', 'BBr', 'threshold:r=', 'hook-${t}-${n}', 'persist-to-disk failed', 'tengu_hook_output_persisted']) {
  console.log(count(bufs[246], n), count(bufs[247], n), JSON.stringify(n))
}

function dumpAllIdent(ver, ident, maxHits = 8) {
  const hits = allHits(bufs[ver], ident)
  let dumped = 0
  for (let i = 0; i < hits.length && dumped < maxHits; i++) {
    const off = hits[i]
    const s = asciiWindow(bufs[ver], Math.max(0, off - 60), off + 80)
    if (asciiRatio(s) < 0.85) continue
    writeFileSync(
      `${outDir}/gold-8-ident-${ident}-h${i}-${ver}.txt`,
      `# offset=${off} ver=${ver} hit=${i + 1}/${hits.length}\n\n${s}\n`,
    )
    console.log('ident', ver, ident, i, off, JSON.stringify(s.replace(/\s+/g, ' ').slice(0, 160)))
    dumped++
  }
}

dumpAllIdent('247', 'JWr')
dumpAllIdent('246', 'BBr')
dumpAsciiHits('247', 'lre-call-h4', 'await lre(', 200, 500, 6)
dumpBothAscii('persist-fail', 'persist-to-disk failed', 200, 300)

console.log('\n=== EXTRA threshold:r= + export values ===')
dumpAsciiHits('247', 'threshold-r', 'threshold:r=', 200, 800, 4)
dumpAsciiHits('246', 'threshold-r', 'threshold:r=', 200, 800, 4)
dumpAllIdent('247', 'Yvb=')
dumpAllIdent('246', 'lHb=')
dumpAsciiHits('247', 'Yvb-assign', 'Yvb=', 80, 200, 8)
dumpAsciiHits('246', 'lHb-assign', 'lHb=', 80, 200, 8)

console.log('\n=== MODULE INIT AFTER lre / Rne ===')
{
  const off247 = bufs[247].indexOf(Buffer.from('async function lre(e,t,n,{threshold:r=JWr'))
  const off246 = bufs[246].indexOf(Buffer.from('async function Rne(e,t,n,{threshold:r=BBr'))
  writeFileSync(
    `${outDir}/gold-8-lre-complete-247.txt`,
    `# offset=${off247}\n\n${asciiWindow(bufs[247], off247, off247 + 3500)}\n`,
  )
  writeFileSync(
    `${outDir}/gold-8-Rne-complete-246.txt`,
    `# offset=${off246}\n\n${asciiWindow(bufs[246], off246, off246 + 3500)}\n`,
  )
  console.log('complete dumps', off247, off246)
}

const afterNeedles = [
  ',JWr=',
  'JWr=we',
  'JWr=1',
  'JWr=2',
  'JWr=5',
  ',BBr=',
  'BBr=we',
  'BBr=1',
  'BBr=2',
  'HOOK_OUTPUT_THRESHOLD',
  'hookOutputThreshold',
  'persistThreshold',
]
for (const n of afterNeedles) {
  const a = count(bufs[246], n)
  const b = count(bufs[247], n)
  if (a || b) console.log(`${a}\t${b}\t${JSON.stringify(n)}${a !== b ? ' DIFF' : ''}`)
}

dumpAsciiHits('247', 'import-as-JWr', 'Yvb as JWr', 200, 400, 2)
dumpAsciiHits('246', 'import-as-BBr', 'lHb as BBr', 200, 400, 2)

console.log('\nDONE10')
