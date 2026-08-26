import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)
function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

const needles = [
  // #14 form scroll
  'more above',
  'more below',
  'LINES_PER_FIELD',
  'DIALOG_OVERHEAD',
  'maxVisibleFields',
  'scrollWindow',
  ' Accept  ',
  // #15 5xx mcp
  'type==="failed"',
  'type==="failed"',
  'c.type==="failed"',
  '5xx',
  'status>=500',
  'hasFailed',
  'stuck in a failed',
  // #46 AU truncatePathMiddle
  'function AU(',
  'truncatePathMiddle:()=>AU',
  // #29 agent vim
  'vimMode==="INSERT"',
  'vimMode==="NORMAL"',
  'setVimMode("NORMAL")',
  // #34 / #35
  'MODAL_TRANSCRIPT',
  'flexShrink:0',
  'WorkflowDetail',
  'local_workflow',
  // tool row
  'getDisplayPath',
  'FilePathLink',
]

const chunks = []
for (const n of needles) {
  const hits = []
  let from = 0
  const needle = Buffer.from(n)
  while (hits.length < 5) {
    const i = buf.indexOf(needle, from)
    if (i < 0) break
    hits.push(i)
    from = i + needle.length
  }
  chunks.push(`#### ${JSON.stringify(n)} ${hits.length} [${hits.join(', ')}]`)
  for (const i of hits) {
    chunks.push(`\n==== ${n} ${i} ====`)
    chunks.push(
      printable(buf.slice(Math.max(0, i - 200), i + 1200).toString('utf8')),
    )
  }
  chunks.push('')
}

writeFileSync(
  new URL('./gold-continue17.txt', import.meta.url),
  chunks.join('\n'),
)
console.log('ok', chunks.length)
