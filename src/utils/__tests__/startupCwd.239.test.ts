// densable 2.1.239 #9 — cku startup cwd messages.
import { describe, expect, test } from 'bun:test'
import { getStartupCwdError } from '../startupCwd.js'

describe('densable 2.1.239 getStartupCwdError', () => {
  test('success is undefined', () => {
    expect(getStartupCwdError()).toBeUndefined()
  })

  test('ENOENT names a deleted or moved directory', () => {
    const orig = process.cwd
    process.cwd = () => {
      const err = new Error('gone') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      throw err
    }
    try {
      expect(getStartupCwdError()).toBe(
        'The current directory no longer exists (it was deleted or moved). Start Claude Code from an existing directory.',
      )
    } finally {
      process.cwd = orig
    }
  })

  test('other errno is included in the generic message', () => {
    const orig = process.cwd
    process.cwd = () => {
      const err = new Error('denied') as NodeJS.ErrnoException
      err.code = 'EACCES'
      throw err
    }
    try {
      expect(getStartupCwdError()).toBe(
        "Can't read the current directory (EACCES). Start Claude Code from a different directory.",
      )
    } finally {
      process.cwd = orig
    }
  })

  test('missing code omits the parenthetical', () => {
    const orig = process.cwd
    process.cwd = () => {
      throw new Error('nope')
    }
    try {
      expect(getStartupCwdError()).toBe(
        "Can't read the current directory. Start Claude Code from a different directory.",
      )
    } finally {
      process.cwd = orig
    }
  })
})
