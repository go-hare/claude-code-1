import { readFileSync } from 'fs'
const t = readFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-20-jes-fn.txt',
  'utf8',
)
for (const k of [
  'let b=',
  'b=h',
  'admin_dir_failed',
  'fXo',
  'Bc(T',
  'placement',
]) {
  const i = t.indexOf(k)
  console.log('\n====', k, i, '====')
  if (i >= 0) console.log(t.slice(Math.max(0, i - 60), i + 400))
}
