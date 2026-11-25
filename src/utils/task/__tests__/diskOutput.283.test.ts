import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  MAX_PERSISTED_OUTPUT_BYTES,
  MAX_TASK_OUTPUT_BYTES,
  MAX_TASK_OUTPUT_BYTES_DISPLAY,
  TASK_OUTPUT_TAIL_BYTES,
} from '../diskOutput.js'

describe('diskOutput official 2.1.331 Tce/KCs/uU/qCs', () => {
  test('5GB cap (Tce=5368709120), 64MB persisted cap, 8192 tail bytes, pinWriteTarget kept', () => {
    expect(MAX_TASK_OUTPUT_BYTES).toBe(5_368_709_120)
    expect(MAX_TASK_OUTPUT_BYTES_DISPLAY).toBe('5GB')
    expect(MAX_PERSISTED_OUTPUT_BYTES).toBe(67_108_864)
    expect(TASK_OUTPUT_TAIL_BYTES).toBe(8192)
    const src = readFileSync(join(import.meta.dir, '../diskOutput.ts'), 'utf8')
    expect(src).toContain('pinWriteTarget')
  })
})
