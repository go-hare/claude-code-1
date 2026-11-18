import { describe, expect, test } from 'bun:test'
import {
  interpretCommandResult,
  splitCommandSegments,
} from '../commandSemantics.js'

describe('#904 PowerShell Select-Object / formatting cmdlet pipe semantics', () => {
  test('rg piped into Select-Object with exit 1 and empty output is not an error', () => {
    const result = interpretCommandResult(
      'rg pattern | Select-Object -First 5',
      1,
      '',
      '',
    )
    expect(result.isError).toBe(false)
    expect(result.message).toBe('No matches found')
  })

  test('grep piped into alias ft (Format-Table) with exit 1 and empty output is not an error', () => {
    const result = interpretCommandResult('grep foo bar.txt | ft', 1, '', '')
    expect(result.isError).toBe(false)
    expect(result.message).toBe('No matches found')
  })

  test('findstr piped into Sort-Object | Out-String with exit 1 and empty output is not an error', () => {
    const result = interpretCommandResult(
      'findstr pattern file.txt | Sort-Object | Out-String',
      1,
      '',
      '',
    )
    expect(result.isError).toBe(false)
    expect(result.message).toBe('No matches found')
  })

  test('when stdout is non-empty, Select-Object exit 1 is treated as an error', () => {
    const result = interpretCommandResult(
      'rg pattern | Select-Object -First 5',
      1,
      'some output',
      '',
    )
    expect(result.isError).toBe(true)
  })

  test('&& gating does not walk back across && as a pipe', () => {
    const split = splitCommandSegments('rg pattern && Select-Object -First 5')
    expect(split.andGated).toBe(true)
    expect(split.feeder).toBeUndefined()
    const result = interpretCommandResult(
      'rg pattern && Select-Object -First 5',
      1,
      '',
      '',
    )
    expect(result.isError).toBe(true)
  })
})
