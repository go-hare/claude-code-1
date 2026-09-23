import { extractFnAt, loadSea } from './_peel-251-helpers.mjs'
const buf = loadSea()
const ex = extractFnAt(buf, 185309279, 20000)
console.log(ex.body)
console.log('LEN', ex.len, ex.sha)
