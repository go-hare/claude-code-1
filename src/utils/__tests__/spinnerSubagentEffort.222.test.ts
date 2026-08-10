/**
 * densable 2.1.222 #13 — Spinner effort source for subagent transcript view.
 * SEA: V=But(h??Zi(), m??F) with m/h from per-agent spinner store / task stamps.
 */
import { describe, expect, test } from 'bun:test'
import { getEffortSuffix, resolveSpinnerEffortSource } from '../effort.js'

describe('resolveSpinnerEffortSource (densable 2.1.222 #13)', () => {
  test('leader / no viewingAgentTaskId → session F + Zi', () => {
    const r = resolveSpinnerEffortSource({
      sessionEffort: 'high',
      sessionModel: 'claude-opus-4-7',
    })
    expect(r).toEqual({ model: 'claude-opus-4-7', effortValue: 'high' })
  })

  test('viewing local_agent with effort stamp → m (agent effort), not F', () => {
    const r = resolveSpinnerEffortSource({
      sessionEffort: 'high',
      sessionModel: 'claude-opus-4-7',
      viewingAgentTaskId: 'agent-1',
      tasks: {
        'agent-1': {
          type: 'local_agent',
          effort: 'low',
          model: 'claude-haiku-4-5-20251001',
        },
      },
    })
    expect(r.effortValue).toBe('low')
    expect(r.model).toBe('claude-haiku-4-5-20251001')
  })

  test('viewing local_agent without effort → fall back to session F (m??F)', () => {
    const r = resolveSpinnerEffortSource({
      sessionEffort: 'xhigh',
      sessionModel: 'claude-opus-4-7',
      viewingAgentTaskId: 'agent-2',
      tasks: {
        'agent-2': {
          type: 'local_agent',
          // no effort
        },
      },
    })
    expect(r.effortValue).toBe('xhigh')
    expect(r.model).toBe('claude-opus-4-7')
  })

  test('selectedAgent.effort fallback when top-level effort missing', () => {
    const r = resolveSpinnerEffortSource({
      sessionEffort: 'high',
      sessionModel: 'claude-opus-4-7',
      viewingAgentTaskId: 'agent-3',
      tasks: {
        'agent-3': {
          type: 'local_agent',
          selectedAgent: { effort: 'medium', model: 'claude-sonnet-4-6' },
        },
      },
    })
    expect(r.effortValue).toBe('medium')
    expect(r.model).toBe('claude-sonnet-4-6')
  })

  test('in-process teammate view keeps session effort (no frontmatter effort)', () => {
    const r = resolveSpinnerEffortSource({
      sessionEffort: 'high',
      sessionModel: 'claude-opus-4-7',
      viewingAgentTaskId: 'tm-1',
      tasks: {
        'tm-1': {
          type: 'in_process_teammate',
          effort: 'low', // even if present, not densable agent effort surface
        },
      },
    })
    expect(r.effortValue).toBe('high')
    expect(r.model).toBe('claude-opus-4-7')
  })

  test('missing task id → session', () => {
    const r = resolveSpinnerEffortSource({
      sessionEffort: 'low',
      sessionModel: 'claude-opus-4-7',
      viewingAgentTaskId: 'gone',
      tasks: {},
    })
    expect(r).toEqual({ model: 'claude-opus-4-7', effortValue: 'low' })
  })

  test('getEffortSuffix uses resolved agent effort in transcript view path', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    delete process.env.CLAUDE_CODE_EFFORT_LEVEL
    const src = resolveSpinnerEffortSource({
      sessionEffort: 'high',
      sessionModel: 'gpt-5.5',
      viewingAgentTaskId: 'agent-x',
      tasks: {
        'agent-x': { type: 'local_agent', effort: 'xhigh', model: 'gpt-5.5' },
      },
    })
    expect(getEffortSuffix(src.model, src.effortValue)).toBe(
      ' with xhigh effort',
    )
  })
})
