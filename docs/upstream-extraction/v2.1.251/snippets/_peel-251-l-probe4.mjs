import { asciiSlice, extractFnAt, lastFnStartGeneric, loadSea } from './_peel-251-helpers.mjs'
const buf = loadSea()
for (const off of [180760823, 180768901, 180785091]) {
  const st = lastFnStartGeneric(buf, off + 1, 4000)
  console.log('wo().state', off, 'enc', st.name, st.i)
  console.log(asciiSlice(buf, off - 80, off + 80))
}
console.log('\n--- J window ---')
console.log(asciiSlice(buf, 181689500, 181689720))
console.log('\n--- Ii full ---')
console.log(extractFnAt(buf, 180094315, 2000).body)
console.log('\n--- ME neighborhood ---')
console.log(asciiSlice(buf, 179503940, 179504140))
