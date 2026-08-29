import { readFileSync, writeFileSync } from 'fs'
const text = readFileSync(`${process.env.TEMP}/official-239/package/claude.exe`).toString('latin1')
const i = text.indexOf('function Ium(')
console.log(text.slice(i, i + 600).replace(/[^\x20-\x7e]/g, '.'))
const j = text.indexOf('function Ono(')
console.log('\nOno', text.slice(j, j + 400).replace(/[^\x20-\x7e]/g, '.'))
const k = text.indexOf('function Mno(')
console.log('\nMno', text.slice(k, k + 400).replace(/[^\x20-\x7e]/g, '.'))
// E4t already 200000
writeFileSync(
  'docs/upstream-extraction/v2.1.236/snippets/gold-foo-Fwl.txt',
  text.slice(text.indexOf('async function foo(e,t)'), text.indexOf('async function foo(e,t)') + 4000).replace(/[^\x20-\x7e\n]/g, '.'),
)
