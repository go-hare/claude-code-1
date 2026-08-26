import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)

function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

function dumpAt(label, i, before = 150, after = 1000) {
  if (i < 0) return `\n==== ${label} MISS ====\n`
  return (
    `\n==== ${label} ${i} ====\n` +
    printable(buf.slice(Math.max(0, i - before), i + after).toString('utf8')) +
    '\n'
  )
}

function findAll(needle, max = 8) {
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
  'DISABLE_BEDROCK_CONTENT_TYPE_GUARD',
  'new i9p(',
  'BedrockUnexpectedContentTypeError',
  'expected "application/vnd.amazon.eventstream"',
  'content-type is not application/vnd.amazon.eventstream',
]) {
  const hits = findAll(kw)
  out += `\n#### ${JSON.stringify(kw)} ${hits.length} [${hits.join(',')}] \n`
  for (const h of hits.slice(0, 3)) out += dumpAt(kw, h, 200, 900)
}

writeFileSync(new URL('./gold-bedrock-guard.txt', import.meta.url), out)
console.log('ok')
