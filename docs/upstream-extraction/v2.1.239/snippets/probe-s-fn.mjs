import { readFileSync } from 'node:fs'

const exe = process.env.TEMP + '\\official-239\\package\\claude.exe'
const buf = readFileSync(exe)
const scrub = s => s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '.')
const k = 313689800
console.log(scrub(buf.subarray(k - 2500, k + 200).toString('latin1')))
console.log('\n==== call start around 313684000 ====')
const k2 = buf.indexOf(Buffer.from('if(S.scheme==="uds")'))
console.log('first uds scheme', k2)
if (k2 !== -1) {
  console.log(scrub(buf.subarray(k2 - 1800, k2 + 100).toString('latin1')))
}
