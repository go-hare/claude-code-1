import { readFileSync, writeFileSync } from 'fs'

const bufs = {
  246: readFileSync(
    'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
  ),
  247: readFileSync(
    'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
  ),
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

function allHits(buf, needle) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (from < buf.length) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
    if (hits.length > 20) break
  }
  return hits
}

function dumpHit(ver, tag, needle, before, after, which = 0) {
  const buf = bufs[ver]
  const hits = allHits(buf, needle)
  if (hits.length === 0) {
    console.log('MISS', ver, tag, JSON.stringify(needle))
    return
  }
  const i = hits[which] ?? hits[0]
  const s = asciiWindow(buf, Math.max(0, i - before), i + after)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/gold-js2-${tag}-${ver}.txt`,
    `# offset=${i} ver=${ver} hit=${which + 1}/${hits.length} needle=${JSON.stringify(needle)}\n\n${s}\n`,
  )
  console.log('OK', ver, tag, `${which + 1}/${hits.length}`, i)
}

console.log('=== counts ===')
const needles = [
  'mainThreadAgentDefinition:void 0',
  'defaultSystemPrompt:r,appendSystemPrompt',
  'tss(',
  'Task output still cannot be written (${',
  'dropped ${',
  'unwrittenChars+=',
  'this.unwrittenChars',
  'this.lostOutput',
  'this.failing',
  'direction==="up"',
  'items[focusedIndex]',
  'fallbackModel:',
  'Reached max turns limit',
  'getDefaultMainLoopModel',
  '[exited with code',
  'exited with code ${',
  'code:-1',
  'applyTruncation',
  'MAX_HOOK',
]

for (const n of needles) {
  const a = allHits(bufs[246], n).length
  const b = allHits(bufs[247], n).length
  if (a || b) console.log(`${a}->${b}\t${JSON.stringify(n)}`)
}

dumpHit('247', 'ge-compact', 'defaultSystemPrompt:r,appendSystemPrompt', 800, 1500)
dumpHit('246', 'ge-compact', 'defaultSystemPrompt:r,appendSystemPrompt', 800, 1500)
dumpHit('247', 'void0-0', 'mainThreadAgentDefinition:void 0', 400, 800, 0)
dumpHit('247', 'void0-1', 'mainThreadAgentDefinition:void 0', 400, 800, 1)
dumpHit('247', 'void0-2', 'mainThreadAgentDefinition:void 0', 400, 800, 2)
dumpHit('247', 'tss-uses', 'tss(', 2000, 2000, 1)
dumpHit('247', 'write-tpl', 'Task output still cannot be written (${', 4000, 3000)
dumpHit('247', 'dropped-tpl', 'dropped ${', 2000, 1500)
dumpHit('247', 'fuzzy-dir', 'direction==="up"', 2000, 3000)
dumpHit('246', 'fuzzy-dir', 'direction==="up"', 2000, 3000)
dumpHit('247', 'max-turns', 'Reached max turns limit', 2500, 2500)
dumpHit('246', 'max-turns', 'Reached max turns limit', 2500, 2500)
