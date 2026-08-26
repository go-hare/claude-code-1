import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)

function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

function dumpAt(label, i, before = 80, after = 900) {
  if (i < 0 || i == null) return `\n==== ${label} MISS ====\n`
  return (
    `\n==== ${label} ${i} ====\n` +
    printable(buf.slice(Math.max(0, i - before), i + after).toString('utf8')) +
    '\n'
  )
}

function findAll(needle, max = 6) {
  const hits = []
  let i = 0
  const n = Buffer.from(needle)
  while (hits.length < max) {
    i = buf.indexOf(n, i)
    if (i < 0) break
    hits.push(i)
    i += n.length
  }
  return hits
}

let out = ''
for (const kw of [
  'var n9f=',
  'n9f=new Set',
  'Y8f=new Set',
  'var Y8f=',
  'var t5n=',
  't5n=',
  'var xew=',
  'xew=',
  'service_spend_limit_reached',
  'voiceEnabled:!0',
  'voice:{...r.voice,enabled:!0',
  'enabled:!0',
  'BedrockUnexpectedContentType',
  'voice:{...r.voice,enabled:!0}',
  'voiceEnabled:!0,voice:',
]) {
  const hits = findAll(kw)
  out += `\n#### ${JSON.stringify(kw)} ${hits.length} [${hits.join(',')}] \n`
  if (hits[0] !== undefined) out += dumpAt(kw, hits[0], 60, 700)
}

out += dumpAt('voice enable write', 316295900, 0, 1800)

writeFileSync(new URL('./gold-rew-sets.txt', import.meta.url), out)
console.log('ok')
