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
    if (hits.length > 40) break
  }
  return hits
}

function dump(ver, tag, needle, before, after, which = 0) {
  const buf = bufs[ver]
  const hits = allHits(buf, needle)
  if (hits.length === 0) {
    console.log('MISS', ver, tag, JSON.stringify(needle))
    return
  }
  const i = hits[Math.min(which, hits.length - 1)]
  const s = asciiWindow(buf, Math.max(0, i - before), i + after)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/gold-6-${tag}-${ver}.txt`,
    `# offset=${i} ver=${ver} hit=${which + 1}/${hits.length} needle=${JSON.stringify(needle)}\n\n${s}\n`,
  )
  console.log('OK', ver, tag, `${which + 1}/${hits.length}`, i, 'len', s.length)
}

function dumpBoth(tag, needle, before, after, which = 0) {
  dump(246, tag, needle, before, after, which)
  dump(247, tag, needle, before, after, which)
}

console.log('=== counts 246 -> 247 ===')
const needles = [
  'getFocusedValue',
  'focusNextOption',
  'focusPreviousOption',
  'select:accept',
  'selectFocusedOption',
  'focusedIndexRef',
  'selectedIndexRef',
  'focusedIndex.current',
  'selectedIndex.current',
  'items[focusedIndex]',
  'Filter history',
  'Search prompts',
  'No matching prompts',
  'No history yet',
  'tengu_history_picker_select',
  'Type to filter skills',
  'invoke skill',
  'set skillOverrides',
  'Type to search',
  'backspaceExitsOnEmpty:!1',
  'direction==="up"?1:-1',
  'direction==="up"?-1:1',
  'Choose a model for this and future sessions',
  'Select model',
  'config_toggle',
  'MCP dialog dismissed',
  'Skills dialog dismissed',
  'Background dialog dismissed',
  'Viewing agent',
  'Viewing leader',
  'live-index',
  'liveIndex',
  'getFocusedIndex',
  'getSelectedIndex',
  'arrow+Enter',
  'same-tick',
  'pendingFocus',
  'focusValueRef',
  'PFm(',
]

for (const n of needles) {
  const a = allHits(bufs[246], n).length
  const b = allHits(bufs[247], n).length
  if (a || b) console.log(`${a}->${b}\t${JSON.stringify(n)}`)
}

dumpBoth('getFocusedValue', 'getFocusedValue', 400, 1200, 0)
dumpBoth('getFocusedValue-1', 'getFocusedValue', 400, 1200, 1)
dumpBoth('focusNext', 'focusNextOption', 300, 800, 0)
dumpBoth('select-accept', 'select:accept', 200, 900, 0)
dumpBoth('selectFocused', 'selectFocusedOption', 400, 800, 0)
dumpBoth('history-title', 'Search prompts', 1500, 2500)
dumpBoth('history-filter', 'Filter history', 1500, 2500)
dumpBoth('history-empty', 'No matching prompts', 800, 1500)
dumpBoth('history-event', 'tengu_history_picker_select', 1500, 2500)
dumpBoth('skills-filter', 'Type to filter skills', 1500, 2500)
dumpBoth('skills-invoke', 'invoke skill', 1500, 2500)
dumpBoth('fuzzy-step-up', 'direction==="up"?1:-1', 2000, 2500)
dumpBoth('fuzzy-step-down', 'direction==="up"?-1:1', 2000, 2500)
dumpBoth('items-focus', 'items[focusedIndex]', 800, 1200, 0)
dumpBoth('items-focus-1', 'items[focusedIndex]', 800, 1200, 1)
dumpBoth('model-choose', 'Choose a model for this and future sessions', 800, 1500)
dumpBoth('config-toggle', 'config_toggle', 1500, 2000)
dumpBoth('mcp-dismiss', 'MCP dialog dismissed', 1500, 2500)
dumpBoth('bg-dismiss', 'Background dialog dismissed', 1500, 2500)
dumpBoth('bg-agent', 'Viewing agent', 1500, 2500)
dumpBoth('type-search', 'Type to search', 800, 1500)
