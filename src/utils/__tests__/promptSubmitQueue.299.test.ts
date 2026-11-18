import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'fs'
import path from 'path'
import {
  enqueue,
  popEditableAt,
  resetCommandQueue,
} from '../messageQueueManager.js'

describe('2.1.299 prompt submit & queue alignment (#611)', () => {
  afterEach(() => {
    resetCommandQueue()
  })

  test('messageQueueManager popEditableAt preserves inline pastedContents alongside images', () => {
    resetCommandQueue()
    enqueue({
      value: 'hello',
      mode: 'prompt',
      pastedContents: {
        1: { id: 1, type: 'text', content: 'inline-doc', inline: true },
        2: { id: 2, type: 'text', content: 'ref-only' },
        3: { id: 3, type: 'image', content: 'abc', mediaType: 'image/png' },
      },
    })

    const poppedOne = popEditableAt(0, '', 0)
    expect(poppedOne).toBeDefined()
    expect(poppedOne!.images.map(i => i.id)).toEqual([1, 3])
  })

  test('handlePromptSubmit preserves pastedContents for inline/referenced/expanded pastes', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../handlePromptSubmit.ts'),
      'utf8',
    )
    expect(src).toContain('const keepPastedContents =')
    expect(src).toContain(
      'pastedContents: keepPastedContents ? pastedContents : undefined',
    )
  })
})
