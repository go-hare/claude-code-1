import { afterEach, describe, expect, test } from 'bun:test'
import {
  _resetWorkflowSizeGuidelineSessionBaselineForTests,
  buildWorkflowSizeGuidelineChangeMessage,
  buildWorkflowSizeGuidelineUserChangeMessage,
  formatWorkflowSizeGuidelineNamedLabel,
  getWorkflowSizeGuidelineChangeAttachments,
  getWorkflowSizeGuidelineSessionBaseline,
  normalizeWorkflowSizeGuidelineNamed,
  parseWorkflowSizeGuideline,
  WORKFLOW_SIZE_GUIDELINE_CAPS,
  workflowSizeGuidelineToAgentCap,
} from '../workflowSizeGuideline.js'

afterEach(() => {
  _resetWorkflowSizeGuidelineSessionBaselineForTests()
})

describe('workflowSizeGuidelineToAgentCap', () => {
  test('unrestricted', () => {
    expect(workflowSizeGuidelineToAgentCap('unrestricted')).toBeUndefined()
  })
  test('small', () => {
    expect(workflowSizeGuidelineToAgentCap('small')).toBe(
      WORKFLOW_SIZE_GUIDELINE_CAPS.small,
    )
  })
  test('medium densable Uao 15', () => {
    expect(workflowSizeGuidelineToAgentCap('medium')).toBe(15)
  })
  test('large densable Uao 50', () => {
    expect(workflowSizeGuidelineToAgentCap('large')).toBe(50)
  })
  test('numeric', () => {
    expect(workflowSizeGuidelineToAgentCap(12)).toBe(12)
  })
})

describe('parseWorkflowSizeGuideline', () => {
  test('names', () => {
    expect(parseWorkflowSizeGuideline('medium')).toBe('medium')
  })
  test('string number', () => {
    expect(parseWorkflowSizeGuideline('7')).toBe(7)
  })
})

describe('buildWorkflowSizeGuidelineChangeMessage', () => {
  test('copy', () => {
    expect(buildWorkflowSizeGuidelineChangeMessage('small')).toContain(
      'workflow size guideline',
    )
  })
})

describe('normalizeWorkflowSizeGuidelineNamed (densable Qit)', () => {
  test('named pass-through', () => {
    expect(normalizeWorkflowSizeGuidelineNamed('large')).toBe('large')
  })
  test('number → unrestricted', () => {
    expect(normalizeWorkflowSizeGuidelineNamed(12)).toBe('unrestricted')
  })
  test('undefined → unrestricted', () => {
    expect(normalizeWorkflowSizeGuidelineNamed(undefined)).toBe('unrestricted')
  })
})

describe('getWorkflowSizeGuidelineChangeAttachments (densable D5u)', () => {
  test('no change vs session baseline', () => {
    // seed baseline as unrestricted
    getWorkflowSizeGuidelineSessionBaseline(undefined)
    expect(
      getWorkflowSizeGuidelineChangeAttachments([], 'unrestricted'),
    ).toEqual([])
  })

  test('emits when live differs from baseline', () => {
    getWorkflowSizeGuidelineSessionBaseline(undefined)
    expect(getWorkflowSizeGuidelineChangeAttachments([], 'small')).toEqual([
      { type: 'workflow_size_guideline_change', size: 'small' },
    ])
  })

  test('uses last attachment size over baseline', () => {
    getWorkflowSizeGuidelineSessionBaseline(undefined)
    const msgs = [
      {
        type: 'attachment',
        attachment: {
          type: 'workflow_size_guideline_change',
          size: 'small',
        },
      },
    ]
    expect(getWorkflowSizeGuidelineChangeAttachments(msgs, 'small')).toEqual([])
    expect(getWorkflowSizeGuidelineChangeAttachments(msgs, 'medium')).toEqual([
      { type: 'workflow_size_guideline_change', size: 'medium' },
    ])
    expect(
      getWorkflowSizeGuidelineChangeAttachments(msgs, 'unrestricted'),
    ).toEqual([
      { type: 'workflow_size_guideline_change', size: 'unrestricted' },
    ])
  })
})

describe('buildWorkflowSizeGuidelineUserChangeMessage (densable I5u)', () => {
  test('unrestricted removal copy', () => {
    expect(
      buildWorkflowSizeGuidelineUserChangeMessage('unrestricted'),
    ).toContain('unrestricted again')
  })
  test('named change includes cap label', () => {
    const msg = buildWorkflowSizeGuidelineUserChangeMessage('small')
    expect(msg).toContain(formatWorkflowSizeGuidelineNamedLabel('small'))
    expect(msg).toContain('guideline, not a hard limit')
  })
})
