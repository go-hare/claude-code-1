import { readFileSync, writeFileSync, existsSync } from 'fs'

const paths = {
  247: 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
  246: 'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
}

const bufs = {}
for (const [k, p] of Object.entries(paths)) {
  if (!existsSync(p)) {
    console.log('MISSING', k, p)
    continue
  }
  bufs[k] = readFileSync(p)
  console.log('loaded', k, bufs[k].length)
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
    if (c > 50) return c
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
  return s.replace(/[.]{4,}/g, '...')
}

function dump(ver, name, needle, before, after) {
  const buf = bufs[ver]
  if (!buf) return
  const i = buf.indexOf(Buffer.from(needle))
  if (i < 0) {
    console.log('MISS', ver, name, needle)
    return
  }
  const start = Math.max(0, i - before)
  const s = asciiWindow(buf, start, i + after)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i} ver=${ver} needle=${JSON.stringify(needle)}\n\n${s}\n`,
  )
  console.log('OK', ver, name, i, 'len', s.length)
}

const needles = [
  'exited with code -1',
  '[exited with code -1]',
  'exited with code',
  'output was lost',
  'output lost',
  'could not be written',
  'Prompt is too long',
  'Summarize from here',
  'request id',
  'request_id',
  'error type',
  'error_type',
  'model 404',
  'not_found_error',
  'fallback model',
  'fallbackModel',
  'first-call',
  'first call',
  'row above',
  'selectedIndex',
  'pendingIndex',
  'committedIndex',
  'flushPending',
  'arrow-key',
  'history search',
  'agent system prompt',
  'default system prompt',
  'getAgentSystemPrompt',
  'compaction',
  'hook output',
  'background task',
  'write fail',
  'unbounded',
  'megabyte',
  'truncateHook',
  'hookTruncat',
  'MAX_HOOK',
  'lost output',
  'output discarded',
  'failed to write output',
  'Failed to write',
  'internal error',
  'Internal error',
  'carried over',
  'foreground',
  'exitCode=-1',
  'exit_code',
]

console.log('\n=== COUNTS ===')
for (const n of needles) {
  const a = bufs[246] ? count(bufs[246], n) : -1
  const b = bufs[247] ? count(bufs[247], n) : -1
  if (a !== b || b > 0) {
    console.log(`${JSON.stringify(n)}\t246=${a}\t247=${b}`)
  }
}
