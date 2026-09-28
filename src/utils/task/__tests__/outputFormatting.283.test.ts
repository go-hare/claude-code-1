import { describe, expect, test } from 'bun:test'
import {
  getMaxTaskOutputLength,
  TASK_MAX_OUTPUT_DEFAULT,
} from '../outputFormatting.js'

describe('taskOutputMaxChars densable 2.1.283 no-op', () => {
  test('TASK_MAX_OUTPUT_LENGTH no longer changes the cap', () => {
    const previous = process.env.TASK_MAX_OUTPUT_LENGTH
    process.env.TASK_MAX_OUTPUT_LENGTH = '1000'
    expect(getMaxTaskOutputLength()).toBe(TASK_MAX_OUTPUT_DEFAULT)
    if (previous === undefined) delete process.env.TASK_MAX_OUTPUT_LENGTH
    else process.env.TASK_MAX_OUTPUT_LENGTH = previous
  })
})
