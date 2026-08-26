import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)
function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

const needles = [
  // #2 / #21 fullscreen offer
  'fullscreen offer',
  'tuiOffer',
  'cloud provider offer',
  'Bedrock, Vertex',
  'three launches',
  'launchCount',
  'fullscreenPrompt',
  'unable to answer',
  // #14 elicitation scroll
  'Accept/Decline',
  'Accept or Decline',
  'elicitation',
  'urlOverflows',
  // #15 setMcpServers 5xx
  'setMcpServers',
  'hasFailedSdkClients',
  'failed forever',
  'mcp_status',
  // #29 agent view vim
  'vimMode',
  'INSERT',
  'NORMAL',
  'agent view',
  // #33 focus click
  'gained focus',
  'window focus',
  'focus click',
  'click through',
  // #34 slash panel pin
  'MODAL_TRANSCRIPT_PEEK',
  'transcript peek',
  '/config',
  // #35 workflows overflow
  'workflows',
  'Workflow detail',
  'overflow',
  // #46 tool row path
  'truncatePathMiddle',
  'truncateToWidth',
  // #33 mouse
  'focus-in',
  'focus-out',
  // extras
  'hasFailedSdk',
  'handshake timeout',
]

const chunks = []
for (const n of needles) {
  const hits = []
  let from = 0
  const needle = Buffer.from(n)
  while (hits.length < 4) {
    const i = buf.indexOf(needle, from)
    if (i < 0) break
    hits.push(i)
    from = i + needle.length
  }
  chunks.push(`#### ${JSON.stringify(n)} ${hits.length} [${hits.join(', ')}]`)
  for (const i of hits) {
    chunks.push(`\n==== ${n} ${i} ====`)
    chunks.push(
      printable(buf.slice(Math.max(0, i - 160), i + 1000).toString('utf8')),
    )
  }
  chunks.push('')
}

writeFileSync(
  new URL('./gold-continue16.txt', import.meta.url),
  chunks.join('\n'),
)
console.log('ok', chunks.length)
