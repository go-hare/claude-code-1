import { readFileSync, writeFileSync } from 'fs'
const SEA = 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const OUT = 'D:/work/py/claude/claude-code/docs/upstream-extraction/v2.1.247/snippets'
const data = readFileSync(SEA, 'latin1')
const lines = []
function ascii(s) {
  return s.replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
}
function at(label, off, before, after) {
  lines.push(`### ${label} off=${off}`)
  lines.push(ascii(data.slice(Math.max(0, off - before), Math.min(data.length, off + after))))
  lines.push('')
}
function dump(label, needle, before, after, from = 0) {
  const idx = data.indexOf(needle, from)
  lines.push(`### ${label} off=${idx}`)
  if (idx < 0) {
    lines.push('MISS')
    lines.push('')
    return idx
  }
  lines.push(ascii(data.slice(Math.max(0, idx - before), idx + after)))
  lines.push('')
  return idx
}

// ot starts 232017716 — helpers before it
at('ot-before-4k', 232017716, 4000, 80)
dump('zHs-load', 'zHs.load', 40, 200)
dump('KGt-load', 'KGt.load', 40, 200)
dump('HHs-load', 'HHs.load', 40, 200)
dump('feedback-load-assign', 'name:"feedback"', 20, 80, 230000000)
dump('T-jsx-messages', ',messages:', 80, 200, 237009200)
dump('create-T', 'T({', 40, 300, 237009200)
dump('call-T', 'return t(T', 40, 300, 237009200)
dump('call-i-T', 'return i(T', 40, 300, 237009200)
dump('h-onWriteNew', 'onWriteNew:h', 80, 200)
dump('onWriteNew-fn', 'onWriteNew(){', 80, 250)
dump('onWriteNew-arrow', 'onWriteNew:()=>', 80, 250)
dump('sCa=', 'sCa=function', 20, 300)
dump('var-sCa', 'var sCa=', 20, 200)
dump('function-sCa2', 'function $t(', 20, 300)

writeFileSync(`${OUT}/gold-1-ot-ye-247.txt`, lines.join('\n'), 'latin1')
console.log('done')
