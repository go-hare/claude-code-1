#!/usr/bin/env bun
import { allHits, asciiSlice, lastFnStartGeneric, loadSea } from './_peel-289-helpers.mjs'

const buf = loadSea()

function dump(needle, before = 200, after = 900, max = 3) {
  const hits = allHits(buf, needle)
  console.log('\n########', JSON.stringify(needle), 'count=', hits.length)
  for (const i of hits.slice(0, max)) {
    console.log('---', i)
    console.log(asciiSlice(buf, i - before, i + after))
  }
}

dump('nothing was drawn', 80, 700, 2)
dump('threw while drawn', 80, 700, 3)
dump('ui.render (${e}):', 40, 400, 2)
dump('the fault could not be said', 80, 400, 2)
dump('returned a drawing that holds a Proxy', 80, 700, 2)
dump('hover display "', 80, 900, 1)
dump('nothing copied', 80, 500, 4)
dump('over the write bound', 80, 300, 2)
dump('prompt.edit: hooked', 80, 400, 2)
dump('composer relays', 80, 300, 2)
dump('site failed:', 80, 200, 2)
dump('the chain threw', 80, 250, 2)
dump('no auto-opened subscriptions/listen', 40, 300, 2)
dump('list_pagination_exceeded', 40, 200, 2)
