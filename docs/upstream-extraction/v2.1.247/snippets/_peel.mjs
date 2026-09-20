import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function asciiWindow(start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

function dump(name, needle, before, after) {
  const i = buf.indexOf(Buffer.from(needle))
  if (i < 0) {
    console.log('MISS', name, needle)
    return
  }
  const start = Math.max(0, i - before)
  const s = asciiWindow(start, i + after)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i} needle=${JSON.stringify(needle)}\n\n${s}\n`,
  )
  console.log('OK', name, i, 'len', s.length)
}

dump('gold-rename-fn.txt', 'still show the old name', 8000, 2500)
dump('gold-rename-registryUpdated.txt', 'registryUpdated', 4000, 2000)
dump('gold-tips-sources.txt', 'Re=[...X]', 2000, 800)
dump(
  'gold-spinner-schema.txt',
  'spinnerTipsOverride.tipsFile must be an absolute',
  500,
  200,
)
dump('gold-trustedCount.txt', 'trustedCount', 4000, 2000)
dump('gold-surface-fn.txt', 'surface=claude_code', 6000, 2500)
dump('gold-host-died-fn.txt', 'EHOSTDEAD', 6000, 2500)
dump('gold-tips-file-schema.txt', 'org-tip:file:', 1500, 800)
