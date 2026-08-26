import { readFileSync, writeFileSync } from 'node:fs'

const exe =
  'C:\\Users\\Administrator\\AppData\\Local\\Temp\\official-239\\package\\claude.exe'
const buf = readFileSync(exe)
const scrub = (s) => s.replace(/[^\x09\x0a\x20-\x7e]/g, '.')

// Code site (not the string table): the withhold gate sits a few hundred bytes
// before the streaming-end marker inside the query generator.
const needle = Buffer.from('Z_("query_api_streaming_end")')
let out = ''
let i = 0
for (;;) {
  const k = buf.indexOf(needle, i)
  if (k === -1) break
  out += `--- offset=${k}\n`
  out += scrub(buf.subarray(k - 2600, k + 120).toString('latin1')) + '\n\n'
  i = k + 1
}
if (!out) {
  // fall back: any occurrence of the marker with a wide back window
  const alt = Buffer.from('query_api_streaming_end')
  let j = 0
  for (;;) {
    const k = buf.indexOf(alt, j)
    if (k === -1) break
    const w = scrub(buf.subarray(k - 2600, k + 120).toString('latin1'))
    if (w.includes('yield')) out += `--- alt offset=${k}\n${w}\n\n`
    j = k + 1
  }
}
writeFileSync(new URL('./gold-mediabuf-239.txt', import.meta.url), out || 'none')
console.log(out.slice(0, 9000) || 'none')
