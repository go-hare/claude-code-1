import { afterEach, describe, expect, test } from 'bun:test'
import { getDefaultCharacters, getSpinnerPingPongFrames } from '../utils.js'

describe('densable 2.1.289 h7t spinner frames', () => {
  const prevTerm = process.env.TERM

  afterEach(() => {
    if (prevTerm === undefined) {
      delete process.env.TERM
    } else {
      process.env.TERM = prevTerm
    }
  })

  test('ghostty ot last two are ✻ not ASCII star', () => {
    process.env.TERM = 'xterm-ghostty'
    const frames = getDefaultCharacters()
    expect(frames).toEqual(['·', '✢', '✱', '✶', '✻', '✻'])
    expect(frames).not.toContain('*')
    expect(frames).not.toContain('✳')
    const pingPong = getSpinnerPingPongFrames()
    expect(pingPong).not.toContain('*')
    expect(pingPong[frames.length - 1]).toBe('✻')
    expect(pingPong[frames.length]).toBe('✻')
  })

  test('default at keeps ✽ not ASCII star', () => {
    process.env.TERM = 'xterm-256color'
    expect(getDefaultCharacters()).toEqual(['·', '✢', '✱', '✶', '✻', '✽'])
    expect(getDefaultCharacters()).not.toContain('*')
    expect(getDefaultCharacters()).not.toContain('✳')
  })
})
