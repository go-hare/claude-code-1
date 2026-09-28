import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  MAX_TASK_OUTPUT_BYTES,
  MAX_TASK_OUTPUT_BYTES_DISPLAY,
} from '../diskOutput.js'

describe('diskOutput densable 2.1.283 vLo', () => {
  test('1GB cap (gold vLo=1073741824), 252 pinWriteTarget kept', () => {
    expect(MAX_TASK_OUTPUT_BYTES).toBe(1_073_741_824)
    expect(MAX_TASK_OUTPUT_BYTES_DISPLAY).toBe('1GB')
    const src = readFileSync(join(import.meta.dir, '../diskOutput.ts'), 'utf8')
    expect(src).toContain('pinWriteTarget')
  })
})
