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

function first(buf, needle) {
  return buf.indexOf(Buffer.from(needle))
}

function dump(ver, tag, needle, before, after) {
  const buf = bufs[ver]
  const i = first(buf, needle)
  if (i < 0) {
    console.log('MISS', ver, tag, JSON.stringify(needle))
    return
  }
  const s = asciiWindow(buf, Math.max(0, i - before), i + after)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/gold-b-${tag}-${ver}.txt`,
    `# offset=${i} ver=${ver} needle=${JSON.stringify(needle)}\n\n${s}\n`,
  )
  console.log('OK', ver, tag, i, 'len', s.length)
}

const jobs = [
  ['fuzzy', 'backspaceExitsOnEmpty', 800, 4000],
  ['model-sent', 'model sent to the API', 5000, 3000],
  ['lost-saved', 'could not all be saved', 5000, 3000],
  ['lostOutput', 'lostOutput', 4000, 3000],
  ['compact-agent', 'Summarize from here', 4000, 3000],
  ['hook-trunc', 'output truncated - exceeded', 2000, 2000],
  ['detached', 'process exited while detached', 2500, 2000],
  ['apiErrorStatus', 'apiErrorStatus!==void 0', 2500, 2500],
  ['search-prompts', 'Search prompts', 1500, 3500],
  ['invoke-skill', 'invoke skill', 1500, 3500],
  ['filter-history', 'Filter history', 1500, 2500],
  ['bg-viewing-agent', 'Viewing agent', 2000, 2500],
  ['mcp-dismissed', 'MCP dialog dismissed', 2000, 2500],
  ['config-toggle', 'config_toggle', 2000, 2500],
  ['fallback-model', 'fallbackModel', 500, 500],
]

for (const [tag, needle, before, after] of jobs) {
  dump('246', tag, needle, before, after)
  dump('247', tag, needle, before, after)
}
