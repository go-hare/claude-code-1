#!/usr/bin/env bun
import { allHits, asciiSlice, loadSea } from './_peel-289-helpers.mjs'
const buf = loadSea()
function dump(needle, before=150, after=800, max=2) {
  const hits = allHits(buf, needle)
  console.log('\n########', JSON.stringify(needle), 'count=', hits.length)
  for (const i of hits.slice(0, max)) {
    console.log('---', i)
    console.log(asciiSlice(buf, i-before, i+after))
  }
}
dump('ui.toast threw while drawn', 80, 400, 2)
dump('the toast stack threw while drawn', 80, 400, 2)
dump('no toast is drawn until the stack changes', 40, 200, 2)
dump('a plugin\'s ${r} threw while drawn', 40, 200, 1)
dump('threw while drawn (plugin', 80, 400, 2)
dump('hover prop "', 40, 200, 2)
dump('hover display "flex"', 40, 250, 1)
dump('function where plain data goes', 40, 250, 1)
dump('not plain data (a class instance)', 40, 250, 1)
dump('ui.render (', 40, 200, 6)
dump('site failed:', 40, 180, 2)
dump('ui.fault ', 40, 180, 3)
dump('ui.message ', 40, 180, 3)
dump('Cc("prompt.edit")', 40, 200, 2)
dump('setHooked', 40, 200, 2)
dump('$.ui.copy (', 40, 350, 2)
dump('no surface draws', 40, 250, 2)
dump('no client there took it', 40, 200, 2)
