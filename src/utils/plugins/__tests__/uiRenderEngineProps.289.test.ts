import { describe, expect, test } from 'bun:test'
import { uiRenderEnginePropsCheck } from '../functionHooksModules.js'

describe('densable 2.1.289 nn ui.render rewrite guards', () => {
  test('Yr refuses g2e onScreen rewrite', () => {
    expect(
      uiRenderEnginePropsCheck(
        { text: 'hi', onScreen: { first: 0, last: 1, of: 2 } },
        { component: 'UserMessage', props: { text: 'hi' } },
      ),
    ).toContain('props.onScreen')
  })

  test('Jr refuses CommandOutput.command rewrite', () => {
    expect(
      uiRenderEnginePropsCheck(
        { command: 'other', text: 'out' },
        {
          component: 'CommandOutput',
          props: { command: 'recap', text: 'out' },
        },
      ),
    ).toContain('props.command')
  })

  test('qr refuses Pane.placement rewrite', () => {
    expect(
      uiRenderEnginePropsCheck(
        { placement: 'dock', title: 'a' },
        { component: 'Pane', props: { placement: 'inline', title: 'a' } },
      ),
    ).toContain('props.placement')
  })

  test('Qr refuses ToolProgress.kind rewrite', () => {
    expect(
      uiRenderEnginePropsCheck(
        { tool_use_id: 't1', kind: 'other', hint: 'x' },
        {
          component: 'ToolProgress',
          props: { tool_use_id: 't1', kind: 'background_hint', hint: 'x' },
        },
      ),
    ).toContain('props.kind')
  })

  test('en refuses UserMessage origin rewrite', () => {
    expect(
      uiRenderEnginePropsCheck(
        { text: 'hi', origin: { kind: 'plugin' } },
        { component: 'UserMessage', props: { text: 'hi' } },
      ),
    ).toContain('props.origin')
  })

  test('rn refuses ToolUse tool_use_id rewrite', () => {
    expect(
      uiRenderEnginePropsCheck(
        { tool_use_id: 'b', tool: 'Bash', input: {} },
        {
          component: 'ToolUse',
          props: { tool_use_id: 'a', tool: 'Bash', input: {} },
        },
      ),
    ).toContain('props.tool_use_id')
  })

  test('Fr refuses ToolGroup calls id rewrite', () => {
    expect(
      uiRenderEnginePropsCheck(
        { calls: ['a', 'c'], isActive: true },
        {
          component: 'ToolGroup',
          props: { calls: ['a', 'b'], isActive: true },
        },
      ),
    ).toContain('props.calls')
  })

  test('tn refuses Pane view rewrite', () => {
    expect(
      uiRenderEnginePropsCheck(
        { title: 'a', view: { agent: 'x' } },
        { component: 'Pane', props: { title: 'a' } },
      ),
    ).toContain('props.view')
  })

  test('text-only UserMessage rewrite is allowed', () => {
    expect(
      uiRenderEnginePropsCheck(
        { text: 'rewritten' },
        { component: 'UserMessage', props: { text: 'typed' } },
      ),
    ).toBeUndefined()
  })

  test('Mr Spinner.suffix must be a string or missing', () => {
    expect(
      uiRenderEnginePropsCheck(
        { message: 'hi', suffix: 1 },
        { component: 'Spinner', props: { message: 'hi', suffix: '…' } },
      ),
    ).toContain('props.suffix')
  })

  test('Mr PromptHint.tail must be a string or missing', () => {
    expect(
      uiRenderEnginePropsCheck(
        { hint: 'esc', tail: 1 },
        { component: 'PromptHint', props: { hint: 'esc' } },
      ),
    ).toContain('props.tail')
  })

  test('Hr refuses U+10EEEE placeholder grow', () => {
    expect(
      uiRenderEnginePropsCheck(
        { text: 'hi\u{10eeee}' },
        { component: 'UserMessage', props: { text: 'hi' } },
      ),
    ).toContain('control character')
  })

  test('Hr allows engine placeholder that did not grow', () => {
    expect(
      uiRenderEnginePropsCheck(
        { text: 'hi\u{10eeee} there' },
        {
          component: 'UserMessage',
          props: { text: 'hi\u{10eeee}' },
        },
      ),
    ).toBeUndefined()
  })

  test('Hr refuses ESC class-count grow', () => {
    expect(
      uiRenderEnginePropsCheck(
        { text: 'hi\x1b[31m' },
        { component: 'UserMessage', props: { text: 'hi' } },
      ),
    ).toContain('control character')
  })

  test('on counts object keys toward the rewrite char cap (Ve)', () => {
    const key = 'k'.repeat(100_001)
    expect(
      uiRenderEnginePropsCheck(
        { tool_use_id: 'a', tool: 'Bash', input: { [key]: true } },
        {
          component: 'ToolUse',
          props: { tool_use_id: 'a', tool: 'Bash', input: {} },
        },
      ),
    ).toContain('of more than')
  })

  test('Mr AskUserQuestion.metadataSource must be a string or missing', () => {
    expect(
      uiRenderEnginePropsCheck(
        { questions: [], metadataSource: 1 },
        { component: 'AskUserQuestion', props: { questions: [] } },
      ),
    ).toContain('props.metadataSource')
  })
})
