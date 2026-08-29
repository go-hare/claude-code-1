import { readFileSync, writeFileSync } from 'fs'
const text = readFileSync(`${process.env.TEMP}/official-239/package/claude.exe`).toString('latin1')

const foo = text.indexOf('async function foo(e,t)')
console.log(text.slice(foo, foo + 2500).replace(/[^\x20-\x7e]/g, '.'))
writeFileSync(
  'docs/upstream-extraction/v2.1.236/snippets/gold-foo-Fwl.txt',
  text.slice(foo, foo + 3500).replace(/[^\x20-\x7e\n]/g, '.'),
)

// how build is called - look for .build(
let i = text.indexOf('Fwl(r.tool)')
if (i < 0) i = text.indexOf('Fwl(n.tool)')
if (i < 0) i = text.indexOf('Fwl(')
console.log('\nFwl call', i)
console.log(text.slice(i, i + 800).replace(/[^\x20-\x7e]/g, '.'))

// search build:Lno usage pattern in foo
const j = text.indexOf('buildDescriptor')
// find all within foo+doo region
const region = text.slice(foo, foo + 15000)
for (const pat of ['buildDescriptor', '.build(', 'dialog:', 'await ', 'Lno']) {
  console.log(pat, (region.match(new RegExp(pat.replace(/[.*]/g,'\\$&'), 'g')) || []).length)
}
