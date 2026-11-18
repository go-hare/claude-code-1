import { describe, expect, test } from 'bun:test'
import {
  SAFE_GLOB_READONLY_COMMANDS,
  containsUnquotedExpansion,
  isCommandSafeViaFlagParsing,
} from './readOnlyValidation.js'

describe('#76 unquoted glob rejection for non-safe-glob read-only commands', () => {
  test('rejects unquoted wildcards on rg and git grep', () => {
    expect(isCommandSafeViaFlagParsing('rg foo *.ts')).toBe(false)
    expect(isCommandSafeViaFlagParsing('git grep foo *')).toBe(false)
    expect(containsUnquotedExpansion('rg foo *.ts')).toBe('glob')
    expect(SAFE_GLOB_READONLY_COMMANDS.has('rg')).toBe(false)
    expect(SAFE_GLOB_READONLY_COMMANDS.has('git')).toBe(false)
  })

  test('still allows quoted wildcards on rg and git grep', () => {
    expect(isCommandSafeViaFlagParsing("rg 'foo*' src/")).toBe(true)
    expect(isCommandSafeViaFlagParsing("git grep 'foo*'")).toBe(true)
    expect(containsUnquotedExpansion("rg 'foo*' src/")).toBe(false)
  })

  test('still allows unquoted wildcards on SAFE_GLOB_READONLY_COMMANDS like ls and grep', () => {
    expect(SAFE_GLOB_READONLY_COMMANDS.has('ls')).toBe(true)
    expect(SAFE_GLOB_READONLY_COMMANDS.has('grep')).toBe(true)
    expect(isCommandSafeViaFlagParsing('grep foo *.ts')).toBe(true)
  })
})
