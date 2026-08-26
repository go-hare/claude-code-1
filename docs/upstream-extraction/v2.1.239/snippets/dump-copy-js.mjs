import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)

function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

function allAscii(kw, max = 8) {
  const b = Buffer.from(kw)
  const hits = []
  let i = -1
  while ((i = buf.indexOf(b, i + 1)) !== -1 && hits.length < max) {
    hits.push(i)
  }
  return hits
}

const keys = [
  'until your limit resets at ',
  'until your limit resets',
  'Your weekly limit still applies',
  'Please restart Claude from an existing directory',
  'Working directory "',
]

let out = ''
for (const kw of keys) {
  const hits = allAscii(kw)
  out += `\n## ${JSON.stringify(kw)} hits=${hits.join(',')}\n`
  for (const i of hits) {
    const slice = printable(buf.slice(Math.max(0, i - 120), i + 280).toString('utf8'))
    const jsish = /return"|function |if\(|=>/.test(slice)
    out += `\n--- @${i} jsish=${jsish} ---\n${slice}\n`
  }
}

writeFileSync(new URL('./gold-copy-js.txt', import.meta.url), out)
console.log('wrote', out.length)
