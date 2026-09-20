import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function rawAscii(start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : `\\x${c.toString(16).padStart(2, '0')}`
  }
  return s
}

const call = 214521233
console.log('RAW call context:\n', rawAscii(call - 20, call + 50))

// search XX= in 2MB before call
const region = rawAscii(call - 2_000_000, call)
const assigns = []
for (const m of region.matchAll(/XX\s*=/g)) {
  assigns.push(region.slice(m.index, m.index + 80))
  if (assigns.length >= 10) break
}
console.log('XX= count', assigns.length, assigns)

const asHits = [...region.matchAll(/as XX/g)].slice(0, 10)
console.log(
  'as XX',
  asHits.map((m) => region.slice(Math.max(0, m.index - 40), m.index + 20)),
)

const pluginHits = [...region.matchAll(/pluginRegistry/g)].slice(0, 8)
console.log(
  'pluginRegistry in 2MB',
  pluginHits.map((m) => region.slice(m.index, m.index + 60)),
)

writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-dig-XX-raw-assign.txt',
  assigns.join('\n---\n'),
)
