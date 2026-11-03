/**
 * densable Dhr open: place under prepends below engine stack;
 * holdsTop blocks same-bucket steal unless succeeds.
 */
import { describe, expect, test } from 'bun:test'
import { createDialogStore } from '../dialogStore.js'

describe('densable Dhr place / holdsTop / succeeds', () => {
  test('place under prepends below an engine dialog', () => {
    const store = createDialogStore()
    store.open({ id: 'engine', kind: 'permission_bash', payload: {} })
    store.open({
      id: 'w7',
      kind: 'mcp_elicitation',
      payload: {},
      place: 'under',
      holdsTop: true,
    })
    expect(store.getState().open.map(e => e.id)).toEqual(['w7', 'engine'])
  })

  test('holdsTop keeps W7 top unless succeeds', () => {
    const store = createDialogStore()
    store.open({
      id: 'w7',
      kind: 'mcp_elicitation',
      payload: {},
      holdsTop: true,
    })
    store.open({ id: 'peer', kind: 'permission_prompt', payload: {} })
    expect(store.getState().open.map(e => e.id)).toEqual(['peer', 'w7'])
    store.open({
      id: 'wne',
      kind: 'mcp_elicitation_waiting',
      payload: {},
      succeeds: true,
    })
    expect(store.getState().open.map(e => e.id)).toEqual(['peer', 'w7', 'wne'])
  })
})
