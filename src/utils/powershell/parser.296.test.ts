import { describe, expect, test } from 'bun:test'
import {
  WINDOWS_MAX_COMMAND_LENGTH,
  MAX_COMMAND_LENGTH,
  PARSE_SCRIPT_BODY,
} from './parser.js'

describe('PowerShell parser v2.1.296 alignment (#532)', () => {
  test('#532: WINDOWS_MAX_COMMAND_LENGTH and MAX_COMMAND_LENGTH allow up to 32 KB (32767 bytes)', () => {
    expect(WINDOWS_MAX_COMMAND_LENGTH).toBe(32_767)
    expect(MAX_COMMAND_LENGTH).toBe(32_767)
  })

  test('#532: PARSE_SCRIPT_BODY reads base64 command from stdin ([Console]::In.ReadToEnd())', () => {
    expect(PARSE_SCRIPT_BODY).toContain(
      '$EncodedCommand = [Console]::In.ReadToEnd()',
    )
    expect(PARSE_SCRIPT_BODY).toContain('if (-not $EncodedCommand)')
  })
})
