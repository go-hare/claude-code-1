import { describe, expect, test } from 'bun:test'
import { coerceBashInput } from './BashTool.js'

describe('2.1.295 BashTool alignment', () => {
  test('#364 coerceBashInput normalizes command_description to description', () => {
    expect(
      coerceBashInput({
        command: 'echo hi',
        command_description: 'Print greeting',
      }),
    ).toEqual({
      input: { command: 'echo hi', description: 'Print greeting' },
      shapeClass: 'command_description',
    })

    expect(
      coerceBashInput({
        command: 'echo hi',
        description: 'Existing description',
        command_description: 'Duplicate description',
      }),
    ).toEqual({
      input: { command: 'echo hi', description: 'Existing description' },
      shapeClass: 'command_description_dropped',
    })
  })
})
