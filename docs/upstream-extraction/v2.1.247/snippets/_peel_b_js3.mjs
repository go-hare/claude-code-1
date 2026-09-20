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

function dump(ver, tag, needle, before, after) {
  const buf = bufs[ver]
  const i = buf.indexOf(Buffer.from(needle))
  if (i < 0) {
    console.log('MISS', ver, tag, JSON.stringify(needle))
    return
  }
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/gold-js3-${tag}-${ver}.txt`,
    `# offset=${i} ver=${ver} needle=${JSON.stringify(needle)}\n\n${asciiWindow(buf, Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', ver, tag, i)
}

function count(ver, needle) {
  const buf = bufs[ver]
  const n = Buffer.from(needle)
  let c = 0
  let i = 0
  while (c < 30) {
    const j = buf.indexOf(n, i)
    if (j < 0) break
    c++
    i = j + n.length
  }
  return c
}

const extra = [
  'tengu_api_subagent_model_not_found',
  'output was lost to',
  'output lost at',
  'could not be written to this file',
  'unwritten output',
  'writer evicted while failing',
  'customSystemPrompt:t.options.customSystemPrompt',
  'options.agentDefinition',
  'options.fallbackModel',
  'apiErrorStatus:',
  'apiErrorStatus=',
  'focusedIndex.current',
  'getFocusedIndex',
  'liveIndex',
  'selectedIndexRef',
]

console.log('=== extra ===')
for (const n of extra) {
  console.log(`${count('246', n)}->${count('247', n)}\t${JSON.stringify(n)}`)
}

dump('247', 'evicted', 'writer evicted while failing', 1500, 800)
dump('247', 'unwritten-note', 'unwritten output', 2000, 1500)
dump('247', 'hlo', 'this.#s>hlo', 2000, 1500)
dump('247', 'RTe', 'this.#t.unshift(RTe)', 2500, 1500)
dump('247', 'compact-opt', 'customSystemPrompt:t.options.customSystemPrompt', 1500, 1500)
dump('246', 'compact-opt', 'customSystemPrompt:t.options.customSystemPrompt', 1500, 1500)
dump('247', 'subagent-404', 'tengu_api_subagent_model_not_found', 2000, 2000)
dump('247', 'fallback-opt', 'options.fallbackModel', 1500, 2000)
dump('247', 'api-status', 'apiErrorStatus:', 2000, 2000)
dump('247', 'lK', '&&!lK(', 1500, 1500)
