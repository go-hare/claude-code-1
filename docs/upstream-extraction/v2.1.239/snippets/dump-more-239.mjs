import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)

function sliceAround(kw, before = 80, after = 900) {
  const i = buf.indexOf(Buffer.from(kw))
  if (i < 0) return { kw, miss: true }
  return {
    kw,
    offset: i,
    text: buf.slice(Math.max(0, i - before), i + after).toString('utf8'),
  }
}

const hits = [
  sliceAround('deleteToLineStart(){', 0, 500),
  sliceAround('deleteToLineEnd(){', 0, 400),
  sliceAround('if(j.key==="backspace")', 0, 700),
  sliceAround('SDK major-version upgrade guides', 200, 800),
  sliceAround('# Live Documentation Sources', 0, 400),
  sliceAround('until your limit resets', 200, 400),
  sliceAround("Remote Control isn't enabled for this account", 0, 400),
  sliceAround('Please restart Claude from an existing directory', 200, 400),
  sliceAround('Working directory no longer exists', 80, 400),
]

writeFileSync(
  new URL('./gold-more-239.txt', import.meta.url),
  hits
    .map(h =>
      h.miss
        ? `MISS ${h.kw}\n`
        : `==== ${h.kw} @${h.offset} ====\n${h.text}\n`,
    )
    .join('\n'),
)
console.log('wrote gold-more-239.txt', hits.map(h => (h.miss ? 'MISS' : h.offset)))
