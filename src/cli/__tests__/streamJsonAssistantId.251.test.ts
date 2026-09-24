/**
 * densable 2.1.251 #24 — --input-format stream-json stamps message.id on
 * id-less client-injected assistant tool calls before same-id merge.
 * Does not reimplement aVn deserializeMessages. No settings mock.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { StructuredIO } from '../structuredIO.js'

async function* lineStream(lines: string[]): AsyncIterable<string> {
  for (const line of lines) {
    yield `${line}\n`
  }
}

async function collect(io: StructuredIO): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const msg of io.structuredInput) {
    out.push(msg)
  }
  return out
}

function assistantLine(opts: {
  uuid: string
  id?: string
  toolId: string
}): string {
  const message: Record<string, unknown> = {
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: opts.toolId,
        name: 'Bash',
        input: { command: opts.toolId },
      },
    ],
  }
  if (opts.id !== undefined) message.id = opts.id
  return JSON.stringify({
    type: 'assistant',
    uuid: opts.uuid,
    message,
  })
}

describe('densable 2.1.251 #24 stream-json assistant message.id', () => {
  test('StructuredIO stamps missing and empty message.id, keeps a real id', async () => {
    const io = new StructuredIO(
      lineStream([
        assistantLine({ uuid: 'a1', toolId: 'tool-a' }),
        assistantLine({ uuid: 'a2', id: '', toolId: 'tool-b' }),
        assistantLine({ uuid: 'a3', id: 'msg_keep', toolId: 'tool-c' }),
      ]),
    )
    const out = (await collect(io)) as Array<{
      type?: string
      message?: { id?: string }
    }>
    expect(out).toHaveLength(3)
    expect(out[0]?.type).toBe('assistant')
    expect(typeof out[0]?.message?.id).toBe('string')
    expect((out[0]?.message?.id ?? '').length).toBeGreaterThan(0)
    expect(typeof out[1]?.message?.id).toBe('string')
    expect((out[1]?.message?.id ?? '').length).toBeGreaterThan(0)
    expect(out[0]?.message?.id).not.toBe(out[1]?.message?.id)
    expect(out[2]?.message?.id).toBe('msg_keep')
  })

  test('print stamps before toInternalMessages; StructuredIO stamps assistant stdin', () => {
    const printSrc = readFileSync(join(import.meta.dir, '../print.ts'), 'utf8')
    const stamp = printSrc.indexOf('stampIdLessAssistantEntry(message)')
    const merge = printSrc.indexOf(
      'toInternalMessages([injected as SDKMessage])',
    )
    expect(stamp).toBeGreaterThan(0)
    expect(merge).toBeGreaterThan(stamp)

    const ioSrc = readFileSync(
      join(import.meta.dir, '../structuredIO.ts'),
      'utf8',
    )
    expect(ioSrc).toContain('return stampIdLessAssistantEntry(message)')
    expect(ioSrc).not.toContain('deserializeMessages')
  })
})
