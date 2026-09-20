import { existsSync, readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'

function ascii(start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

function allHits(needle) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (from < buf.length) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

function dump(name, needle, before, after, which = 0) {
  const hits = allHits(needle)
  if (!hits.length) {
    console.log('MISS', name, JSON.stringify(needle))
    return
  }
  const i = hits[which] ?? hits[0]
  writeFileSync(
    `${outDir}/${name}`,
    `# offset=${i} hit=${which + 1}/${hits.length} needle=${JSON.stringify(needle)}\n\n${ascii(Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', name, i, `${which + 1}/${hits.length}`)
}

function list(needle, limit = 12) {
  const hits = allHits(needle)
  console.log('HITS', JSON.stringify(needle), hits.length, hits.slice(0, limit))
}

list('osLinkedRootRealpaths')
list('gitignore_global_rule')
list('stagingDirGitignoreFired')
list('ensureAtomicWriteStagingDirs')
list('Staging dir ')
list('if(Vm(')
list('if(Ji(')
list('if(Qi(')
list('function Ie(){return')
list('Pe()!=="firstParty"')
list('c.advertisedCommand')
list('failedTipIds.add')
list('tip isRelevant threw')

dump('gold-11-osLinked.txt', 'osLinkedRootRealpaths', 200, 800)
dump('gold-11-gitignore-rule.txt', 'gitignore_global_rule', 200, 800)
dump('gold-11-staging-fired.txt', 'stagingDirGitignoreFired', 200, 400)
dump('gold-2-pe-firstparty.txt', 'Pe()!=="firstParty"', 200, 400)
dump('gold-2-isrelevant-threw.txt', 'tip isRelevant threw', 400, 200)
dump('gold-11-if-Vm.txt', 'if(Vm(', 80, 80)
dump('gold-11-if-Ji.txt', 'if(Ji(', 80, 80)
dump('gold-11-if-Qi.txt', 'if(Qi(', 80, 80)
