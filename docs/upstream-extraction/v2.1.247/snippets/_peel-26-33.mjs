import { readFileSync, writeFileSync, existsSync } from 'fs'

const p247 = 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const p246 = 'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe'
const buf247 = readFileSync(p247)
const buf246 = existsSync(p246) ? readFileSync(p246) : null

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

function count(buf, needle) {
  const n = Buffer.from(needle)
  let i = 0
  let c = 0
  while (true) {
    const j = buf.indexOf(n, i)
    if (j < 0) break
    c++
    i = j + n.length
    if (c > 50) break
  }
  return c
}

function first(buf, needle) {
  return buf.indexOf(Buffer.from(needle))
}

function dump(name, needle, before, after) {
  const i = first(buf247, needle)
  if (i < 0) {
    console.log('MISS', name, JSON.stringify(needle))
    return
  }
  const start = Math.max(0, i - before)
  const s = asciiWindow(buf247, start, i + after)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i} needle=${JSON.stringify(needle)} count247=${count(buf247, needle)} count246=${buf246 ? count(buf246, needle) : 'NA'}\n\n${s}\n`,
  )
  console.log('OK', name, i, 'len', s.length)
}

const needles = [
  '967000',
  '934000',
  '967K',
  '934K',
  '967,000',
  '934,000',
  'Message from @',
  'Message from @:',
  'failed to connect',
  'MCP server failed',
  'configured MCP',
  "don't exist",
  'tools don',
  'telemetry disabled',
  'isTelemetryDisabled',
  'auto-compact',
  'autocompact',
  'autoCompact',
  'AUTOCOMPACT',
  'PR badge',
  'pr badge',
  'github re-check',
  'last check',
  'under a minute',
  'refocus',
  'forceGateway',
  'custom OAuth',
  'analytics',
  'managed settings cannot',
  'cannot be read',
  'organization sign-in',
  'org sign-in',
  'host-supplied',
  'HKCU',
  'unreadable',
]

console.log('=== counts 247 vs 246 ===')
for (const n of needles) {
  const c247 = count(buf247, n)
  const c246 = buf246 ? count(buf246, n) : 'NA'
  if (c247 > 0 || (typeof c246 === 'number' && c246 > 0)) {
    console.log(JSON.stringify(n), '247=', c247, '246=', c246)
  }
}
