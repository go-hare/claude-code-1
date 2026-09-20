import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const buf246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
)

function asciiWindow(source, start, end) {
  let s = ''
  for (let j = start; j < end && j < source.length; j++) {
    const c = source[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

function dump(tag, needle, before, after, which = 0, source = buf) {
  const n = Buffer.from(needle)
  let from = 0
  let hit = 0
  let i = -1
  while (true) {
    const j = source.indexOf(n, from)
    if (j < 0) break
    if (hit === which) {
      i = j
      break
    }
    hit++
    from = j + n.length
  }
  if (i < 0) {
    console.log('MISS', tag, JSON.stringify(needle))
    return
  }
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/gold-js5-${tag}.txt`,
    `# offset=${i} needle=${JSON.stringify(needle)}\n\n${asciiWindow(source, Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', tag, i)
}

function count(source, needle, cap = 30) {
  const n = Buffer.from(needle)
  let c = 0
  let i = 0
  while (c < cap) {
    const j = source.indexOf(n, i)
    if (j < 0) break
    c++
    i = j + n.length
  }
  return c
}

const pairs = [
  'function tss(',
  'class l2e',
  'tss(Se',
  'could not all be saved',
  'mN=new Set',
  'mN=new',
  ',mN=',
  'var mN=',
  'handleSummarize=',
  'e.agent?e.agentDefinitions',
  'getFocusedValue',
  'selectedIndexRef',
  'focusedIndexRef',
  'MAX_HOOK_OUTPUT',
  'Prompt is too long',
  'megabyte',
  '[exited with code -1]',
  'exited with code',
  'carried over',
  'unwrittenChars',
  'function lK(',
]

console.log('=== counts 247/246 ===')
for (const n of pairs) {
  console.log(`${count(buf, n)}\t${count(buf246, n)}\t${n}`)
}

dump('tss', 'function tss(', 80, 900)
dump('l2e', 'class l2e', 80, 600)
dump('saved', 'could not all be saved', 400, 400)
dump('mN1', ',mN=', 200, 400)
dump('mN2', 'mN=new Set', 200, 400)
dump('summarize', 'handleSummarize=', 200, 2500)
dump('agent-lookup0', 'e.agent?e.agentDefinitions', 200, 600, 0)
dump('agent-lookup1', 'e.agent?e.agentDefinitions', 200, 600, 1)
dump('lK0', 'function lK(', 80, 400, 0)
dump('lK1', 'function lK(', 80, 400, 1)
dump('lK2', 'function lK(', 80, 400, 2)
dump('compact-ie-back', 'mainThreadAgentDefinition:void 0', 4000, 200)
dump('focus', 'getFocusedValue', 200, 800)
dump('idx-ref', 'selectedIndexRef', 200, 800)
dump('hook-max', 'MAX_HOOK_OUTPUT', 200, 400)
dump('exited', 'exited with code', 200, 600)
