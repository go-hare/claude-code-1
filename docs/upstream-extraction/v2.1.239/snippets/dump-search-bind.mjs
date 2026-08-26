import { readFileSync, writeFileSync } from 'node:fs'

const s = readFileSync(new URL('./gold-around-_readline_-1.txt', import.meta.url), 'utf8')
const keys = [
  'if(j.key==="backspace")',
  'if(j.name==="backspace")',
  'j.key==="backspace"',
  'case"backspace"',
  'ie()',
  'ne()',
  'backwardKillWord',
  'deleteWORDBefore',
]
for (const k of keys) {
  const i = s.indexOf(k)
  console.log(k, i)
}

const i = s.indexOf('if(j.ctrl)')
writeFileSync(
  new URL('./gold-search-bind.txt', import.meta.url),
  [
    '==== backspace ====\n' + s.slice(s.indexOf('j.key==="backspace"'), s.indexOf('j.key==="backspace"') + 900),
    '==== ctrl ====\n' + s.slice(i, i + 2500),
  ].join('\n\n'),
)
console.log('wrote')
