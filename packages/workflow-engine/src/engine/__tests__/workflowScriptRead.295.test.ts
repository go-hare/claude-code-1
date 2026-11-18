import { describe, expect, test } from 'bun:test'
import { workflowScriptReadRefusal } from '../workflowScriptRead.js'

describe('2.1.295 #452 workflowScriptReadRefusal', () => {
  test('includes inline script guidance for sessions without Read tool', () => {
    const msg = workflowScriptReadRefusal('/tmp/outside.ts')
    expect(msg).toContain(
      'scriptPath must be a script path this tool returned, or a file you can already read (the working directory or a directory you have added): /tmp/outside.ts',
    )
    expect(msg).toContain(
      "A session that cannot call Read cannot load any scriptPath. Pass the whole script inline through Workflow's `script` input instead.",
    )
  })
})
