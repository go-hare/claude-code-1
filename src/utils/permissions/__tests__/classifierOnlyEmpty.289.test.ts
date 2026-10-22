import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, test } from 'bun:test'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('densable 2.1.289 classifierOnly empty-action deny', () => {
  test('H3t stamps classifierRan:false on empty toAutoClassifierInput', () => {
    const src = readFileSync(join(__dirname, '../yoloClassifier.ts'), 'utf-8')
    expect(src).toContain(
      "reason: 'Tool declares no classifier-relevant input'",
    )
    expect(src).toContain('classifierRan: false')
  })

  test('Xe && classifierRan===false denies before Fr flag-allow', () => {
    const src = readFileSync(join(__dirname, '../permissions.ts'), 'utf-8')
    expect(src).toContain(
      'gave the auto mode classifier nothing to judge (its toAutoClassifierInput is empty)',
    )
    expect(src).toContain(
      'declares classifierOnly() but serialized to an empty classifier action; denying',
    )
    const deny = src.indexOf('gave the auto mode classifier nothing to judge')
    const flag = src.indexOf("classifierOnly?.onBlock === 'flag'")
    expect(deny).toBeGreaterThan(0)
    expect(flag).toBeGreaterThan(deny)
  })

  test('flag-allow is after recordDenial (gold AL then Xe)', () => {
    const src = readFileSync(join(__dirname, '../permissions.ts'), 'utf-8')
    const record = src.indexOf(
      'const newDenialState = recordDenial(denialState)',
    )
    const flagAllow = src.indexOf(
      'Flagged by the classifier, delivered with its warning:',
    )
    expect(record).toBeGreaterThan(0)
    expect(flagAllow).toBeGreaterThan(record)
  })

  test('unavailable always denies; classifierOnly transcript overflow denies', () => {
    const src = readFileSync(join(__dirname, '../permissions.ts'), 'utf-8')
    expect(src).toContain(
      'Auto mode classifier unavailable, denying with retry guidance (fail closed)',
    )
    expect(src).not.toContain('tengu_iron_gate_closed')
    expect(src).not.toContain(
      'falling back to normal permission handling (fail open)',
    )
    expect(src).toContain('denying (classifierOnly: no prompt fallback)')
    expect(src).toContain('try /compact to reduce conversation size')
  })

  test('Agent (ht) allows on transcriptTooLong before headless abort', () => {
    const src = readFileSync(join(__dirname, '../permissions.ts'), 'utf-8')
    const overflow = src.indexOf('if (classifierResult.transcriptTooLong)')
    const agentAllow = src.indexOf(
      'if (tool.name === AGENT_TOOL_NAME)',
      overflow,
    )
    const abort = src.indexOf(
      'Agent aborted: auto mode classifier transcript exceeded context window in headless mode',
      overflow,
    )
    expect(overflow).toBeGreaterThan(0)
    expect(agentAllow).toBeGreaterThan(overflow)
    expect(abort).toBeGreaterThan(agentAllow)
    const slice = src.slice(agentAllow, abort)
    expect(slice).toContain("behavior: 'allow'")
    expect(slice).toContain("decisionReason: { type: 'mode', mode: 'auto' }")
  })
})
