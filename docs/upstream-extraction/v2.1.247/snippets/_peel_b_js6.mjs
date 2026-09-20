import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const buf246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
)

function asciiWindow(source, start, end) {
  let s = ''
  for (let j = start; j < end && j < source.length; j++) {
    const c = source[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

function dump(tag, needle, before, after, which = 0, source = buf) {
  const n = Buffer.from(needle)
  let from = 0
  let hit = 0
  let i = -1
  while (true) {
    const j = source.indexOf(n, from)
    if (j < 0) break
    if (hit === which) {
      i = j
      break
    }
    hit++
    from = j + n.length
  }
  if (i < 0) {
    console.log('MISS', tag, JSON.stringify(needle))
    return
  }
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/gold-js6-${tag}.txt`,
    `# offset=${i} needle=${JSON.stringify(needle)}\n\n${asciiWindow(source, Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', tag, i)
}

function count(source, needle, cap = 40) {
  const n = Buffer.from(needle)
  let c = 0
  let i = 0
  while (c < cap) {
    const j = source.indexOf(n, i)
    if (j < 0) break
    c++
    i = j + n.length
  }
  return c
}

const needles = [
  'async function _me(',
  'function _me(',
  '_me=async',
  'this._snapshot.mainThreadAgentDefinition',
  'forkContextMessages:n,mainThreadAgentDefinition',
  'mainThreadAgentDefinition:this',
  'EMFILE',
  'Task output drain failed',
  'var mN=',
  'mN=new Set',
  '["EMFILE"',
  'fallbackModel:s.options.fallbackModel',
  'options.fallbackModel',
  'function lK(e){return e.isApiError',
  'lK=e=>',
  'lK=function',
  'isPromptTooLongMessage',
  'AgentApiErrorTerminationError',
  'Agent terminated early due to an API error',
  'arrow+Enter',
  'same-tick',
  'pendingFocus',
  'focusValueRef',
  'onSubmit(items[',
  'items[focusedIndex]',
  '[exited with code',
  'exited with code ${',
  'code:-1',
  'code: -1',
  'exitCode:-1',
]

console.log('=== 247/246 ===')
for (const n of needles) {
  console.log(`${count(buf, n)}\t${count(buf246, n)}\t${n}`)
}

dump('me-fn', 'async function _me(', 100, 1500)
dump('me-fn2', 'function _me(', 100, 1500)
dump('snapshot-agent', 'this._snapshot.mainThreadAgentDefinition', 200, 400)
dump('emfile0', 'EMFILE', 300, 300, 0)
dump('emfile1', 'EMFILE', 300, 300, 1)
dump('drain-fail', 'Task output drain failed', 200, 200)
dump('var-mN', 'var mN=', 200, 800)
dump('fb-opt', 'fallbackModel:s.options.fallbackModel', 800, 400)
dump('lK-arrow', 'lK=e=>', 80, 400)
dump('term', 'Agent terminated early due to an API error', 200, 400)
dump('items-focus0', 'items[focusedIndex]', 400, 400, 0)
dump('items-focus1', 'items[focusedIndex]', 400, 400, 1)
dump('exited-tpl', 'exited with code ${', 300, 400)
dump('code-m1', 'code:-1', 300, 400)
