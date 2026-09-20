import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const sea = process.env.OFFICIAL_247 ||
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const buf = readFileSync(sea)
const outDir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

function idx(s, from = 0) {
  return buf.indexOf(Buffer.from(s, 'ascii'), from)
}

function asciiWindow(pos, before, after, name) {
  const start = Math.max(0, pos - before)
  const end = Math.min(buf.length, pos + after)
  const raw = buf.subarray(start, end)
  let s = ''
  for (const b of raw) s += b >= 32 && b < 127 ? String.fromCharCode(b) : (b === 10 ? '\n' : (b === 13 ? '\r' : '.'))
  writeFileSync(join(outDir, name), `# pos=${pos}\n${s}\n`)
}

asciiWindow(208903809, 800, 400, 'gold-22-wsc-export.txt')

// find more as wsc
let p = 0
let k = 0
while (k < 6) {
  const i = idx(' as wsc', p)
  if (i < 0) break
  console.log('as wsc', i)
  asciiWindow(i, 400, 200, `gold-22-as-wsc-${k}.txt`)
  k++
  p = i + 6
}

p = 0
k = 0
while (k < 6) {
  const i = idx(' as xsc', p)
  if (i < 0) break
  console.log('as xsc', i)
  asciiWindow(i, 400, 200, `gold-22-as-xsc-${k}.txt`)
  k++
  p = i + 6
}

// also search Q$ and custom oauth patterns near force login
const extra = [
  'forceLoginMethod==="gateway"',
  'forceLoginGatewayUrl',
  'CLAUDE_CODE_CUSTOM_OAUTH_URL',
  'CUSTOM_OAUTH_URL',
  'isCustomOAuth',
  'skipPreflight',
]
for (const n of extra) {
  const hits = []
  p = 0
  while (hits.length < 5) {
    const i = idx(n, p)
    if (i < 0) break
    hits.push(i)
    p = i + n.length
  }
  console.log(hits.length, JSON.stringify(n), hits)
}
