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
  const s = asciiWindow(buf, Math.max(0, i - before), i + after)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/gold-js-${tag}-${ver}.txt`,
    `# offset=${i} ver=${ver} needle=${JSON.stringify(needle)}\n\n${s}\n`,
  )
  console.log('OK', ver, tag, i, 'len', s.length)
}

const jobs = [
  ['write-fail', 'Task output still cannot be written', 6000, 4000],
  ['unwritten', 'unwrittenChars', 4000, 4000],
  ['drain-retry', 'Task output drain retry failed', 4000, 4000],
  ['tss-call', 'function tss(', 500, 2500],
  ['kor', 'function kor(', 200, 2000],
  ['model-swapped', 'model_swapped', 2000, 3000],
  ['first-404', 'status===404', 2000, 2500],
  ['fuzzy-js', 'backspaceExitsOnEmpty:!1', 2000, 4000],
  ['fuzzy-return', 'e.key==="return"', 1500, 2500],
  ['compact-sys', 'buildEffectiveSystemPrompt', 2000, 2500],
  ['main-agent-undef', 'mainThreadAgentDefinition:void 0', 1500, 2000],
  ['main-agent-def', 'mainThreadAgentDefinition:', 1500, 2000],
  ['hook-mb', 'MAX_HOOK_OUTPUT_LENGTH', 1500, 2000],
  ['apply-trunc', 'output truncated', 1500, 2000],
  ['exited-bg', '[exited with code', 2000, 2000],
  ['code-m1', 'code:-1', 1500, 2000],
  ['internal-err-log', 'internal error', 800, 800],
]

for (const [tag, needle, before, after] of jobs) {
  dump('246', tag, needle, before, after)
  dump('247', tag, needle, before, after)
}
